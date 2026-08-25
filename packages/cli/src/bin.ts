#!/usr/bin/env node
/// <reference types="node" />
import { Command } from "commander";
import { checkCommand } from "./commands/check.js";
import { cleanCommand } from "./commands/clean.js";
import { diffCommand } from "./commands/diff.js";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { lintCommand } from "./commands/lint.js";
import { migrateCommand } from "./commands/migrate.js";
import { rollbackCommand } from "./commands/rollback.js";
import { syncCommand } from "./commands/sync.js";
import { uiCommand } from "./commands/ui.js";
import { validateCommand } from "./commands/validate.js";
import { watchCommand } from "./commands/watch.js";

const program = new Command();

program.name("agentfile").description("Unified AI agent contract manager").version("0.4.0");

program.command("init").description("Scaffold a new agentfile setup in the current project").action(initCommand);

program
  .command("migrate")
  .description("Import existing agent instruction files into a draft ai/contract.yaml")
  .option(
    "--from <file>",
    "Source agent instruction file to migrate (repeatable)",
    (val: string, prev: string[]) => prev.concat(val),
    [] as string[],
  )
  .option("--dry-run", "Print the generated contract.yaml without writing it")
  .option("--output <path>", "Write the contract to a custom path instead of ai/contract.yaml")
  .option("--replace-policy <policy>", "What to do with source files after migration: keep, archive, or delete", "keep")
  .option("--targets <ides>", "Only migrate sources matching these IDE targets (comma-separated)", (val: string) =>
    val.split(",").map((s) => s.trim()),
  )
  .option("--exclude <ides>", "Exclude sources matching these IDE targets (comma-separated)", (val: string) =>
    val.split(",").map((s) => s.trim()),
  )
  .action(
    (options: {
      from: string[];
      dryRun?: boolean;
      output?: string;
      replacePolicy?: string;
      targets?: string[];
      exclude?: string[];
    }) =>
      migrateCommand({
        ...options,
        replacePolicy: options.replacePolicy as "keep" | "archive" | "delete" | undefined,
      }),
  );

program
  .command("sync")
  .description("Generate agent instruction files from ai/contract.yaml")
  .option("--dry-run", "Render templates without writing files")
  .action((options) => syncCommand({ dryRun: options.dryRun }));

program
  .command("doctor")
  .description("Analyse the AI agent configuration already present in this repository")
  .option("--root <path>", "Directory to analyse instead of the current working directory")
  .option("--format <format>", "Output format: human or json", "human")
  .option("--verbose", "List every configuration file found")
  .action((options: { root?: string; format?: string; verbose?: boolean }) => doctorCommand(options));

const collect = (val: string, prev: string[]) => prev.concat(val.split(",").map((s) => s.trim()));

program
  .command("check")
  .description("Fast deterministic validation, suitable for pre-commit hooks and editors")
  .option("--root <path>", "Directory to check instead of the current working directory")
  .option("--format <format>", "Output format: human or json", "human")
  .option("--strict", "Treat warnings as errors")
  .action((options: { root?: string; format?: string; strict?: boolean }) => checkCommand(options));

program
  .command("validate")
  .description("Strict deterministic validation across every layer (used in CI)")
  .option("--root <path>", "Directory to validate instead of the current working directory")
  .option("--format <format>", "Output format: human or json", "human")
  .option("--target <ide>", "Check compatibility against a target, repeatable, or 'all'", collect, [] as string[])
  .option("--strict", "Treat warnings as errors")
  .option("--list-rules", "Print the rule set and exit")
  .action((options: { root?: string; format?: string; target?: string[]; strict?: boolean; listRules?: boolean }) =>
    validateCommand(options),
  );

program
  .command("lint")
  .description("Analyse configuration quality: drifted copies, duplication, context cost")
  .option("--root <path>", "Directory to analyse instead of the current working directory")
  .option("--format <format>", "Output format: human or json", "human")
  .option("--budget <tokens>", "Always-loaded context budget, in estimated tokens")
  .option("--similarity <ratio>", "Near-duplicate similarity threshold between 0 and 1")
  .option("--strict", "Treat warnings as errors")
  .action((options: { root?: string; format?: string; budget?: string; similarity?: string; strict?: boolean }) =>
    lintCommand(options),
  );

program.command("watch").description("Watch ai/ for changes and sync automatically").action(watchCommand);

program
  .command("clean")
  .description("Remove stale or orphaned generated files")
  .option("--dry-run", "Show what would be removed without deleting")
  .option("--stale-only", "Only remove files no longer in the manifest")
  .action((options: { dryRun?: boolean; staleOnly?: boolean }) => cleanCommand(options));

program
  .command("diff")
  .description("Detect drift between generated files and the manifest")
  .option("--files <paths>", "Only check specific files (comma-separated)", (val: string) =>
    val.split(",").map((s) => s.trim()),
  )
  .action((options: { files?: string[] }) => diffCommand(options));

program
  .command("rollback")
  .description("Restore files from a previous backup")
  .option("--tag <tag>", "Specific backup tag to restore")
  .option("--list", "List available backups without restoring")
  .action((options: { tag?: string; list?: boolean }) => rollbackCommand(options));

program
  .command("ui")
  .description("Start the local agentfile dashboard")
  .option("--dev", "Run UI in development mode")
  .option("--port <port>", "Port for the local dashboard", "4311")
  .option("--root <path>", "Project folder to inspect instead of the current working directory")
  .action((options: { dev?: boolean; port: string; root?: string }) =>
    uiCommand({
      dev: options.dev,
      port: Number(options.port),
      root: options.root,
    }),
  );

program.parse();
