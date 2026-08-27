/// <reference types="node" />

/**
 * `agentfile audit` — security and trust analysis.
 *
 * The output is shaped around the three commitments this analysis makes, because
 * a security report that overstates what it checked is worse than no report:
 *
 *   • it names every surface it covered, and how much of each was there
 *   • it names every file it could not read
 *   • it never says "safe" — a clean result says what it means instead
 *
 * Nothing found in the repository is executed. Skills, hooks, scripts, and MCP
 * configuration are read as text.
 */

import {
  applySuppressions,
  auditConfiguration,
  discover,
  formatHuman,
  hasErrors,
  NO_FINDINGS_CAVEAT,
  nodeFileSystem,
  sortDiagnostics,
  summarize,
} from "@agentfile/core";
import chalk from "chalk";
import { logger } from "../logger.js";
import { parseFormat, printJson, rejectFormat } from "../report.js";

export interface AuditOptions {
  /** Directory to audit instead of the current working directory. */
  root?: string;
  /** `human` (default) or `json`. */
  format?: string;
  /** Treat warnings as errors. */
  strict?: boolean;
  /**
   * Honour `agentfile-disable` directives. Commander sets this false for
   * `--no-suppressions`, which is the "show me what we chose to ignore" view.
   */
  suppressions?: boolean;
  /** Include the informational findings, which are recorded rather than raised. */
  all?: boolean;
}

function wrap(text: string, width = 74, indent = "  "): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);

  return lines.map((entry) => indent + entry).join("\n");
}

export async function auditCommand(options: AuditOptions = {}): Promise<void> {
  const format = parseFormat(options.format);
  if (!format) return rejectFormat(options.format as string);

  const root = options.root ?? process.cwd();
  const discovery = discover({ root });

  const result = auditConfiguration(discovery.configuration, {
    root,
    fs: nodeFileSystem,
    files: discovery.scan.files,
  });

  // Directives silence what a team has reviewed and accepted. Applied before
  // the informational filter and before --strict, so an accepted finding is
  // never promoted into a build failure.
  const suppression =
    options.suppressions === false
      ? { diagnostics: result.diagnostics, suppressed: [], unused: [] }
      : applySuppressions(result.diagnostics, {
          root,
          fs: nodeFileSystem,
          files: discovery.configuration.sources.map((source) => source.path),
        });
  const audited = [...suppression.diagnostics, ...suppression.unused];

  // Informational findings record what a skill or hook reaches out to. They are
  // useful context and terrible noise, so they are opt-in.
  const shown = options.all ? audited : audited.filter((item) => item.severity !== "info");
  const withdrawn = audited.length - shown.length;

  const promoted = options.strict
    ? shown.map((item) => (item.severity === "warning" ? { ...item, severity: "error" as const } : item))
    : shown;

  const diagnostics = sortDiagnostics(promoted);
  const counts = summarize(diagnostics);

  if (format === "json") {
    printJson({
      root,
      command: "audit",
      strict: options.strict === true,
      surfaces: result.surfaces,
      inspectedFiles: result.inspectedFiles,
      skippedFiles: result.skippedFiles,
      informationalWithheld: options.all ? 0 : withdrawn,
      suppressed: suppression.suppressed.map((entry) => ({
        code: entry.diagnostic.code,
        message: entry.diagnostic.message,
        file: entry.file,
        line: entry.diagnostic.location?.line,
        directive: {
          scope: entry.directive.scope,
          codes: entry.directive.codes,
          line: entry.directive.line,
          reason: entry.directive.reason,
        },
      })),
      caveat: NO_FINDINGS_CAVEAT,
      report: {
        version: 1,
        summary: counts,
        diagnostics,
      },
    });

    if (hasErrors(diagnostics)) process.exit(1);
    return;
  }

  logger.title("agentfile audit");
  logger.info(root);
  console.log();

  if (!discovery.configuration.sources.length) {
    logger.warn("No agent configuration found, so there was nothing to audit.");
    console.log();
    logger.info("Run `agentfile doctor` to see what agentfile looks for.");
    console.log();
    return;
  }

  // ─── What was covered ────────────────────────────────────────────────────
  logger.title("Surfaces analysed");

  for (const surface of result.surfaces) {
    const count = surface.analysed;
    const label = count === 0 ? chalk.gray("none present") : `${count}`;
    console.log(`  ${chalk.cyan(surface.name.padEnd(14))} ${label.padEnd(14)} ${chalk.gray(surface.description)}`);
  }

  console.log();
  if (result.inspectedFiles.length) {
    logger.info(
      chalk.gray(
        `${result.inspectedFiles.length} bundled file${result.inspectedFiles.length === 1 ? "" : "s"} read as text. ` +
          "Nothing was executed.",
      ),
    );
  } else {
    logger.info(chalk.gray("No bundled scripts to read."));
  }
  console.log();

  // ─── What was not covered ────────────────────────────────────────────────
  if (result.skippedFiles.length) {
    logger.title("Not analysed");
    for (const skipped of result.skippedFiles) {
      logger.info(`${skipped.file} ${chalk.gray(`— ${skipped.reason}`)}`);
    }
    console.log();
  }

  // ─── Findings ────────────────────────────────────────────────────────────
  if (diagnostics.length) {
    logger.title("Findings");
    console.log(formatHuman(diagnostics, { showSummary: false }));
    console.log();
  }

  if (counts.total === 0) {
    logger.success("No findings.");
  } else {
    const parts = [
      counts.errors ? `${counts.errors} error${counts.errors === 1 ? "" : "s"}` : "",
      counts.warnings ? `${counts.warnings} warning${counts.warnings === 1 ? "" : "s"}` : "",
      counts.infos ? `${counts.infos} info` : "",
    ].filter(Boolean);
    logger.warn(
      parts.join(", ") + (options.strict && counts.errors ? chalk.gray(" (warnings promoted by --strict)") : ""),
    );
  }

  if (suppression.suppressed.length) {
    const count = suppression.suppressed.length;
    console.log();
    logger.info(
      chalk.gray(
        `${count} finding${count === 1 ? "" : "s"} suppressed by agentfile-disable ` +
          `directive${count === 1 ? "" : "s"} in the configuration.`,
      ),
    );
  }

  if (withdrawn > 0) {
    console.log();
    logger.info(
      chalk.gray(
        `${withdrawn} informational finding${withdrawn === 1 ? "" : "s"} withheld — these record what the ` +
          "configuration reaches out to rather than flagging a problem. Run with --all to see them.",
      ),
    );
  }

  // ─── What this does not mean ─────────────────────────────────────────────
  console.log();
  logger.info(chalk.gray(wrap(NO_FINDINGS_CAVEAT)));
  console.log();

  if (hasErrors(diagnostics)) process.exit(1);
}
