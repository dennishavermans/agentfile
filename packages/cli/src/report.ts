/// <reference types="node" />

/**
 * Shared reporting for the commands that report findings.
 *
 * `check`, `validate`, and `lint` differ in which rules they select and nothing
 * else. Formatting, the summary line, and the exit code all live here so the
 * three cannot disagree about what a warning looks like or when a build fails.
 */

import {
  buildReport,
  type Diagnostic,
  formatHuman,
  formatSarif,
  hasErrors,
  type ValidationResult,
} from "@agentfile/core";
import chalk from "chalk";
import { logger } from "./logger.js";
import { VERSION } from "./version.js";

export type OutputFormat = "human" | "json" | "sarif";

/** Formats every reporting command accepts. */
const FORMATS: readonly OutputFormat[] = ["human", "json", "sarif"];

/** Parses `--format`. Returns undefined for anything unrecognised. */
export function parseFormat(value: string | undefined): OutputFormat | undefined {
  if (value === undefined) return "human";
  return (FORMATS as readonly string[]).includes(value) ? (value as OutputFormat) : undefined;
}

/**
 * Parses `--format` where SARIF makes no sense.
 *
 * SARIF describes findings against source locations. A command whose output is
 * a plan or an inventory rather than a list of findings has nothing to put in
 * one, and emitting an empty-but-valid log would be worse than refusing.
 */
export function parseFindingFormat(value: string | undefined): Exclude<OutputFormat, "sarif"> | undefined {
  const format = parseFormat(value);
  return format === "sarif" ? undefined : format;
}

/**
 * Exit code for "agentfile could not run", as opposed to "agentfile ran and
 * found something".
 *
 * The distinction is load-bearing for CI: exit 1 is a fact about the
 * repository, exit 2 is a fact about the invocation or the tool. A pipeline
 * that treats them alike reports a mistyped flag as a failing codebase. Same
 * convention as `prettier --check`.
 */
export const EXIT_USAGE = 2;

/** Reports a bad invocation and exits 2. */
export function usageError(message: string, ...detail: string[]): void {
  logger.error(message);
  for (const line of detail) logger.info(line);
  process.exit(EXIT_USAGE);
}

/** Reports an unknown `--format` and exits, so no command has to guess. */
export function rejectFormat(value: string, supported: readonly string[] = FORMATS): void {
  usageError(`Unknown format "${value}". Supported formats: ${supported.join(", ")}.`);
}

/** Writes the SARIF log for a run. */
export function printSarif(result: ValidationResult): void {
  printSarifDiagnostics(result.diagnostics);
}

/** Writes a SARIF log for findings that did not come from the validation pipeline. */
export function printSarifDiagnostics(diagnostics: readonly Diagnostic[]): void {
  process.stdout.write(formatSarif(diagnostics, { version: VERSION }));
}

export interface HeaderOptions {
  command: string;
  root: string;
  filesScanned: number;
  directoriesSkipped: number;
  /** Print the command title. False when the caller already printed one. */
  titled?: boolean;
}

export function printHeader(options: HeaderOptions): void {
  if (options.titled !== false) logger.title(`agentfile ${options.command}`);
  else console.log();
  logger.info(options.root);
  logger.info(
    chalk.gray(
      `scanned ${options.filesScanned} file${options.filesScanned === 1 ? "" : "s"}` +
        (options.directoriesSkipped
          ? `, skipped ${options.directoriesSkipped} director${options.directoriesSkipped === 1 ? "y" : "ies"}`
          : ""),
    ),
  );
  console.log();
}

/**
 * What a run could not check.
 *
 * A rule that was selected but could not do its work, or a layer with no rules
 * yet, is reported rather than silently contributing zero findings — "no
 * problems found" has to mean the checks ran.
 */
export function printCoverageGaps(result: ValidationResult): void {
  if (!result.skipped.length && !result.emptyLayers.length) return;

  logger.title("Not checked");

  for (const skip of result.skipped) {
    logger.info(`${chalk.yellow(skip.rule)} — ${skip.reason}`);
  }
  for (const layer of result.emptyLayers) {
    logger.info(`${chalk.yellow(layer)} — this layer has no rules yet`);
  }

  console.log();
}

export interface SummaryOptions {
  /** Said when there is nothing to report. */
  cleanMessage?: string;
  /** Mention that warnings were promoted. */
  strict?: boolean;
}

/**
 * Reports what a directive silenced.
 *
 * Printed even on a clean run. "No problems found" next to a silent count of
 * fifteen suppressed findings would be technically true and actively
 * misleading, which is the failure mode every suppression mechanism invites.
 */
export function printSuppressed(result: ValidationResult): void {
  if (!result.suppressed.length) return;

  const count = result.suppressed.length;
  logger.info(
    chalk.gray(
      `${count} finding${count === 1 ? "" : "s"} suppressed by agentfile-disable ` +
        `directive${count === 1 ? "" : "s"} in the configuration.`,
    ),
  );
  console.log();
}

export function printFindings(result: ValidationResult, options: SummaryOptions = {}): void {
  if (result.diagnostics.length) {
    logger.title("Problems");
    console.log(formatHuman(result.diagnostics, { showSummary: false }));
    console.log();
  }

  const { errors, warnings, infos, total } = result.summary;

  if (total === 0) {
    logger.success(options.cleanMessage ?? "No problems found.");
  } else {
    const parts = [
      errors ? `${errors} error${errors === 1 ? "" : "s"}` : "",
      warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "",
      infos ? `${infos} info` : "",
    ].filter(Boolean);

    const suffix = options.strict && errors ? chalk.gray(" (warnings promoted by --strict)") : "";
    logger.warn(parts.join(", ") + suffix);
  }

  console.log();
}

export interface JsonEnvelope {
  root: string;
  command: string;
  [key: string]: unknown;
}

/**
 * Machine-readable output for a validation run.
 *
 * The findings sit in the same versioned `report` envelope every other command
 * emits, so one consumer can read all of them. Per-command detail — which rules
 * ran, which targets were checked — sits alongside it rather than inside it.
 */
export function validationEnvelope(
  command: string,
  root: string,
  result: ValidationResult,
  extra: Record<string, unknown> = {},
): JsonEnvelope {
  return {
    root,
    command,
    rulesRun: result.rulesRun,
    skipped: result.skipped,
    emptyLayers: result.emptyLayers,
    ...extra,
    suppressed: result.suppressed.map((entry) => ({
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
    report: buildReport(result.diagnostics),
  };
}

export function printJson(envelope: JsonEnvelope): void {
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

/** Exits 1 when anything reached error severity. Called last, after output. */
export function exitOnErrors(result: ValidationResult): void {
  if (hasErrors(result.diagnostics)) process.exit(1);
}

/**
 * The exit decision, including the warning ceiling.
 *
 * `--max-warnings` is the ratchet a team uses to stop a warning count growing
 * while they work it down. It is separate from `--strict`, which promotes every
 * warning to an error at once: the ceiling lets a repository hold a line
 * without pretending the remaining warnings are failures.
 */
export function exitOnFindings(result: ValidationResult, maxWarnings?: number): void {
  if (hasErrors(result.diagnostics)) process.exit(1);

  if (maxWarnings !== undefined && result.summary.warnings > maxWarnings) {
    const count = result.summary.warnings;
    logger.error(`${count} warning${count === 1 ? "" : "s"} exceeds the maximum of ${maxWarnings}.`);
    console.log();
    process.exit(1);
  }
}

/**
 * Reads `--max-warnings`, falling back to the setting in `agentfile.yaml`.
 *
 * Returns `null` when the flag was given but is not a count, so the caller can
 * report the bad value rather than silently running without a ceiling.
 */
export function resolveMaxWarnings(value: string | undefined, result: ValidationResult): number | undefined | null {
  if (value === undefined) return result.config.maxWarnings;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}
