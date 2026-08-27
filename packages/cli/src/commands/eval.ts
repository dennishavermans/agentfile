/// <reference types="node" />

/**
 * `agentfile eval` — behavioral evaluation with deterministic assertions.
 *
 * Distinct from validation on purpose (REWORK §11): `validate` reads
 * configuration, `eval` runs a task and judges the state it leaves behind.
 * Everything executes in an isolated temporary workspace seeded from what the
 * repository versions — never in the working tree.
 *
 * Costs are controlled the way REWORK §20 lays out: no agent runs unless the
 * user names one, and results are cached against the definition, the agent
 * command, and the repository state, so an unchanged eval is not re-run.
 *
 * Exit codes follow the promptfoo convention CI expects: 0 all passed,
 * 1 assertions failed, 2 the harness itself could not run an eval.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  discover,
  EVAL_FILE_SUFFIX,
  type EvalResult,
  evalCacheKey,
  evalFilesIn,
  gitSeedFiles,
  gitStateFingerprint,
  nodeFileSystem,
  parseEvalDefinition,
  runEval,
  sortDiagnostics,
  temporaryDirectorySandbox,
} from "@agentfile/core";
import chalk from "chalk";
import { logger } from "../logger.js";
import { parseFindingFormat, printJson, rejectFormat } from "../report.js";

export interface EvalOptions {
  /** Explicit eval definition files. Defaults to every *.eval.yaml discovered. */
  files?: string[];
  /** Directory to run in instead of the current working directory. */
  root?: string;
  /** Agent command template, e.g. `claude -p {prompt}`. */
  agent?: string;
  /** Reuse cached results for unchanged inputs. Default true (`--no-cache`). */
  cache?: boolean;
  /** Leave workspaces on disk for inspection. */
  keepWorkspace?: boolean;
  /** `human` (default) or `json`. */
  format?: string;
}

const CACHE_FILE = ".agentfile/eval-cache.json";

interface CacheEntry {
  name: string;
  status: "passed" | "failed";
  passed: number;
  failed: number;
  cachedAt: string;
}

type Cache = Record<string, CacheEntry>;

function readCache(root: string): Cache {
  try {
    return JSON.parse(readFileSync(join(root, CACHE_FILE), "utf-8")).entries ?? {};
  } catch {
    return {};
  }
}

function writeCache(root: string, entries: Cache): void {
  const path = join(root, CACHE_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, "utf-8");
}

const STATUS_LABEL = {
  passed: chalk.green("passed"),
  failed: chalk.red("failed"),
  error: chalk.red("error"),
  skipped: chalk.yellow("skipped"),
} as const;

function statusLabel(result: { status: keyof typeof STATUS_LABEL; cached?: boolean }): string {
  return result.cached ? chalk.gray(`${result.status} (cached)`) : STATUS_LABEL[result.status];
}

export async function evalCommand(options: EvalOptions = {}): Promise<void> {
  const format = parseFindingFormat(options.format);
  if (!format) return rejectFormat(options.format as string, ["human", "json"]);

  const root = options.root ?? process.cwd();
  const discovery = discover({ root });

  const files = options.files?.length
    ? options.files.map((file) => relative(root, join(root, file)))
    : evalFilesIn(discovery.scan.files);

  if (format === "human") {
    logger.title("agentfile eval");
    logger.info(root);
    console.log();
  }

  if (!files.length) {
    if (format === "json") {
      printJson({ root, command: "eval", results: [], summary: { passed: 0, failed: 0, errors: 0, skipped: 0 } });
      return;
    }
    logger.warn(`No eval definitions found (looked for *${EVAL_FILE_SUFFIX}).`);
    logger.info("An eval file names a task and deterministic assertions — see docs/evals.md.");
    console.log();
    return;
  }

  // Seed from what the repository versions; fall back to the discovery scan
  // outside git. Either way node_modules and other ignored trees stay out.
  const seedFiles = gitSeedFiles(root) ?? discovery.scan.files;
  const sandbox = temporaryDirectorySandbox({ root, fs: nodeFileSystem, files: seedFiles });

  const useCache = options.cache !== false;
  const fingerprint = useCache ? gitStateFingerprint(root) : undefined;
  const cache = fingerprint ? readCache(root) : {};
  let cacheDirty = false;

  const results: Array<EvalResult & { cached?: boolean }> = [];
  let harnessError = false;

  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(join(root, file), "utf-8");
    } catch {
      harnessError = true;
      results.push({
        name: file,
        file,
        status: "error",
        reason: "the definition file could not be read",
        assertions: [],
        changedFiles: [],
        diagnostics: [],
      });
      continue;
    }

    const parsed = parseEvalDefinition(file, text);
    if (!parsed.definition) {
      harnessError = true;
      results.push({
        name: file,
        file,
        status: "error",
        reason: "the definition is invalid — see the findings below",
        assertions: [],
        changedFiles: [],
        diagnostics: parsed.diagnostics,
      });
      continue;
    }

    const key = fingerprint ? evalCacheKey(text, options.agent, fingerprint) : undefined;
    const hit = key ? cache[key] : undefined;
    if (hit) {
      results.push({
        name: parsed.definition.name,
        file,
        status: hit.status,
        assertions: [],
        changedFiles: [],
        diagnostics: [],
        cached: true,
      });
      continue;
    }

    const result = runEval(parsed.definition, {
      sandbox,
      agentCommand: options.agent,
      keepWorkspace: options.keepWorkspace,
    });
    results.push(result);

    if (result.status === "error") harnessError = true;
    if (key && (result.status === "passed" || result.status === "failed")) {
      cache[key] = {
        name: result.name,
        status: result.status,
        passed: result.assertions.filter((assertion) => assertion.passed).length,
        failed: result.assertions.filter((assertion) => !assertion.passed).length,
        cachedAt: new Date().toISOString(),
      };
      cacheDirty = true;
    }
  }

  if (cacheDirty && fingerprint) writeCache(root, cache);

  const summary = {
    passed: results.filter((result) => result.status === "passed").length,
    failed: results.filter((result) => result.status === "failed").length,
    errors: results.filter((result) => result.status === "error").length,
    skipped: results.filter((result) => result.status === "skipped").length,
  };
  const failed = summary.failed > 0;

  if (format === "json") {
    printJson({
      root,
      command: "eval",
      sandbox: sandbox.description,
      agent: options.agent,
      results,
      summary,
    });
    if (harnessError) process.exit(2);
    if (failed) process.exit(1);
    return;
  }

  logger.info(chalk.gray(`Sandbox: ${sandbox.description}`));
  console.log();

  for (const result of results) {
    console.log(`  ${statusLabel(result).padEnd(19)} ${chalk.bold(result.name)} ${chalk.gray(result.file)}`);

    if (result.reason) console.log(`    ${chalk.gray(result.reason)}`);
    for (const assertion of result.assertions) {
      const mark = assertion.passed ? chalk.green("✓") : chalk.red("✗");
      console.log(`    ${mark} ${assertion.kind}: ${assertion.target} ${chalk.gray(`— ${assertion.detail}`)}`);
    }
    if (result.workspaceRoot) console.log(`    ${chalk.gray(`workspace kept at ${result.workspaceRoot}`)}`);

    const invalid = sortDiagnostics(result.diagnostics.filter((entry) => entry.code !== "AGF602"));
    for (const finding of invalid) {
      console.log(`    ${chalk.red(finding.code)} ${finding.message}`);
    }
    console.log();
  }

  const parts = [
    summary.passed ? chalk.green(`${summary.passed} passed`) : "",
    summary.failed ? chalk.red(`${summary.failed} failed`) : "",
    summary.errors ? chalk.red(`${summary.errors} error${summary.errors === 1 ? "" : "s"}`) : "",
    summary.skipped ? chalk.yellow(`${summary.skipped} skipped`) : "",
  ].filter(Boolean);
  console.log(`  ${parts.join(", ") || "nothing ran"}`);
  console.log();

  if (summary.skipped && !options.agent) {
    logger.info(chalk.gray('Prompted evals need an agent: pass --agent, e.g. --agent "claude -p {prompt}".'));
    console.log();
  }

  if (harnessError) process.exit(2);
  if (failed) process.exit(1);
}
