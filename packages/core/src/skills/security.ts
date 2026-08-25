/**
 * Static inspection of files bundled with a skill.
 *
 * Two rules govern everything here, both from the rework brief:
 *
 *   1. **Nothing is executed.** A script is read as text and matched against
 *      patterns. No shell is spawned, no interpreter is invoked, no file is made
 *      executable. That holds even when the whole point of the file is to be
 *      run.
 *   2. **Risk is described, safety is never claimed.** A clean result means "no
 *      pattern in this list matched", which is a much weaker statement than
 *      "this script is safe", and the wording says so. Pattern matching cannot
 *      see intent, cannot follow a variable, and cannot read a binary.
 *
 * Every pattern carries a name and a reason, so a finding can be argued with on
 * its merits rather than accepted because a tool said so.
 */

import { join } from "node:path";
import { type Diagnostic, diagnostic, type Severity } from "../diagnostics/index.js";
import type { FileSystem } from "../fs/index.js";
import type { AgentConfiguration, SkillEntry } from "../ir/index.js";
import { basenameOf } from "../paths/index.js";

/**
 * Largest file worth reading.
 *
 * A bundled asset can be arbitrarily large, and reading a megabyte of minified
 * output to grep it is a cost with no matching benefit. Skips are reported, not
 * silent.
 */
export const MAX_INSPECTED_BYTES = 256 * 1024;

/** Extensions treated as executable content regardless of which directory they sit in. */
const SCRIPT_EXTENSIONS = [".sh", ".bash", ".zsh", ".fish", ".ps1", ".py", ".rb", ".pl", ".js", ".mjs", ".cjs", ".ts"];

export interface RiskPattern {
  /** Stable kebab-case id, so a finding can be suppressed or tracked by name. */
  id: string;
  pattern: RegExp;
  severity: Severity;
  /** What was found, phrased as an observation. */
  title: string;
  /** Why it is worth a human looking. Never a claim about intent. */
  why: string;
}

/**
 * The pattern set.
 *
 * Deliberately small and specific. A large fuzzy set produces findings a
 * developer learns to ignore, which is worse than no findings at all — so each
 * entry here describes a concrete mechanism, not a vibe.
 */
export const RISK_PATTERNS: readonly RiskPattern[] = [
  {
    id: "remote-script-execution",
    pattern: /\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z|k|da)?sh\b/,
    severity: "error",
    title: "downloads a script and pipes it straight into a shell",
    why: "Whatever the remote host serves at that moment runs with the developer's privileges. The content is never reviewed, is not pinned to a version, and can differ between runs.",
  },
  {
    id: "obfuscated-execution",
    pattern: /base64\s+(?:-d|-D|--decode)[^|\n]*\|\s*\w*sh\b|\|\s*base64\s+(?:-d|-D|--decode)[^|\n]*\|\s*\w*sh\b/,
    severity: "error",
    title: "decodes text and executes the result",
    why: "The command that will actually run is not readable in the file, so review of the file does not tell a reader what it does.",
  },
  {
    id: "eval-of-variable",
    pattern: /\beval\b[^\n]*\$\{?[A-Za-z_]/,
    severity: "error",
    title: "evaluates a variable as a command",
    why: "What runs depends on the variable's value at that moment, so the file's text does not determine its behaviour.",
  },
  {
    id: "hardcoded-private-key",
    pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
    severity: "error",
    title: "contains a private key",
    why: "A key committed to a repository is readable by everyone with access to it and by anything that mirrors it. It should be treated as already disclosed.",
  },
  {
    id: "hardcoded-credential",
    pattern: /\bAKIA[0-9A-Z]{16}\b|(?:secret|token|password|passwd|api[_-]?key)\s*[:=]\s*["'][^"'\n]{12,}["']/i,
    severity: "error",
    title: "contains what looks like a credential",
    why: "A literal credential in a committed file is disclosed to everyone with repository access. This pattern also matches placeholders, so confirm before rotating anything.",
  },
  {
    id: "recursive-force-delete",
    pattern: /\brm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*[rR]|-r\s+-f|-f\s+-r)\b/,
    severity: "warning",
    title: "deletes recursively without prompting",
    why: "If the path is empty or unset at runtime, the deletion starts somewhere other than where the author intended, and there is no confirmation step to stop it.",
  },
  {
    id: "privilege-escalation",
    pattern: /(?:^|\s|\|)sudo\s/,
    severity: "warning",
    title: "requests elevated privileges",
    why: "An agent running this cannot judge whether elevation is warranted, and the effects reach outside the repository.",
  },
  {
    id: "credential-path-access",
    pattern: /(?:~|\$HOME|\$\{HOME\})\/\.(?:ssh|aws|gnupg|kube|docker|npmrc)\b|(?:^|\s)\.env(?:\.\w+)?\b/,
    severity: "warning",
    title: "reads or writes a credential location",
    why: "These paths hold secrets for systems beyond this repository. Legitimate uses exist; each is worth confirming.",
  },
  {
    id: "insecure-transport",
    pattern: /\bcurl\b[^\n]*\s(?:-k|--insecure)\b|\bwget\b[^\n]*\s--no-check-certificate\b/,
    severity: "warning",
    title: "disables certificate verification",
    why: "The connection can be intercepted and its content replaced without the script noticing.",
  },
  {
    id: "world-writable",
    pattern: /\bchmod\s+(?:-R\s+)?0?777\b/,
    severity: "warning",
    title: "makes files writable by every user on the machine",
    why: "Any process on the machine can then modify them, including whatever runs next.",
  },
  {
    id: "outbound-network",
    pattern: /\b(?:curl|wget|nc|ncat|scp|rsync|ssh)\b/,
    severity: "info",
    title: "makes network calls",
    why: "Not a problem in itself. Recorded so that what a skill reaches out to is visible without reading every script.",
  },
];

/** Findings a single file reports before the rest are summarised. */
const MATCHES_PER_FILE = 3;

function isScript(path: string, kind: string): boolean {
  if (kind === "script") return true;
  const lowered = path.toLowerCase();
  return SCRIPT_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}

export interface SkillSecurityOptions {
  /** Absolute project root. */
  root: string;
  fs: FileSystem;
  /** Largest file to read. Defaults to `MAX_INSPECTED_BYTES`. */
  maxBytes?: number;
}

export interface SkillSecurityResult {
  diagnostics: Diagnostic[];
  /** Files inspected, so a report can say what the clean result covers. */
  inspected: string[];
  /** Files not inspected, with the reason. Never silent. */
  skipped: Array<{ file: string; reason: string }>;
}

interface Match {
  pattern: RiskPattern;
  line: number;
  text: string;
}

/** Matches in one file's text, line by line. */
function findMatches(text: string): Match[] {
  const lines = text.split("\n");
  const matches: Match[] = [];

  for (let offset = 0; offset < lines.length; offset++) {
    const line = lines[offset];
    // A comment is documentation, not an instruction to a shell.
    if (/^\s*#(?!!)/.test(line) || /^\s*\/\//.test(line)) continue;

    for (const pattern of RISK_PATTERNS) {
      if (pattern.pattern.test(line)) {
        matches.push({ pattern, line: offset + 1, text: line.trim() });
      }
    }
  }

  return matches;
}

function inspectFile(skill: SkillEntry, relativePath: string, text: string): Diagnostic[] {
  const matches = findMatches(text);
  if (!matches.length) return [];

  // One diagnostic per pattern per file: three lines using `sudo` is one
  // observation about the file, not three findings.
  const byPattern = new Map<string, Match[]>();
  for (const match of matches) {
    const group = byPattern.get(match.pattern.id);
    if (group) group.push(match);
    else byPattern.set(match.pattern.id, [match]);
  }

  const skillLabel = skill.name || basenameOf(skill.provenance.file);

  return [...byPattern.values()].map((group) => {
    const { pattern } = group[0];
    const quoted = group.slice(0, MATCHES_PER_FILE);
    const remaining = group.length - quoted.length;

    return diagnostic({
      code: "AGF501",
      severity: pattern.severity,
      message: `Skill "${skillLabel}": ${relativePath} ${pattern.title}`,
      explanation: [
        pattern.why,
        "",
        ...quoted.map((match) => `  line ${match.line}: ${match.text}`),
        ...(remaining > 0 ? [`  …and ${remaining} more occurrence${remaining === 1 ? "" : "s"}`] : []),
        "",
        "This is a pattern match on the file's text. Nothing was executed to produce it,",
        "and it cannot see intent — confirm what the script does before acting on this.",
      ].join("\n"),
      suggestion:
        pattern.severity === "info"
          ? "No action needed unless the destinations are unexpected."
          : "Read the script and confirm this is intended. If it is, a comment saying why saves the next reader the same work.",
      location: { file: relativePath, line: group[0].line },
      data: {
        skill: skillLabel,
        risk: pattern.id,
        occurrences: group.length,
        analysis: "static-pattern-match",
      },
    });
  });
}

/**
 * Inspects the scripts bundled with every skill.
 *
 * Reads files. Executes nothing.
 */
export function inspectSkillResources(
  configuration: AgentConfiguration,
  options: SkillSecurityOptions,
): SkillSecurityResult {
  const maxBytes = options.maxBytes ?? MAX_INSPECTED_BYTES;
  const result: SkillSecurityResult = { diagnostics: [], inspected: [], skipped: [] };

  for (const skill of configuration.skills) {
    if (!skill.directory) continue;

    for (const resource of skill.resources) {
      const relativePath = `${skill.directory}/${resource.path}`;

      if (!isScript(resource.path, resource.kind)) {
        result.skipped.push({ file: relativePath, reason: "not executable content" });
        continue;
      }

      let text: string;
      try {
        text = options.fs.readFile(join(options.root, relativePath));
      } catch {
        result.skipped.push({ file: relativePath, reason: "could not be read" });
        continue;
      }

      if (text.length > maxBytes) {
        result.skipped.push({
          file: relativePath,
          reason: `larger than the ${Math.round(maxBytes / 1024)} KB inspection limit`,
        });
        continue;
      }

      result.inspected.push(relativePath);
      result.diagnostics.push(...inspectFile(skill, relativePath, text));
    }
  }

  return result;
}
