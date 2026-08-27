/// <reference types="node" />

/**
 * `agentfile doctor` — analyse whatever agent configuration a repository
 * already has.
 *
 * This runs on repositories that have never used agentfile, which is the point:
 * it has to be useful before anyone adopts anything. It reads, it reports, and
 * it changes nothing on disk. No network, no model calls, and no executing
 * anything it finds.
 */

import {
  alwaysLoadedContext,
  analyzeSkillRouting,
  configuredDirectories,
  type Diagnostic,
  type DiscoveryResult,
  discover,
  findInstructionOverlap,
  formatHuman,
  formatJson,
  hasErrors,
  overlapDiagnostics,
  repositoryResolutionDiagnostics,
  resolveForPath,
  summarize,
  validateSkills,
} from "@agentfile/core";
import chalk from "chalk";
import { logger } from "../logger.js";
import { EXIT_USAGE } from "../report.js";

export interface DoctorOptions {
  /** Directory to analyse. Defaults to the current working directory. */
  root?: string;
  /** `human` (default) or `json`. */
  format?: string;
  /** List every configuration file found, not just a per-platform summary. */
  verbose?: boolean;
}

/** Human-readable byte size. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Duplicate detection across the whole repository.
 *
 * Both halves come from core, which is what keeps `doctor` and `check` from
 * disagreeing about what counts as duplication: declared rules that co-apply at
 * some path, and text repeated between instruction files.
 */
function repositoryWideDiagnostics(result: DiscoveryResult): Diagnostic[] {
  return [
    ...repositoryResolutionDiagnostics(result.configuration),
    ...overlapDiagnostics(findInstructionOverlap(result.configuration.instructions)),
    // Specification breaches in a skill are errors that nothing else in the
    // toolchain reports, so they belong in the first command anyone runs.
    ...validateSkills(result.configuration),
  ];
}

function reportInventory(result: DiscoveryResult, verbose: boolean): void {
  const { sources } = result.configuration;

  if (!sources.length) {
    logger.warn("No agent configuration found.");
    console.log();
    logger.info("Nothing to analyse yet. agentfile looks for files such as:");
    logger.info("  AGENTS.md, CLAUDE.md, .claude/rules/, .claude/skills/, .claude/commands/,");
    logger.info("  .cursor/rules/, .cursor/commands/, .github/copilot-instructions.md, .mcp.json");
    console.log();
    logger.info("Run `agentfile init` to start from a contract instead.");
    return;
  }

  logger.title("Configuration found");

  if (verbose) {
    const width = Math.max(...sources.map((source) => source.path.length));
    for (const source of sources) {
      const size = source.bytes === undefined ? "" : formatBytes(source.bytes);
      console.log(
        `  ${chalk.gray(source.platform.padEnd(10))} ${source.path.padEnd(width)}  ${chalk.gray(
          source.kind.padEnd(18),
        )} ${chalk.gray(size)}`,
      );
    }
    console.log();
    return;
  }

  // Grouped by platform, so a monorepo with fifty rule files stays readable.
  const byPlatform = new Map<string, { files: number; bytes: number; kinds: Set<string> }>();
  for (const source of sources) {
    const entry = byPlatform.get(source.platform) ?? { files: 0, bytes: 0, kinds: new Set<string>() };
    entry.files++;
    entry.bytes += source.bytes ?? 0;
    entry.kinds.add(source.kind);
    byPlatform.set(source.platform, entry);
  }

  for (const [platform, entry] of [...byPlatform].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(
      `  ${chalk.cyan(platform.padEnd(12))} ${formatCount(entry.files, "file").padEnd(10)} ${formatBytes(
        entry.bytes,
      ).padEnd(10)} ${chalk.gray([...entry.kinds].sort().join(", "))}`,
    );
  }
  console.log();
}

function reportContextBudget(result: DiscoveryResult): void {
  const always = alwaysLoadedContext(result.configuration);
  if (!always.instructions.length && !always.alwaysLoadedDirectives) return;

  logger.title("Always-loaded context");

  const { estimate } = always;
  logger.info(
    `${formatCount(always.files.length, "file")}, ${formatBytes(estimate.characters)}, ` +
      `${formatCount(estimate.lines, "line")}`,
  );
  logger.info(`roughly ${estimate.estimatedTokens.toLocaleString("en-US")} tokens ${chalk.gray("(estimated)")}`);

  if (always.alwaysLoadedDirectives) {
    logger.info(`${formatCount(always.alwaysLoadedDirectives, "rule")} apply everywhere`);
  }

  console.log();
  logger.info(
    chalk.gray(
      "Token counts are estimated from character length, not measured with a\n" +
        "  target tokenizer. Treat them as a relative signal, not an exact figure.",
    ),
  );
  console.log();
}

function reportScopes(result: DiscoveryResult): void {
  const directories = configuredDirectories(result.configuration);
  if (!directories.length) return;

  logger.title("Directory-scoped configuration");

  for (const directory of directories) {
    const effective = resolveForPath(result.configuration, `${directory}/probe`);
    logger.info(
      `${chalk.cyan(directory)} — ${formatCount(effective.instructions.length, "instruction")}, ` +
        `${formatCount(effective.directives.length, "rule")}, ` +
        `${formatCount(effective.skills.length, "skill")} available`,
    );
  }

  console.log();
}

function reportSkillRouting(result: DiscoveryResult): void {
  const signals = analyzeSkillRouting(result.configuration).filter((signal) => signal.problems.length);
  if (!signals.length) return;

  logger.title("Skill routing metadata");

  for (const signal of signals) {
    logger.warn(`${signal.name} ${chalk.gray(`(${signal.file})`)}`);
    for (const problem of signal.problems) {
      logger.info(`  ${problem.message}`);
    }
  }

  console.log();
  logger.info(
    chalk.gray(
      "This measures description quality, not model behaviour. A good description\n" +
        "  makes correct routing likely; it does not guarantee it.",
    ),
  );
  console.log();
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  const root = options.root ?? process.cwd();
  const format = options.format ?? "human";

  if (format !== "human" && format !== "json") {
    logger.error(`Unknown format "${format}". Supported formats: human, json.`);
    process.exit(EXIT_USAGE);
    return;
  }

  const result = discover({ root });
  const diagnostics = [...result.diagnostics, ...repositoryWideDiagnostics(result)];

  if (format === "json") {
    const always = alwaysLoadedContext(result.configuration);
    process.stdout.write(
      `${JSON.stringify(
        {
          root,
          hasContract: result.hasContract,
          platforms: result.platforms,
          sources: result.configuration.sources,
          scan: {
            files: result.scan.files.length,
            ignored: result.scan.ignored,
            truncated: result.scan.truncated,
          },
          alwaysLoadedContext: {
            files: always.files,
            characters: always.estimate.characters,
            lines: always.estimate.lines,
            estimatedTokens: always.estimate.estimatedTokens,
            estimateMethod: always.estimate.method,
            alwaysLoadedDirectives: always.alwaysLoadedDirectives,
          },
          skillRouting: analyzeSkillRouting(result.configuration),
          report: JSON.parse(formatJson(diagnostics)),
        },
        null,
        2,
      )}\n`,
    );

    if (hasErrors(diagnostics)) process.exit(1);
    return;
  }

  logger.title("agentfile doctor");
  logger.info(`${root}`);
  logger.info(
    chalk.gray(
      `scanned ${formatCount(result.scan.files.length, "file")}` +
        (result.scan.ignored.length
          ? `, skipped ${formatCount(result.scan.ignored.length, "directory", "directories")}`
          : ""),
    ),
  );
  console.log();

  reportInventory(result, options.verbose ?? false);

  if (!result.configuration.sources.length) {
    return;
  }

  reportContextBudget(result);
  reportScopes(result);
  reportSkillRouting(result);

  if (diagnostics.length) {
    logger.title("Problems");
    console.log(formatHuman(diagnostics, { showSummary: false }));
    console.log();
  }

  const counts = summarize(diagnostics);
  if (counts.total === 0) {
    logger.success("No problems found.");
  } else {
    const parts = [
      counts.errors ? `${formatCount(counts.errors, "error")}` : "",
      counts.warnings ? `${formatCount(counts.warnings, "warning")}` : "",
      counts.infos ? `${counts.infos} info` : "",
    ].filter(Boolean);
    logger.warn(parts.join(", "));
  }

  console.log();

  if (hasErrors(diagnostics)) {
    process.exit(1);
  }
}
