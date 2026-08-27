/// <reference types="node" />

/**
 * `agentfile compile` — native target files from the normalized configuration.
 *
 * Compilation is downstream of discovery: whatever the repository's source of
 * truth is (AGENTS.md, CLAUDE.md, an agentfile contract), the IR is compiled to
 * the requested targets. Three rules shape the command:
 *
 *   • deterministic: same tree in, same bytes out, no timestamps in content
 *   • honest: what a target cannot express is a finding, not a silent drop
 *   • safe: a file agentfile does not own is never overwritten without --force
 *
 * `--check` verifies instead of writing (exit 0 clean, 1 drift, 2 error) — the
 * same contract as prettier --check, so CI can gate on it.
 */

import {
  applyCompilation,
  buildManifest,
  COMPILE_TARGETS,
  type CompilationPlan,
  discover,
  driftedFiles,
  formatHuman,
  MANIFEST_FILE,
  nodeFileSystem,
  ownedPaths,
  planCompilation,
  readManifest,
  writeManifest,
} from "@agentfile/core";
import chalk from "chalk";
import { logger } from "../logger.js";
import { parseFindingFormat, printJson, rejectFormat } from "../report.js";

export interface CompileOptions {
  /** Directory to compile instead of the current working directory. */
  root?: string;
  /** Target ids, e.g. ["claude", "agents-md"]. */
  target?: string[];
  /** Verify instead of writing. Exit 0 clean, 1 drift, 2 error. */
  check?: boolean;
  /** Overwrite files agentfile does not own. */
  force?: boolean;
  /** `human` (default) or `json`. */
  format?: string;
}

const ACTION_LABEL = {
  create: chalk.green("create"),
  update: chalk.yellow("update"),
  unchanged: chalk.gray("unchanged"),
  refused: chalk.red("refused"),
} as const;

function reportTargets(plan: CompilationPlan): void {
  for (const target of plan.targets) {
    const count = plan.files.filter((file) => file.target === target.target).length;
    logger.info(`${chalk.cyan(String(target.target).padEnd(10))} ${count} file${count === 1 ? "" : "s"}`);

    for (const entry of target.notCarried) {
      console.log(`  ${chalk.gray(`not carried: ${entry.count} ${entry.kind} — ${entry.reason}`)}`);
    }
  }
}

export async function compileCommand(options: CompileOptions = {}): Promise<void> {
  const format = parseFindingFormat(options.format);
  if (!format) return rejectFormat(options.format as string, ["human", "json"]);

  const targets = options.target ?? [];
  if (!targets.length) {
    logger.error(`No targets given. Pass --target with one or more of: ${COMPILE_TARGETS.join(", ")}.`);
    logger.info("Codex reads AGENTS.md, so --target agents-md covers it.");
    process.exit(2);
  }
  const unknown = targets.filter((target) => !COMPILE_TARGETS.includes(target));
  if (unknown.length) {
    logger.error(
      `Unknown target${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. Implemented: ${COMPILE_TARGETS.join(", ")}.`,
    );
    if (unknown.includes("codex")) logger.info("Codex reads AGENTS.md, so --target agents-md covers it.");
    process.exit(2);
  }

  const root = options.root ?? process.cwd();
  const discovery = discover({ root });

  const manifest = readManifest(root);
  const owned = new Set(manifest ? ownedPaths(manifest) : []);

  let plan: CompilationPlan;
  try {
    plan = planCompilation(discovery.configuration, {
      root,
      fs: nodeFileSystem,
      targets,
      owned,
      force: options.force,
    });
  } catch (error) {
    logger.error((error as Error).message);
    process.exit(2);
    return;
  }

  const drift = driftedFiles(plan);
  const refused = plan.files.filter((file) => file.action === "refused");
  const fidelity = plan.targets.flatMap((target) => target.diagnostics);

  if (format === "json") {
    printJson({
      root,
      command: "compile",
      check: options.check === true,
      targets: plan.targets.map((target) => ({
        target: target.target,
        files: plan.files.filter((file) => file.target === target.target).map((file) => file.path),
        notCarried: target.notCarried,
        diagnostics: target.diagnostics,
      })),
      files: plan.files.map((file) => ({ path: file.path, action: file.action, target: file.target })),
      refusals: plan.diagnostics,
      written: options.check ? [] : applyCompilationAndManifest(plan, root, drift.length > 0),
    });

    if (refused.length) process.exit(1);
    if (options.check && drift.length) process.exit(1);
    return;
  }

  logger.title(options.check ? "agentfile compile --check" : "agentfile compile");
  logger.info(root);
  console.log();

  if (!discovery.configuration.sources.length) {
    logger.warn("No agent configuration found, so there is nothing to compile.");
    logger.info("Run `agentfile doctor` to see what agentfile looks for.");
    console.log();
    return;
  }

  reportTargets(plan);
  console.log();

  if (plan.files.length) {
    for (const file of plan.files) {
      console.log(`  ${ACTION_LABEL[file.action].padEnd(19)} ${file.path}`);
    }
    console.log();
  } else {
    logger.info("Nothing to emit: no instructions were selected for these targets.");
    console.log();
  }

  if (fidelity.length) {
    logger.title("Fidelity");
    console.log(formatHuman(fidelity, { showSummary: false }));
    console.log();
  }

  if (plan.diagnostics.length) {
    console.log(formatHuman(plan.diagnostics, { showSummary: false }));
    console.log();
  }

  if (options.check) {
    if (drift.length) {
      logger.warn(
        `${drift.length} file${drift.length === 1 ? "" : "s"} out of date. Run \`agentfile compile\` to update.`,
      );
      console.log();
      process.exit(1);
    }
    logger.success("Compiled output is up to date.");
    console.log();
    if (refused.length) process.exit(1);
    return;
  }

  const written = applyCompilationAndManifest(plan, root, drift.length > 0);
  if (written.length) {
    logger.success(
      `${written.length} file${written.length === 1 ? "" : "s"} written. Manifest updated: ${MANIFEST_FILE}`,
    );
  } else {
    logger.success("Everything already up to date.");
  }
  console.log();

  if (refused.length) process.exit(1);
}

/** Writes the plan and records ownership, so the next compile may update these files. */
function applyCompilationAndManifest(plan: CompilationPlan, root: string, changed: boolean): string[] {
  const written = applyCompilation(plan, root);
  if (!written.length && !changed) return written;

  const ownedFiles = new Map<string, { content: string; source: string }>();
  for (const file of plan.files) {
    if (file.action === "refused") continue;
    ownedFiles.set(file.path, { content: file.content, source: file.source });
  }

  writeManifest(root, buildManifest(ownedFiles, readManifest(root)));
  return written;
}
