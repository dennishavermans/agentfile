/// <reference types="node" />

import { captureBackup, writeBackup } from "@agentfile/core";
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { logger } from "../logger.js";
import { filterSourcesByTarget } from "./migrate/filter.js";
import { mergeFiles } from "./migrate/merge.js";
import { parseAgentFile } from "./migrate/parser.js";
import type { MigrateOptions, MigrateReportEntry, ParsedFile, ReplacePolicy } from "./migrate/types.js";
import { buildContractYaml } from "./migrate/yaml.js";

export { mergeFiles } from "./migrate/merge.js";

export { parseAgentFile } from "./migrate/parser.js";
export type {
  MergeResult,
  MigrateClassification,
  MigrateOptions,
  MigrateReportEntry,
  ParsedFile,
  ParsedRules,
  ParsedSkill,
  ReplacePolicy,
  RuleCategory,
} from "./migrate/types.js";

function resolveSourcePaths(sources: string[], root: string): string[] {
  const resolved: string[] = [];
  for (const source of sources) {
    const absolutePath = resolve(root, source);
    if (!existsSync(absolutePath)) {
      logger.error(`Source file not found: ${absolutePath}`);
      process.exit(1);
      return [];
    }
    resolved.push(absolutePath);
  }
  return resolved;
}

async function promptMissingProjectMeta(parsedFiles: ParsedFile[]): Promise<{
  projectName: string;
  stack: string[];
}> {
  let projectName = parsedFiles.find((file) => file.projectName)?.projectName;
  let stack = parsedFiles.find((file) => file.stack)?.stack;

  if (!projectName || !stack) {
    const { default: Enquirer } = await import("enquirer");
    const enquirer = new Enquirer();

    const answers = (await enquirer.prompt([
      ...(!projectName
        ? [
            {
              type: "input",
              name: "name",
              message: "Project name? (could not be auto-detected)",
              initial: "My Project",
            },
          ]
        : []),
      ...(!stack
        ? [
            {
              type: "list",
              name: "stack",
              message: "Tech stack? (comma-separated, could not be auto-detected)",
              initial: "typescript",
            },
          ]
        : []),
    ])) as { name?: string; stack?: string[] };

    if (answers.name) projectName = answers.name;
    if (answers.stack) stack = answers.stack;
    console.log();
  }

  return {
    projectName: projectName ?? "My Project",
    stack: stack ?? ["typescript"],
  };
}

function printMigrationReport(report: MigrateReportEntry[]): void {
  if (!report.length) return;

  console.log();
  logger.title("Migration Report");

  const imported = report.filter((entry) => entry.classification === "imported");
  const skipped = report.filter((entry) => entry.classification === "skipped");
  const unsupported = report.filter((entry) => entry.classification === "unsupported");

  if (imported.length) {
    logger.success(`  Imported (${imported.length}):`);
    for (const entry of imported) logger.info(`    ${entry.path}`);
  }

  if (skipped.length) {
    logger.warn(`  Skipped (${skipped.length}):`);
    for (const entry of skipped) logger.warn(`    ${entry.path} — ${entry.reason}`);
  }

  if (unsupported.length) {
    logger.warn(`  Unsupported (${unsupported.length}):`);
    for (const entry of unsupported) logger.warn(`    ${entry.path} — ${entry.reason}`);
    logger.info("  Review unsupported sections and add any missing rules to ai/contract.yaml manually.");
  }
}

function backupSourcesAndContract(root: string, sourcePaths: string[], contractPath: string, tag: string): void {
  const backupPaths = sourcePaths.map((absolutePath) => relative(root, absolutePath));
  const contractRelativePath = relative(root, contractPath);
  if (existsSync(contractPath)) backupPaths.push(contractRelativePath);

  const backupEntries = captureBackup(root, backupPaths);
  if (backupEntries.length) {
    const backupDir = writeBackup(root, backupEntries, tag);
    logger.info(`Backup saved: ${backupDir}`);
  }
}

function applyReplacePolicy(policy: ReplacePolicy, root: string, sourcePaths: string[], tag: string): void {
  if (policy === "keep") return;

  console.log();
  logger.title(`Applying replace policy: ${policy}`);

  for (const absolutePath of sourcePaths) {
    const relativePath = relative(root, absolutePath);

    if (policy === "archive") {
      const archiveDestination = join(root, ".agentfile-backup", tag, relativePath);
      mkdirSync(dirname(archiveDestination), { recursive: true });
      renameSync(absolutePath, archiveDestination);
      logger.info(`Archived: ${relativePath} → .agentfile-backup/${tag}/${relativePath}`);
      continue;
    }

    unlinkSync(absolutePath);
    logger.info(`Deleted: ${relativePath}`);
  }
}

export async function migrateCommand(options: MigrateOptions): Promise<void> {
  const { from: sources, dryRun = false, output: outputPath, replacePolicy = "keep", targets, exclude } = options;

  logger.title("agentfile migrate");

  if (!sources.length) {
    logger.error("No source files provided. Use --from <file> (repeatable).");
    process.exit(1);
    return;
  }

  const root = process.cwd();
  const resolvedSources = resolveSourcePaths(sources, root);

  const { filteredSources, report } = filterSourcesByTarget(resolvedSources, root, targets, exclude);

  for (const entry of report.filter((item) => item.classification === "skipped")) {
    logger.warn(`Skipped: ${entry.path} (${entry.reason})`);
  }

  if (!filteredSources.length) {
    logger.error("No source files remaining after filtering.");
    process.exit(1);
    return;
  }

  logger.info(`\nReading ${filteredSources.length} source file(s)...\n`);

  const parsed = filteredSources.map((filePath) => parseAgentFile(filePath));
  for (const parsedFile of parsed) {
    logger.info(`Parsed ${parsedFile.source}`);
    logger.info(
      `  rules: coding(${parsedFile.rules.coding.length}) architecture(${parsedFile.rules.architecture.length}) testing(${parsedFile.rules.testing.length}) naming(${parsedFile.rules.naming.length})`,
    );
    logger.info(`  skills: ${parsedFile.skills.length}`);
    if (parsedFile.unrecognized.length) {
      logger.warn(`  unrecognized sections: ${parsedFile.unrecognized.map((u) => `"${u.heading}"`).join(", ")}`);
    }
    console.log();
  }

  const merged = mergeFiles(parsed);
  for (const conflict of merged.conflicts) logger.warn(conflict);
  if (merged.conflicts.length) console.log();

  const { projectName, stack } = await promptMissingProjectMeta(parsed);
  const contractContent = buildContractYaml(projectName, stack, merged.rules, merged.skills);

  const contractPath = outputPath ? resolve(root, outputPath) : join(root, "ai", "contract.yaml");
  const backupTag = `migrate-${Date.now()}`;

  if (!dryRun) {
    backupSourcesAndContract(root, filteredSources, contractPath, backupTag);
  }

  if (dryRun) {
    logger.title("— draft contract.yaml (dry run) —");
    console.log(contractContent);
  } else {
    if (existsSync(contractPath)) {
      const { default: Enquirer } = await import("enquirer");
      const enquirer = new Enquirer();
      const { overwrite } = (await enquirer.prompt({
        type: "confirm",
        name: "overwrite",
        message: `${contractPath} already exists. Overwrite?`,
        initial: false,
      })) as { overwrite: boolean };

      if (!overwrite) {
        logger.warn("Migration cancelled — existing file not overwritten.");
        return;
      }
    }

    mkdirSync(dirname(contractPath), { recursive: true });
    writeFileSync(contractPath, contractContent, "utf-8");
    logger.success(`Written: ${contractPath}`);

    applyReplacePolicy(replacePolicy, root, filteredSources, backupTag);
  }

  const totalRules =
    merged.rules.coding.length +
    merged.rules.architecture.length +
    merged.rules.testing.length +
    merged.rules.naming.length;

  console.log();
  logger.success(`Extracted ${totalRules} rules across 4 categories, ${merged.skills.length} skill(s).`);

  for (const parsedFile of parsed) {
    for (const section of parsedFile.unrecognized) {
      report.push({
        path: `(section) "${section.heading}"`,
        classification: "unsupported",
        reason: `${section.lineCount} content lines — could not be mapped automatically`,
      });
    }
  }

  printMigrationReport(report);

  console.log();
  if (!dryRun) {
    logger.info("Next steps:");
    logger.info("  1. Review ai/contract.yaml — verify extracted rules and skills");
    logger.info("  2. Run `agentfile validate` to confirm the schema is valid");
    logger.info("  3. Run `agentfile sync` to generate agent instruction files");
    if (replacePolicy === "keep") {
      logger.info("  4. Optionally re-run with --replace-policy archive|delete to clean up source files");
    }
  }
}
