#!/usr/bin/env node
/// <reference types="node" />
import { Command } from "commander";
import { adoptCommand } from "./commands/adopt.js";
import { auditCommand } from "./commands/audit.js";
import { checkCommand } from "./commands/check.js";
import { cleanCommand } from "./commands/clean.js";
import { compileCommand } from "./commands/compile.js";
import { contextCommand } from "./commands/context.js";
import { diffCommand } from "./commands/diff.js";
import { doctorCommand } from "./commands/doctor.js";
import { evalCommand } from "./commands/eval.js";
import { explainCommand } from "./commands/explain.js";
import { initCommand } from "./commands/init.js";
import { lintCommand } from "./commands/lint.js";
import { migrateCommand } from "./commands/migrate.js";
import { rollbackCommand } from "./commands/rollback.js";
import { syncCommand } from "./commands/sync.js";
import { validateCommand } from "./commands/validate.js";
import { watchCommand } from "./commands/watch.js";

const program = new Command();

program
  .name("agentfile")
  .description("Read, check, and compile the AI agent configuration in a repository")
  .version("0.4.0");

/**
 * Help groups.
 *
 * Two generations of the tool ship in one binary. The v2 commands read whatever
 * configuration a repository already has; the v1 commands generate files from an
 * `ai/contract.yaml` that the repository had to adopt first. Both work, and a
 * flat alphabetical list gives a newcomer no way to tell which is which — so the
 * grouping says it, and the v1 group is labelled legacy rather than removed.
 */
const ANALYSE = "Analyse the configuration you already have:";
const GENERATE = "Generate and verify configuration:";
const LEGACY = "Legacy (v1 contract workflow):";

program
  .command("doctor")
  .helpGroup(ANALYSE)
  .description("Analyse the AI agent configuration already present in this repository")
  .option("--root <path>", "Directory to analyse instead of the current working directory")
  .option("--format <format>", "Output format: human or json", "human")
  .option("--verbose", "List every configuration file found")
  .action((options: { root?: string; format?: string; verbose?: boolean }) => doctorCommand(options));

const collect = (val: string, prev: string[]) => prev.concat(val.split(",").map((s) => s.trim()));

program
  .command("adopt")
  .helpGroup(ANALYSE)
  .description("Plan a single source of truth for the configuration already here")
  .option("--root <path>", "Directory to adopt instead of the current working directory")
  .option("--source <platform>", "Platform to consolidate into: agents-md (default), claude, copilot")
  .option("--apply", "Carry the plan out. Without this, nothing is written")
  .option("--yes", "Skip the confirmation prompt")
  .option("--format <format>", "Output format: human or json", "human")
  .action((options: { root?: string; source?: string; apply?: boolean; yes?: boolean; format?: string }) =>
    adoptCommand(options),
  );

program
  .command("check")
  .helpGroup(ANALYSE)
  .description("Fast deterministic validation, suitable for pre-commit hooks and editors")
  .option("--root <path>", "Directory to check instead of the current working directory")
  .option("--format <format>", "Output format: human or json", "human")
  .option("--strict", "Treat warnings as errors")
  .option("--no-suppressions", "Report findings an agentfile-disable directive would silence")
  .action((options: { root?: string; format?: string; strict?: boolean; suppressions?: boolean }) =>
    checkCommand(options),
  );

program
  .command("validate")
  .helpGroup(ANALYSE)
  .description("Strict deterministic validation across every layer (used in CI)")
  .option("--root <path>", "Directory to validate instead of the current working directory")
  .option("--format <format>", "Output format: human or json", "human")
  .option("--target <ide>", "Check compatibility against a target, repeatable, or 'all'", collect, [] as string[])
  .option("--strict", "Treat warnings as errors")
  .option("--list-rules", "Print the rule set and exit")
  .option("--no-suppressions", "Report findings an agentfile-disable directive would silence")
  .action(
    (options: {
      root?: string;
      format?: string;
      target?: string[];
      strict?: boolean;
      listRules?: boolean;
      suppressions?: boolean;
    }) => validateCommand(options),
  );

program
  .command("lint")
  .helpGroup(ANALYSE)
  .description("Analyse configuration quality: drifted copies, duplication, context cost")
  .option("--root <path>", "Directory to analyse instead of the current working directory")
  .option("--format <format>", "Output format: human or json", "human")
  .option("--budget <tokens>", "Always-loaded context budget, in estimated tokens")
  .option("--similarity <ratio>", "Near-duplicate similarity threshold between 0 and 1")
  .option("--strict", "Treat warnings as errors")
  .option("--no-suppressions", "Report findings an agentfile-disable directive would silence")
  .action(
    (options: {
      root?: string;
      format?: string;
      budget?: string;
      similarity?: string;
      strict?: boolean;
      suppressions?: boolean;
    }) => lintCommand(options),
  );

program
  .command("audit")
  .helpGroup(ANALYSE)
  .description("Security and trust analysis of hooks, skills, MCP servers, and permissions")
  .option("--root <path>", "Directory to audit instead of the current working directory")
  .option("--format <format>", "Output format: human or json", "human")
  .option("--strict", "Treat warnings as errors")
  .option("--all", "Include informational findings, which record rather than flag")
  .option("--no-suppressions", "Report findings an agentfile-disable directive would silence")
  .action((options: { root?: string; format?: string; strict?: boolean; all?: boolean; suppressions?: boolean }) =>
    auditCommand(options),
  );

program
  .command("context")
  .helpGroup(ANALYSE)
  .argument("<path>", "File or directory to resolve the effective configuration for")
  .description("Show which configuration applies to a path, in load order, and why")
  .option("--root <path>", "Directory to resolve against instead of the current working directory")
  .option("--format <format>", "Output format: human or json", "human")
  .option("--excluded", "List everything that did not apply, with the reason")
  .action((path: string, options: { root?: string; format?: string; excluded?: boolean }) =>
    contextCommand(path, options),
  );

program
  .command("explain")
  .helpGroup(ANALYSE)
  .argument("<target>", "A file path, a skill or subagent name, or part of a rule's text")
  .description("Explain where a piece of configuration comes from and when it applies")
  .option("--root <path>", "Directory to resolve against instead of the current working directory")
  .option("--format <format>", "Output format: human or json", "human")
  .option("--at <path>", "Ask whether it applies to a specific file")
  .option("--kind <kind>", "Restrict to one kind when the target is ambiguous")
  .action((target: string, options: { root?: string; format?: string; at?: string; kind?: string }) =>
    explainCommand(target, options),
  );

program
  .command("compile")
  .helpGroup(GENERATE)
  .description("Compile the normalized configuration into native target files")
  .option("--target <targets...>", "Targets to compile: agents-md, claude, copilot, cursor (repeatable)")
  .option("--root <path>", "Directory to compile instead of the current working directory")
  .option("--check", "Verify outputs are up to date instead of writing (exit 1 on drift)")
  .option("--force", "Overwrite files agentfile does not own")
  .option("--format <format>", "Output format: human or json", "human")
  .action((options: { target?: string[]; root?: string; check?: boolean; force?: boolean; format?: string }) =>
    compileCommand(options),
  );

program
  .command("eval")
  .helpGroup(GENERATE)
  .description("Run behavioral evals: an agent task in a sandbox, judged by deterministic assertions")
  .argument("[files...]", "Eval definition files (default: every *.eval.yaml in the repository)")
  .option("--agent <template>", 'Agent command template, e.g. "claude -p {prompt}"')
  .option("--root <path>", "Directory to run in instead of the current working directory")
  .option("--no-cache", "Re-run evals even when definition, agent, and repository state are unchanged")
  .option("--keep-workspace", "Leave each eval's temporary workspace on disk for inspection")
  .option("--format <format>", "Output format: human or json", "human")
  .action(
    (
      files: string[],
      options: { agent?: string; root?: string; cache?: boolean; keepWorkspace?: boolean; format?: string },
    ) => evalCommand({ ...options, files }),
  );

program
  .command("diff")
  .helpGroup(GENERATE)
  .description("Detect drift between generated files and the manifest")
  .option("--files <paths>", "Only check specific files (comma-separated)", (val: string) =>
    val.split(",").map((s) => s.trim()),
  )
  .action((options: { files?: string[] }) => diffCommand(options));

program
  .command("clean")
  .helpGroup(GENERATE)
  .description("Remove stale or orphaned generated files")
  .option("--dry-run", "Show what would be removed without deleting")
  .option("--stale-only", "Only remove files no longer in the manifest")
  .action((options: { dryRun?: boolean; staleOnly?: boolean }) => cleanCommand(options));

program
  .command("rollback")
  .helpGroup(GENERATE)
  .description("Restore files from a previous backup")
  .option("--tag <tag>", "Specific backup tag to restore")
  .option("--list", "List available backups without restoring")
  .action((options: { tag?: string; list?: boolean }) => rollbackCommand(options));

program
  .command("init")
  .helpGroup(LEGACY)
  .description("Legacy: scaffold an ai/contract.yaml to generate files from")
  .action(initCommand);

program
  .command("migrate")
  .helpGroup(LEGACY)
  .description("Legacy: import existing instruction files into a draft ai/contract.yaml")
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
  .helpGroup(LEGACY)
  .description("Legacy: generate agent instruction files from ai/contract.yaml")
  .option("--dry-run", "Render templates without writing files")
  .action((options) => syncCommand({ dryRun: options.dryRun }));

program
  .command("watch")
  .helpGroup(LEGACY)
  .description("Legacy: watch ai/ for changes and sync automatically")
  .action(watchCommand);

program
  .command("ui")
  .helpGroup(LEGACY)
  .description("Legacy: start the local dashboard for ai/contract.yaml")
  .option("--dev", "Run UI in development mode")
  .option("--port <port>", "Port for the local dashboard", "4311")
  .option("--root <path>", "Project folder to inspect instead of the current working directory")
  .action(async (options: { dev?: boolean; port: string; root?: string }) => {
    // Imported here rather than at the top of the file: the dashboard pulls in
    // an HTTP server and its dependencies, which is roughly half the startup
    // cost of the whole CLI. `check` runs in a pre-commit hook and must not pay
    // for a command it never calls.
    const { uiCommand } = await import("./commands/ui.js");
    await uiCommand({
      dev: options.dev,
      port: Number(options.port),
      root: options.root,
    });
  });

program.addHelpText(
  "after",
  `
The v2 commands read whatever agent configuration a repository already has —
AGENTS.md, CLAUDE.md, .claude/, .cursor/, .github/ — and need no setup:

  agentfile doctor          what is here, and what is wrong with it
  agentfile adopt           plan a single source of truth for it
  agentfile compile         generate the per-platform files from that source

The legacy commands generate files from an ai/contract.yaml the repository has
to adopt first. They still work and are still tested; new work should prefer
the v2 commands above.
`,
);

program.parse();
