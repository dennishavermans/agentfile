/// <reference types="node" />

/**
 * `agentfile check` — fast deterministic validation.
 *
 * Built for the inner loop: pre-commit hooks, editors, and a developer who runs
 * it between edits. That budget is what decides the rule selection. Structural
 * and resolution checks are set operations over data the scan already produced,
 * so they cost one filesystem walk and nothing else. Quality analysis compares
 * text pairwise, which is cheap but not free, so it lives in `lint`.
 *
 * No network. No model. Nothing found in the repository is executed.
 */

import { CHECK_LAYERS, runValidation } from "@agentfile/core";
import { logger } from "../logger.js";
import {
  exitOnFindings,
  parseFormat,
  printCoverageGaps,
  printFindings,
  printHeader,
  printJson,
  printSarif,
  printSuppressed,
  rejectFormat,
  resolveMaxWarnings,
  validationEnvelope,
} from "../report.js";

export interface CheckOptions {
  /** Directory to check instead of the current working directory. */
  root?: string;
  /** `human` (default) or `json`. */
  format?: string;
  /** Treat warnings as errors. */
  strict?: boolean;
  /** Fail when warnings exceed this count. Falls back to agentfile.yaml. */
  maxWarnings?: string;
  /**
   * Honour `agentfile-disable` directives. Commander sets this false for
   * `--no-suppressions`, which is the "show me what we chose to ignore" view.
   */
  suppressions?: boolean;
}

export async function checkCommand(options: CheckOptions = {}): Promise<void> {
  const format = parseFormat(options.format);
  if (!format) return rejectFormat(options.format as string);

  const root = options.root ?? process.cwd();
  const result = runValidation({
    root,
    layers: CHECK_LAYERS,
    strict: options.strict,
    suppressions: options.suppressions,
  });

  const maxWarnings = resolveMaxWarnings(options.maxWarnings, result);
  if (maxWarnings === null) {
    logger.error(`Invalid --max-warnings "${options.maxWarnings}". Expected a whole number of warnings, or 0.`);
    process.exit(1);
    return;
  }

  if (format === "json") {
    printJson(
      validationEnvelope("check", root, result, {
        layers: [...CHECK_LAYERS],
        strict: options.strict === true,
      }),
    );
    exitOnFindings(result, maxWarnings);
    return;
  }

  if (format === "sarif") {
    printSarif(result);
    exitOnFindings(result, maxWarnings);
    return;
  }

  printHeader({
    command: "check",
    root,
    filesScanned: result.discovery.scan.files.length,
    directoriesSkipped: result.discovery.scan.ignored.length,
  });

  if (!result.discovery.configuration.sources.length) {
    logger.warn("No agent configuration found, so there was nothing to check.");
    console.log();
    logger.info("Run `agentfile doctor` to see what agentfile looks for.");
    console.log();
    return;
  }

  printCoverageGaps(result);
  printFindings(result, { strict: options.strict });
  printSuppressed(result);
  exitOnFindings(result, maxWarnings);
}
