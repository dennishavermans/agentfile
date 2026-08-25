/// <reference types="node" />

/**
 * Shared reporting for the commands that report findings.
 *
 * `check`, `validate`, and `lint` differ in which rules they select and nothing
 * else. Formatting, the summary line, and the exit code all live here so the
 * three cannot disagree about what a warning looks like or when a build fails.
 */

import { buildReport, formatHuman, hasErrors, type ValidationResult } from "@agentfile/core";
import chalk from "chalk";
import { logger } from "./logger.js";

export type OutputFormat = "human" | "json";

/** Parses `--format`. Returns undefined for anything unrecognised. */
export function parseFormat(value: string | undefined): OutputFormat | undefined {
  if (value === undefined) return "human";
  if (value === "human" || value === "json") return value;
  return undefined;
}

/** Reports an unknown `--format` and exits, so no command has to guess. */
export function rejectFormat(value: string): void {
  logger.error(`Unknown format "${value}". Supported formats: human, json.`);
  process.exit(1);
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
