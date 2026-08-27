/// <reference types="node" />

/**
 * `agentfile rule [code]` — what a diagnostic code means.
 *
 * A code in a CI log is only useful if the reader can find out what it is
 * without leaving the terminal. Ruff has `ruff rule E501` and ESLint prints a
 * documentation link with every finding; this is the same affordance, served
 * from the registry that produces the codes, so it cannot describe a code that
 * does not exist or miss one that does.
 */

import { allDiagnosticCodes, type DiagnosticCode, diagnosticMeta, docsUrlFor } from "@agentfile/core";
import chalk from "chalk";
import { logger } from "../logger.js";
import { EXIT_USAGE, parseFindingFormat, printJson, rejectFormat } from "../report.js";

export interface RuleOptions {
  /** `human` (default) or `json`. */
  format?: string;
}

const SEVERITY_COLOUR = {
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.blue,
} as const;

function describe(code: DiagnosticCode): Record<string, string> {
  const meta = diagnosticMeta(code);
  return {
    code,
    name: meta.name,
    title: meta.title,
    band: meta.band,
    defaultSeverity: meta.defaultSeverity,
    status: meta.status,
    documentation: docsUrlFor(code),
  };
}

export async function ruleCommand(code: string | undefined, options: RuleOptions = {}): Promise<void> {
  const format = parseFindingFormat(options.format);
  if (!format) return rejectFormat(options.format as string, ["human", "json"]);

  const codes = allDiagnosticCodes();

  // ─── The whole registry ──────────────────────────────────────────────────
  if (!code) {
    if (format === "json") {
      printJson({ root: process.cwd(), command: "rule", rules: codes.map(describe) });
      return;
    }

    logger.title("agentfile diagnostic codes");
    console.log();

    let band = "";
    for (const entry of codes) {
      const meta = diagnosticMeta(entry);
      if (meta.band !== band) {
        band = meta.band;
        console.log(`  ${chalk.gray(band)}`);
      }
      const colour = SEVERITY_COLOUR[meta.defaultSeverity];
      const reserved = meta.status === "reserved" ? chalk.gray(" (reserved)") : "";
      console.log(`    ${chalk.cyan(entry)}  ${colour(meta.defaultSeverity.padEnd(7))} ${meta.title}${reserved}`);
    }

    console.log();
    logger.info(chalk.gray("Run `agentfile rule AGF302` for one code in full."));
    console.log();
    return;
  }

  // ─── One code ────────────────────────────────────────────────────────────
  const wanted = code.toUpperCase();
  if (!(codes as string[]).includes(wanted)) {
    logger.error(`Unknown diagnostic code "${code}".`);
    console.log();
    // A mistyped digit is the likely case, so point at the neighbours rather
    // than printing thirty codes.
    const band = wanted.slice(0, 4);
    const nearby = codes.filter((entry) => entry.startsWith(band));
    if (nearby.length) {
      logger.info(`Codes in the ${band}xx band: ${nearby.join(", ")}`);
    } else {
      logger.info("Run `agentfile rule` to list every code.");
    }
    console.log();
    process.exit(EXIT_USAGE);
    return;
  }

  const entry = wanted as DiagnosticCode;
  const meta = diagnosticMeta(entry);

  if (format === "json") {
    printJson({ root: process.cwd(), command: "rule", ...describe(entry) });
    return;
  }

  logger.title(`${entry} ${meta.name}`);
  console.log();
  console.log(`  ${meta.title}`);
  console.log();
  console.log(`  ${chalk.gray("band")}      ${meta.band}`);
  console.log(
    `  ${chalk.gray("severity")}  ${SEVERITY_COLOUR[meta.defaultSeverity](meta.defaultSeverity)} ${chalk.gray("by default")}`,
  );
  console.log(`  ${chalk.gray("status")}    ${meta.status}`);
  console.log();
  logger.info(chalk.gray(docsUrlFor(entry)));
  console.log();

  if (meta.status === "reserved") {
    logger.info(chalk.gray("This code is registered but nothing emits it yet."));
    console.log();
    return;
  }

  logger.info(
    chalk.gray(
      `Change its severity, or turn it off, in agentfile.yaml:\n\n` +
        `    severity:\n      ${entry}: warning\n\n` +
        `  Or silence one occurrence where it is deliberate:\n\n` +
        `    <!-- agentfile-disable-next-line ${entry} reason -->`,
    ),
  );
  console.log();
}
