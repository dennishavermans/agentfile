/// <reference types="node" />
import { BACKUP_DIR, listBackups, readBackup, restoreBackup } from "@agentfile/core";
import { logger } from "../logger.js";

export interface RollbackOptions {
  /** Specific backup tag to restore. If omitted, uses the most recent. */
  tag?: string;
  /** List available backups without restoring. */
  list?: boolean;
}

export async function rollbackCommand(options: RollbackOptions = {}): Promise<void> {
  const root = process.cwd();

  logger.title("agentfile rollback");

  const backups = listBackups(root);

  if (options.list) {
    if (!backups.length) {
      logger.info("No backups found.");
      return;
    }
    logger.info("Available backups:");
    for (const tag of backups) {
      logger.info(`  ${tag}`);
    }
    return;
  }

  if (!backups.length) {
    logger.error(`No backups found in ${BACKUP_DIR}/. Nothing to roll back.`);
    process.exit(1);
    return;
  }

  const tag = options.tag ?? backups[0]; // most recent
  const entries = readBackup(root, tag);

  if (!entries.length) {
    logger.error(`Backup "${tag}" is empty or corrupt.`);
    process.exit(1);
    return;
  }

  logger.info(`Restoring backup: ${tag} (${entries.length} file(s))\n`);

  // Prompt for confirmation
  const { default: Enquirer } = await import("enquirer");
  const enquirer = new Enquirer();

  logger.info("Files to restore:");
  for (const e of entries) {
    logger.info(`  ${e.path}`);
  }
  console.log();

  const { confirm } = (await enquirer.prompt({
    type: "confirm",
    name: "confirm",
    message: `Restore ${entries.length} file(s) from backup "${tag}"?`,
    initial: false,
  })) as { confirm: boolean };

  if (!confirm) {
    logger.warn("Rollback cancelled.");
    return;
  }

  const restored = restoreBackup(root, entries);
  for (const p of restored) {
    logger.success(`Restored: ${p}`);
  }

  console.log();
  logger.success(`Rollback complete. ${restored.length} file(s) restored.`);
  logger.info("Run `agentfile sync` to regenerate if you want to switch back to managed output.");
  console.log();
}
