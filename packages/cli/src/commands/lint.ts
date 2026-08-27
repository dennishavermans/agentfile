/// <reference types="node" />

/**
 * `agentfile lint` — quality analysis.
 *
 * Separate from `check` because the questions are different in kind. `check`
 * asks whether the configuration is correct; `lint` asks whether it is any good:
 * has a rule been copied and then edited in one place only, is the
 * always-loaded context large enough to be worth trimming.
 *
 * Every finding here is deterministic and local. No embeddings, no model, no
 * network — the rework brief keeps those optional, and basic quality analysis
 * must not require them.
 */

import { DEFAULT_CONTEXT_BUDGET_TOKENS, LINT_LAYERS, NEAR_DUPLICATE_THRESHOLD, runValidation } from "@agentfile/core";
import chalk from "chalk";
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

export interface LintOptions {
  root?: string;
  format?: string;
  strict?: boolean;
  /** Fail when warnings exceed this count. Falls back to agentfile.yaml. */
  maxWarnings?: string;
  /**
   * Honour `agentfile-disable` directives. Commander sets this false for
   * `--no-suppressions`, which is the "show me what we chose to ignore" view.
   */
  suppressions?: boolean;
  /** Always-loaded context budget, in estimated tokens. */
  budget?: string;
  /** Near-duplicate similarity threshold, 0–1. */
  similarity?: string;
}

/** Parses a numeric option, reporting the bad value rather than defaulting past it. */
function numericOption(
  value: string | undefined,
  label: string,
  constraint: (parsed: number) => boolean,
  expected: string,
): number | undefined | null {
  if (value === undefined) return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !constraint(parsed)) {
    logger.error(`Invalid ${label} "${value}". Expected ${expected}.`);
    return null;
  }

  return parsed;
}

export async function lintCommand(options: LintOptions = {}): Promise<void> {
  const format = parseFormat(options.format);
  if (!format) return rejectFormat(options.format as string);

  const budgetTokens = numericOption(options.budget, "--budget", (value) => value > 0, "a positive number of tokens");
  if (budgetTokens === null) {
    process.exit(1);
    return;
  }

  const similarityThreshold = numericOption(
    options.similarity,
    "--similarity",
    (value) => value > 0 && value <= 1,
    "a number between 0 and 1",
  );
  if (similarityThreshold === null) {
    process.exit(1);
    return;
  }

  const root = options.root ?? process.cwd();
  const result = runValidation({
    root,
    layers: LINT_LAYERS,
    strict: options.strict,
    budgetTokens,
    similarityThreshold,
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
      validationEnvelope("lint", root, result, {
        layers: [...LINT_LAYERS],
        strict: options.strict === true,
        budgetTokens: budgetTokens ?? DEFAULT_CONTEXT_BUDGET_TOKENS,
        similarityThreshold: similarityThreshold ?? NEAR_DUPLICATE_THRESHOLD,
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
    command: "lint",
    root,
    filesScanned: result.discovery.scan.files.length,
    directoriesSkipped: result.discovery.scan.ignored.length,
  });

  if (!result.discovery.configuration.sources.length) {
    logger.warn("No agent configuration found, so there was nothing to analyse.");
    console.log();
    logger.info("Run `agentfile doctor` to see what agentfile looks for.");
    console.log();
    return;
  }

  printCoverageGaps(result);
  printFindings(result, { cleanMessage: "Nothing to improve.", strict: options.strict });
  printSuppressed(result);

  logger.info(
    chalk.gray(
      "Similarity is measured on words, not meaning: two rules that share wording\n" +
        "  are reported, and two that mean the same thing in different words are not.\n" +
        `  Context budget: ${(budgetTokens ?? DEFAULT_CONTEXT_BUDGET_TOKENS).toLocaleString("en-US")} estimated tokens (agentfile's default, not a platform limit).`,
    ),
  );
  console.log();

  exitOnFindings(result, maxWarnings);
}
