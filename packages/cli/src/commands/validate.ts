/// <reference types="node" />

/**
 * `agentfile validate` — strict deterministic validation.
 *
 * This command predates the v2 layers and is wired into generated CI workflows,
 * so its existing behaviour is preserved exactly: when `ai/contract.yaml` is
 * present it is validated first and reported in the same words, and a schema
 * failure is still a hard stop with exit code 1. What follows is additive — the
 * full rule set over whatever else the repository configures.
 *
 * The one intentional tightening: findings from beyond the contract can now fail
 * the build. Every error-severity code is a real defect (a file that will not
 * parse, a reference to a file that does not exist), and generation does not skip
 * those — it silently produces empty content instead. See CHANGELOG.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  IMPLEMENTED_LAYERS,
  KNOWN_TARGETS,
  RULES,
  runValidation,
  type TargetId,
  validateContract,
} from "@agentfile/core";
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

export interface ValidateOptions {
  root?: string;
  format?: string;
  /** Targets to check compatibility against, or `all`. */
  target?: string[];
  /** Treat warnings as errors. */
  strict?: boolean;
  /** Fail when warnings exceed this count. Falls back to agentfile.yaml. */
  maxWarnings?: string;
  /**
   * Honour `agentfile-disable` directives. Commander sets this false for
   * `--no-suppressions`, which is the "show me what we chose to ignore" view.
   */
  suppressions?: boolean;
  /** Print the rule set and exit. */
  listRules?: boolean;
}

/** Prints the rule set, so what runs is inspectable rather than folklore. */
function listRules(): void {
  logger.title("agentfile validation rules");

  const width = Math.max(...RULES.map((rule) => rule.id.length));
  for (const rule of RULES) {
    console.log(`  ${chalk.cyan(rule.id.padEnd(width))}  ${chalk.gray(rule.layer.padEnd(13))} ${rule.description}`);
    console.log(`  ${" ".repeat(width)}  ${chalk.gray(rule.emits.join(", "))}`);
  }

  console.log();
  logger.info(chalk.gray("check runs structural and resolution; lint runs quality; validate runs all of them."));
  console.log();
}

/**
 * Resolves `--target`.
 *
 * Unknown targets are reported rather than silently skipped: a typo in a CI flag
 * that quietly checks nothing is worse than a failed run.
 */
function resolveTargets(requested: readonly string[] | undefined): TargetId[] | null {
  if (!requested?.length) return [];
  if (requested.includes("all")) return [...KNOWN_TARGETS];

  const unknown = requested.filter((target) => !KNOWN_TARGETS.includes(target));
  if (unknown.length) {
    logger.error(
      `Unknown target${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. ` +
        `Known targets: ${KNOWN_TARGETS.join(", ")}, or "all".`,
    );
    return null;
  }

  return [...new Set(requested)].sort();
}

/**
 * The v1 contract check, unchanged.
 *
 * Returns false when the run must stop: a contract that does not satisfy its
 * schema cannot be reasoned about, and the old command's contract was to fail
 * immediately and say why.
 */
function validateContractFirst(root: string, quiet: boolean): boolean {
  const contractPath = join(root, "ai", "contract.yaml");
  const hasAiDirectory = existsSync(join(root, "ai"));

  // A repository that has never used agentfile has no contract to validate, and
  // that is not a failure — the rest of the run covers whatever it does have.
  if (!hasAiDirectory && !existsSync(contractPath)) return true;

  try {
    const contract = validateContract({ contractPath });
    if (quiet) return true;

    logger.success(`contract.yaml is valid (version ${contract.version})`);
    logger.success(`Project: ${contract.project.name}`);
    logger.success(`Stack:   ${contract.project.stack.join(", ")}`);

    const ruleCount = (Object.values(contract.rules) as string[][]).reduce((sum, rules) => sum + rules.length, 0);
    logger.success(`Rules:   ${ruleCount} total across ${Object.keys(contract.rules).length} categories`);
    console.log();

    return true;
  } catch (err) {
    if (!quiet) {
      logger.error((err as Error).message);
      console.log();
    }
    return false;
  }
}

export async function validateCommand(options: ValidateOptions = {}): Promise<void> {
  if (options.listRules) {
    listRules();
    return;
  }

  const format = parseFormat(options.format);
  if (!format) return rejectFormat(options.format as string);

  const targets = resolveTargets(options.target);
  if (targets === null) {
    process.exit(1);
    return;
  }

  const root = options.root ?? process.cwd();
  const json = format === "json";

  if (!json) logger.title("agentfile validate");

  if (!validateContractFirst(root, json)) {
    if (json) {
      printJson({
        root,
        command: "validate",
        contractValid: false,
        message: "ai/contract.yaml does not satisfy its schema",
      });
    }
    process.exit(1);
    return;
  }

  const result = runValidation({
    root,
    layers: IMPLEMENTED_LAYERS,
    targets,
    strict: options.strict,
    suppressions: options.suppressions,
  });

  const maxWarnings = resolveMaxWarnings(options.maxWarnings, result);
  if (maxWarnings === null) {
    logger.error(`Invalid --max-warnings "${options.maxWarnings}". Expected a whole number of warnings, or 0.`);
    process.exit(1);
    return;
  }

  if (json) {
    printJson(
      validationEnvelope("validate", root, result, {
        contractValid: true,
        layers: [...IMPLEMENTED_LAYERS],
        targets,
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

  if (!result.discovery.configuration.sources.length) {
    logger.error("No agent configuration found.");
    console.log();
    logger.info("agentfile looks for ai/contract.yaml, AGENTS.md, CLAUDE.md, .claude/,");
    logger.info(".cursor/, .github/copilot-instructions.md, and .mcp.json.");
    console.log();
    logger.info("Run `agentfile init` to create a contract, or `agentfile doctor` to see");
    logger.info("what a repository would need for agentfile to have something to read.");
    console.log();
    process.exit(1);
    return;
  }

  // The title was printed before the contract check, which has to come first to
  // preserve the v1 output order.
  printHeader({
    command: "validate",
    root,
    filesScanned: result.discovery.scan.files.length,
    directoriesSkipped: result.discovery.scan.ignored.length,
    titled: false,
  });

  if (targets.length) {
    logger.info(`checking compatibility against ${chalk.cyan(targets.join(", "))}`);
    console.log();
  }

  printCoverageGaps(result);
  printFindings(result, { strict: options.strict });
  printSuppressed(result);
  exitOnFindings(result, maxWarnings);
}
