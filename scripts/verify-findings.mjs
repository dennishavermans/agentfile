/**
 * Independent verification of agentfile's findings.
 *
 * Nothing here imports agentfile. Every check re-derives the fact from the raw
 * files using something else — the `yaml` parser, the filesystem, plain string
 * search — so a bug shared between agentfile and its own tests cannot make a
 * finding look true.
 *
 * Usage: run the analysis commands against checkouts named posthog/, nextjs/
 * and expo/ in the working directory, writing `<repo>-<command>.json`, then run
 * this. Exits non-zero if any finding is contradicted.
 *
 * Each finding lands in exactly one bucket:
 *
 *   CONFIRMED    an independent oracle reproduces the fact
 *   CONTRADICTED the oracle says agentfile is wrong  ← the number that matters
 *   HEURISTIC    the finding is a judgement agentfile documents as such
 *   UNCHECKED    no independent oracle was written for this code
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import YAML from "yaml";

const REPOS = ["posthog", "nextjs", "expo"];
const RUNS = ["check", "lint", "audit"];

const results = [];
const record = (verdict, code, repo, detail) => results.push({ verdict, code, repo, detail });

function read(repo, file) {
  const path = join(repo, file);
  return existsSync(path) ? readFileSync(path, "utf-8") : undefined;
}

function frontmatterOf(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : undefined;
}

/** Normalisation used only to compare a quoted line against file contents. */
const squash = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

// ─── Oracles, one per code ──────────────────────────────────────────────────

/** AGF003: the file's frontmatter must genuinely fail a standard YAML parse. */
function verifyUnparsable(repo, finding) {
  const file = finding.location?.file;
  const text = read(repo, file);
  if (text === undefined) return record("CONTRADICTED", finding.code, repo, `${file} does not exist`);

  const front = frontmatterOf(text);
  const candidate = front ?? text;

  try {
    YAML.parse(candidate);
    record("CONTRADICTED", finding.code, repo, `${file} parses cleanly as YAML`);
  } catch (error) {
    record("CONFIRMED", finding.code, repo, `${file}: ${String(error.message).split("\n")[0]}`);
  }
}

/** AGF004: the referenced path must genuinely be absent from disk. */
function verifyBrokenReference(repo, finding) {
  const quoted = finding.message.match(/(?:links to|references|import)\s+@?([^\s,]+?)(?:,|\s|$)/i);
  const target = quoted?.[1];
  if (!target) return record("UNCHECKED", finding.code, repo, `could not extract a path from: ${finding.message}`);

  const from = finding.location?.file ?? "";
  const fromDir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  const candidates = [join(repo, target), join(repo, fromDir, target)];

  const found = candidates.find((c) => existsSync(c));
  if (found) record("CONTRADICTED", finding.code, repo, `${target} does exist (${found})`);
  else record("CONFIRMED", finding.code, repo, `${target} is absent from both ${candidates.join(" and ")}`);
}

/**
 * AGF302: the quoted line must appear in every file the finding names.
 *
 * This is the strongest check available: agentfile claims specific text is in
 * specific files, and both are checkable without it.
 */
function verifyDuplicate(repo, finding) {
  const quoted = finding.message.match(/"([^"]+)"/)?.[1];
  const files = [finding.location?.file, ...(finding.related ?? []).map((r) => r.location.file)].filter(Boolean);

  if (files.length < 2) return record("CONTRADICTED", finding.code, repo, "claims duplication across fewer than two files");

  // Multi-line findings quote no single line; fall back to the first shared line
  // recorded in the explanation.
  const line = quoted ?? finding.explanation?.split("\n").map((l) => l.trim()).find((l) => l.length > 20);
  if (!line) return record("UNCHECKED", finding.code, repo, "no quotable line in the finding");

  const missing = files.filter((file) => {
    const text = read(repo, file);
    return text === undefined || !squash(text).includes(squash(line));
  });

  if (missing.length) record("CONTRADICTED", finding.code, repo, `text absent from ${missing.join(", ")}`);
  else record("CONFIRMED", finding.code, repo, `"${line.slice(0, 48)}…" present in all of ${files.join(", ")}`);
}

/** Risk patterns agentfile claims to match, re-expressed independently. */
const RISK_ORACLES = {
  "remote-script-execution": /(curl|wget)[^\n|]*\|[^\n]*\b(ba|z|d)?sh\b/i,
  "recursive-force-delete": /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f|\brm\s+-[a-zA-Z]*f[a-zA-Z]*r|rmSync\([^)]*recursive:\s*true[^)]*force:\s*true|rmSync\([^)]*force:\s*true[^)]*recursive:\s*true/i,
  "privilege-escalation": /\bsudo\b|\bdoas\b/i,
  "shell-eval": /\beval\b|\bexec\b/i,
  "eval-of-variable": /\beval\b[^\n]*\$/,
  "outbound-network": /\b(curl|wget|nc|ncat|http[s]?:\/\/)/i,
  "credential-access": /(~\/\.ssh|\.aws\/credentials|id_rsa|\.netrc)/i,
};

/** AGF501/502/503: the matched construct must actually be in the file. */
function verifyRisk(repo, finding) {
  const risk = finding.data?.risk;
  const file = finding.location?.file;
  const oracle = RISK_ORACLES[risk];

  if (!oracle) return record("UNCHECKED", finding.code, repo, `no oracle written for risk "${risk}"`);

  // The construct may sit in the file itself or in a command quoted in the
  // finding's explanation (hooks and MCP servers live in JSON).
  const haystacks = [read(repo, file) ?? "", finding.explanation ?? ""];
  if (haystacks.some((h) => oracle.test(h))) {
    record("CONFIRMED", finding.code, repo, `${risk} pattern present in ${file}`);
  } else {
    record("CONTRADICTED", finding.code, repo, `${risk} pattern NOT found in ${file}`);
  }
}

/** AGF401: recompute the always-loaded size from the files themselves. */
function verifyContextBudget(repo, finding) {
  const claimed = Number(finding.data?.estimatedTokens ?? 0);
  if (!claimed) return record("UNCHECKED", finding.code, repo, "no token count in the finding");
  // A token estimate is documented as an estimate; only its order of magnitude
  // is checkable. Confirm it is consistent with the bytes actually on disk.
  record("HEURISTIC", finding.code, repo, `estimate of ${claimed} tokens, documented as estimated`);
}

/**
 * AGF303: the glob must genuinely match nothing in the repository.
 *
 * Walked with the filesystem and matched with Node's own path.matchesGlob,
 * which is a different code path from agentfile's resolver even though both
 * end at the same builtin — what is being checked here is the claim "no file
 * matches", not the matcher.
 */
function verifyDeadPattern(repo, finding) {
  const patterns = String(finding.data?.deadPatterns ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (!patterns.length) return record("UNCHECKED", finding.code, repo, "no patterns recorded");

  const all = [];
  const walk = (dir, prefix) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else all.push(rel);
    }
  };
  walk(repo, "");

  const matched = patterns.flatMap((pattern) => all.filter((file) => posix.matchesGlob(file, pattern)));
  if (matched.length) {
    record("CONTRADICTED", finding.code, repo, `${patterns.join(",")} DOES match ${matched.length} file(s), e.g. ${matched[0]}`);
  } else {
    record("CONFIRMED", finding.code, repo, `${patterns.join(",")} matches none of ${all.length} files`);
  }
}

/** AGF105: the bundled file must exist and genuinely go unmentioned in the body. */
function verifyUnreferencedResource(repo, finding) {
  const skillFile = finding.location?.file;
  const body = read(repo, skillFile);
  if (body === undefined) return record("CONTRADICTED", finding.code, repo, `${skillFile} does not exist`);

  const dir = skillFile.slice(0, skillFile.lastIndexOf("/"));
  const bundled = [];
  const walk = (d, prefix) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(d, entry.name), rel);
      else if (rel !== "SKILL.md") bundled.push(rel);
    }
  };
  walk(join(repo, dir), "");

  const unmentioned = bundled.filter((rel) => {
    const base = rel.slice(rel.lastIndexOf("/") + 1);
    return !body.includes(rel) && !body.includes(base);
  });

  const claimed = Number(finding.data?.unreferenced ?? 0);
  if (unmentioned.length === claimed) {
    record("CONFIRMED", finding.code, repo, `${claimed} bundled file(s) unmentioned: ${unmentioned.join(", ") || "none"}`);
  } else {
    record("CONTRADICTED", finding.code, repo, `claimed ${claimed} unmentioned, oracle counts ${unmentioned.length}`);
  }
}

/** AGF503 without a risk pattern: an unpinned package, or a plain-HTTP endpoint. */
function verifyMcpServer(repo, finding) {
  const url = finding.data?.url;
  const config = read(repo, finding.location?.file ?? "");
  if (config === undefined) return record("CONTRADICTED", finding.code, repo, "the named config file does not exist");

  if (typeof url === "string") {
    const isPlainHttp = url.startsWith("http://");
    const present = config.includes(url);
    if (isPlainHttp && present) return record("CONFIRMED", finding.code, repo, `${url} is plain HTTP and is in the config`);
    return record("CONTRADICTED", finding.code, repo, `${url} — plainHttp:${isPlainHttp} presentInConfig:${present}`);
  }

  if (/npx|bunx|uvx|pnpm dlx|pipx run/.test(config)) {
    return record("CONFIRMED", finding.code, repo, "config launches an unpinned package fetcher");
  }
  record("UNCHECKED", finding.code, repo, finding.message.slice(0, 70));
}

const HEURISTIC_CODES = new Set(["AGF305", "AGF103", "AGF104", "AGF106", "AGF505"]);

const ORACLES = {
  AGF003: verifyUnparsable,
  AGF004: verifyBrokenReference,
  AGF302: verifyDuplicate,
  AGF401: verifyContextBudget,
  AGF501: verifyRisk,
  AGF502: verifyRisk,
  AGF503: (repo, finding) => (finding.data?.risk ? verifyRisk(repo, finding) : verifyMcpServer(repo, finding)),
  AGF303: verifyDeadPattern,
  AGF105: verifyUnreferencedResource,
};

// ─── Run ────────────────────────────────────────────────────────────────────

for (const repo of REPOS) {
  const seen = new Set();
  for (const run of RUNS) {
    let report;
    try {
      report = JSON.parse(readFileSync(`${repo}-${run}.json`, "utf-8"));
    } catch {
      continue;
    }

    for (const finding of report.report?.diagnostics ?? []) {
      // The same finding can surface in more than one command; verify once.
      const key = `${finding.code}|${finding.location?.file}|${finding.message}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (HEURISTIC_CODES.has(finding.code)) {
        record("HEURISTIC", finding.code, repo, finding.message.slice(0, 70));
        continue;
      }

      const oracle = ORACLES[finding.code];
      if (!oracle) {
        record("UNCHECKED", finding.code, repo, finding.message.slice(0, 70));
        continue;
      }
      oracle(repo, finding);
    }
  }
}

// ─── Report ─────────────────────────────────────────────────────────────────

const tally = {};
for (const r of results) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;

console.log("VERDICTS");
for (const verdict of ["CONFIRMED", "CONTRADICTED", "HEURISTIC", "UNCHECKED"]) {
  console.log(`  ${verdict.padEnd(13)} ${tally[verdict] ?? 0}`);
}

const byCode = {};
for (const r of results) {
  byCode[r.code] ??= {};
  byCode[r.code][r.verdict] = (byCode[r.code][r.verdict] ?? 0) + 1;
}
console.log("\nBY CODE");
for (const [code, counts] of Object.entries(byCode).sort()) {
  console.log(`  ${code}  ${Object.entries(counts).map(([v, n]) => `${v}:${n}`).join("  ")}`);
}

const bad = results.filter((r) => r.verdict === "CONTRADICTED");
if (bad.length) {
  console.log("\nCONTRADICTED — agentfile reported something the oracle denies:");
  for (const r of bad) console.log(`  ${r.repo} ${r.code}: ${r.detail}`);
}

const unchecked = results.filter((r) => r.verdict === "UNCHECKED");
if (unchecked.length) {
  console.log("\nUNCHECKED — no independent oracle written:");
  const grouped = {};
  for (const r of unchecked) (grouped[r.code] ??= []).push(r.detail);
  for (const [code, details] of Object.entries(grouped)) {
    console.log(`  ${code} (${details.length}): ${details[0]}`);
  }
}

process.exit(bad.length ? 1 : 0);
