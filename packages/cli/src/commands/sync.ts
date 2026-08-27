/// <reference types="node" />

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildManifest,
  type GenerateResult,
  generate,
  MANIFEST_FILE,
  readManifest,
  staleFiles,
  writeManifest,
} from "@agentfile/core";
import { logger } from "../logger.js";

const AI_AGENTS_FILE = ".ai-agents";
const AI_AGENTS_EXAMPLE = ".ai-agents.example";

function readAgents(root: string): string[] | null {
  const agentsPath = join(root, AI_AGENTS_FILE);

  if (!existsSync(agentsPath)) {
    logger.warn(`No ${AI_AGENTS_FILE} file found.`);
    if (existsSync(join(root, AI_AGENTS_EXAMPLE))) {
      logger.info(`Copy ${AI_AGENTS_EXAMPLE} to ${AI_AGENTS_FILE} and list the agents you use.`);
    }
    return null;
  }

  return readFileSync(agentsPath, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

export async function syncCommand(options: { dryRun?: boolean } = {}) {
  const root = process.cwd();
  const dryRun = options.dryRun ?? false;

  logger.title(dryRun ? "agentfile — dry run" : "agentfile sync");

  // Read agent selection
  const agents = readAgents(root);
  if (!agents) {
    process.exit(1);
  }

  if (!agents.length) {
    logger.error(`${AI_AGENTS_FILE} is empty. Add at least one agent name.`);
    process.exit(1);
  }

  logger.info(`Agents: ${agents.join(", ")}\n`);

  // Run generation
  let result: GenerateResult;
  try {
    result = generate({ root, agents, dryRun });
  } catch (err) {
    logger.error((err as Error).message);
    process.exit(1);
  }

  // Report results
  for (const r of result.results) {
    if (r.status === "ok") {
      const label = dryRun ? `(dry-run) ${r.agent}` : r.agent;
      logger.success(`${label} → ${r.output}`);
    } else if (r.status === "skipped") {
      logger.warn(`${r.agent} skipped — ${r.reason}`);
    } else {
      logger.error(`${r.agent} — ${r.error.message}`);
    }
  }

  console.log();

  if (!result.success) {
    logger.error("Sync failed. See errors above.");
    process.exit(1);
  }

  logger.success(
    dryRun ? "Dry run passed. All templates render without errors." : "All agent files generated successfully.",
  );

  // Write manifest (skip in dry-run mode)
  if (!dryRun) {
    const ownedFiles = new Map<string, { content: string; source: string }>();
    for (const r of result.results) {
      if (r.status === "ok") {
        ownedFiles.set(r.output, { content: r.content, source: r.agent });
      }
    }

    const previous = readManifest(root);
    const manifest = buildManifest(ownedFiles, previous);
    writeManifest(root, manifest);
    logger.info(`Manifest written: ${MANIFEST_FILE}`);

    // Report stale files (previously generated, no longer produced)
    if (previous) {
      const stale = staleFiles(previous, manifest);
      if (stale.length) {
        console.log();
        logger.warn("Stale files (previously generated, no longer in output):");
        for (const path of stale) {
          logger.warn(`  ${path}`);
        }
        logger.info("Run `agentfile clean` to review and remove them.");
      }
    }
  }

  console.log();
}
