/// <reference types="node" />
import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import {
  readManifest,
  writeManifest,
  staleFiles,
  ownedPaths,
  MANIFEST_FILE,
} from "@agentfile/core";
import { logger } from "../logger.js";

export interface CleanOptions {
  dryRun?: boolean;
  staleOnly?: boolean;
}

export async function cleanCommand(options: CleanOptions = {}): Promise<void> {
  const root = process.cwd();
  const dryRun = options.dryRun ?? false;

  logger.title(dryRun ? "agentfile clean — dry run" : "agentfile clean");

  const manifest = readManifest(root);
  if (!manifest) {
    logger.error(
      `No ${MANIFEST_FILE} found. Run \`agentfile sync\` first to generate the manifest.`,
    );
    process.exit(1);
    return;
  }

  // Find stale files: owned in previous manifest but no longer generated.
  // Since we don't have a "current" generation to compare against, stale files
  // are those that exist in the manifest but no longer exist on disk or have
  // been orphaned. For now, list all owned files and let the user decide.
  // A proper stale check requires re-running generate in dry-run mode.

  const owned = ownedPaths(manifest);
  const missing: string[] = [];
  const present: string[] = [];

  for (const p of owned) {
    if (existsSync(join(root, p))) {
      present.push(p);
    } else {
      missing.push(p);
    }
  }

  if (!present.length && !missing.length) {
    logger.success("No files to clean.");
    return;
  }

  if (missing.length) {
    logger.info("Already deleted (will be removed from manifest):");
    for (const p of missing) {
      logger.info(`  ${p}`);
    }
  }

  if (options.staleOnly) {
    // In stale-only mode, we'd need the current generation output to compare.
    // For now, report and exit.
    logger.info("\nOwned files currently on disk:");
    for (const p of present) {
      logger.info(`  ${p}`);
    }
    logger.info(
      "\nTo detect stale files, run `agentfile sync` first — it reports stale files automatically.",
    );
  } else {
    // Interactive: list what would be deleted
    logger.info("\nOwned files that can be regenerated:");
    for (const p of present) {
      logger.info(`  ${p}`);
    }

    if (dryRun) {
      console.log();
      logger.info(
        `Dry run: ${present.length} file(s) would be deleted. Run without --dry-run to proceed.`,
      );
      return;
    }

    // Prompt for confirmation
    const { default: Enquirer } = await import("enquirer");
    const enquirer = new Enquirer();
    const { confirm } = (await enquirer.prompt({
      type: "confirm",
      name: "confirm",
      message: `Delete ${present.length} generated file(s)?`,
      initial: false,
    })) as { confirm: boolean };

    if (!confirm) {
      logger.warn("Clean cancelled.");
      return;
    }

    for (const p of present) {
      unlinkSync(join(root, p));
      logger.success(`Deleted: ${p}`);
    }
  }

  // Remove missing files from manifest
  if (missing.length || (!options.staleOnly && present.length && !dryRun)) {
    const remaining = manifest.files.filter((f) => {
      if (missing.includes(f.path)) return false;
      if (!options.staleOnly && present.includes(f.path)) return false;
      return true;
    });
    const updated = { ...manifest, files: remaining };
    writeManifest(root, updated);
    logger.info(`Manifest updated: ${MANIFEST_FILE}`);
  }

  console.log();
}
