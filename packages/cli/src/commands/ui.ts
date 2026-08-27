/// <reference types="node" />

/**
 * `agentfile ui` — the legacy local dashboard.
 *
 * The dashboard is an optional peer rather than a dependency. It brings an HTTP
 * server and a built front end with it, which is a large thing to install on
 * every machine that only ever runs `agentfile check` in a pre-commit hook —
 * and it serves the v1 contract workflow, not the v2 commands. This is the same
 * arrangement `vitest --ui` uses, for the same reason: the feature is real, and
 * most installs do not want it.
 *
 * npm does not install an optional peer, so the import can genuinely fail. That
 * is a message telling the reader what to install, not a stack trace.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { logger } from "../logger.js";

interface UiServerModule {
  startUiServer(options: { root: string; dev: boolean; port?: number; openBrowser: boolean }): Promise<unknown>;
}

async function loadUiServer(): Promise<UiServerModule | undefined> {
  try {
    return (await import("@agentfile/ui")) as unknown as UiServerModule;
  } catch {
    return undefined;
  }
}

export async function uiCommand(options: { dev?: boolean; port?: number; root?: string } = {}): Promise<void> {
  const isDev = options.dev ?? false;
  const projectRoot = resolve(options.root ?? process.cwd());

  const ui = await loadUiServer();
  if (!ui) {
    logger.error("The dashboard is not installed.");
    console.log();
    logger.info("`agentfile ui` needs an extra package, because it ships an HTTP server");
    logger.info("and a built front end that most installs never use:");
    console.log();
    logger.info("  npm install --save-dev @agentfile/ui");
    console.log();
    logger.info("Every other agentfile command works without it.");
    console.log();
    process.exit(1);
    return;
  }

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

  await ui.startUiServer({
    root: projectRoot,
    dev: isDev,
    port: options.port,
    openBrowser: true,
  });
}
