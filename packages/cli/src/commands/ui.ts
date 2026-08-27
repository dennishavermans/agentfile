/// <reference types="node" />

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { startUiServer } from "@agentfile/ui";
import { logger } from "../logger.js";

export async function uiCommand(options: { dev?: boolean; port?: number; root?: string } = {}): Promise<void> {
  const isDev = options.dev ?? false;
  const projectRoot = resolve(options.root ?? process.cwd());

  logger.title("agentfile ui");
  logger.info(`Starting local dashboard on port ${options.port ?? 4311}`);
  logger.info(`Project root: ${projectRoot}`);

  if (!isDev) {
    const workspaceUiPackage = join(projectRoot, "packages", "ui", "package.json");
    if (existsSync(workspaceUiPackage)) {
      logger.info("Building UI assets...");
      execSync("npm run build -w packages/ui", { stdio: "inherit" });
    }
  }

  await startUiServer({
    root: projectRoot,
    dev: isDev,
    port: options.port,
    openBrowser: true,
  });
}
