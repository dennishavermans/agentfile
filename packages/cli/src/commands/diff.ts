/// <reference types="node" />

import { existsSync } from "node:fs";
import { join } from "node:path";
import { detectDrift, MANIFEST_FILE, ownedPaths, readManifest } from "@agentfile/core";
import { logger } from "../logger.js";

export interface DiffOptions {
  /** Only check specific files (relative paths). */
  files?: string[];
}

export async function diffCommand(options: DiffOptions = {}): Promise<void> {
  const root = process.cwd();

  logger.title("agentfile diff");

  const manifest = readManifest(root);
  if (!manifest) {
    logger.error(`No ${MANIFEST_FILE} found. Run \`agentfile sync\` first.`);
    process.exit(1);
    return;
  }

  const pathsToCheck = options.files?.length ? options.files : ownedPaths(manifest);

  if (!pathsToCheck.length) {
    logger.success("No owned files to check.");
    return;
  }

  const drifted = detectDrift(root, {
    ...manifest,
    files: manifest.files.filter((f) => pathsToCheck.includes(f.path)),
  });

  const missing: string[] = [];
  const modified: string[] = [];

  for (const path of drifted) {
    if (!existsSync(join(root, path))) {
      missing.push(path);
    } else {
      modified.push(path);
    }
  }

  // Unchanged files
  const unchanged = pathsToCheck.filter((p) => !drifted.includes(p));

  // Report
  if (unchanged.length) {
    for (const p of unchanged) {
      logger.success(`✔ ${p} — matches manifest`);
    }
  }

  if (modified.length) {
    console.log();
    for (const p of modified) {
      logger.warn(`✗ ${p} — content has drifted from last sync`);
    }
  }

  if (missing.length) {
    console.log();
    for (const p of missing) {
      logger.error(`✗ ${p} — file missing from disk`);
    }
  }

  console.log();

  if (drifted.length) {
    logger.warn(`${drifted.length} file(s) have drifted. Run \`agentfile sync\` to regenerate.`);
    process.exit(1);
    return;
  }

  logger.success("All generated files match the manifest. No drift detected.");
}
