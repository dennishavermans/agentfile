/// <reference types="node" />

import { type Contract, discoverAgents, generate, loadContract, resolveAgent, validateContract } from "@agentfile/core";
import { createPatch } from "diff";
import express from "express";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import yaml from "js-yaml";
import open from "open";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { fileURLToPath } from "url";

export type AgentStatus = {
  name: string;
  outputPath: string;
  synced: boolean;
  lastSynced: number;
  stale: boolean;
  disabled: boolean;
};

export type UiServerOptions = {
  root?: string;
  port?: number;
  dev?: boolean;
  openBrowser?: boolean;
};

const AI_AGENTS_FILE = ".ai-agents";

function readSelectedAgents(root: string): Set<string> {
  const filePath = join(root, AI_AGENTS_FILE);
  if (!existsSync(filePath)) {
    return new Set<string>();
  }

  const agents = readFileSync(filePath, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  return new Set<string>(agents);
}

function getContractMtime(root: string): number {
  const contractPath = join(root, "ai", "contract.yaml");
  if (!existsSync(contractPath)) {
    return 0;
  }
  return statSync(contractPath).mtimeMs;
}

function getAgentStatuses(root: string): AgentStatus[] {
  const agentsDir = join(root, "ai", "agents");
  const selected = readSelectedAgents(root);
  const contractMtime = getContractMtime(root);
  const names = discoverAgents(agentsDir);

  return names.map((name) => {
    const resolved = resolveAgent(agentsDir, name);
    const outputPath = resolved.config.output;
    const fullOutputPath = join(root, outputPath);
    const disabled = !selected.has(name);

    if (!existsSync(fullOutputPath)) {
      return {
        name,
        outputPath,
        synced: false,
        lastSynced: 0,
        stale: !disabled,
        disabled,
      };
    }

    const outputMtime = statSync(fullOutputPath).mtimeMs;
    const stale = !disabled && contractMtime > outputMtime;

    return {
      name,
      outputPath,
      synced: !disabled && !stale,
      lastSynced: outputMtime,
      stale,
      disabled,
    };
  });
}

function readContract(root: string): Contract {
  const contractPath = join(root, "ai", "contract.yaml");
  return loadContract(contractPath);
}

function ensureContractExists(root: string): boolean {
  return existsSync(join(root, "ai", "contract.yaml"));
}

function validateContractContent(root: string, content: string): void {
  const tmpFolder = mkdtempSync(join(tmpdir(), "agentfile-contract-"));
  const tmpPath = join(tmpFolder, "contract.yaml");
  writeFileSync(tmpPath, content, "utf-8");

  try {
    validateContract({ contractPath: tmpPath });
  } finally {
    rmSync(tmpFolder, { recursive: true, force: true });
  }
}

function resolveStaticClientDir(root: string): string {
  const workspaceDist = join(root, "packages/ui/dist/app");
  if (existsSync(workspaceDist)) {
    return workspaceDist;
  }

  const thisFileDir = fileURLToPath(new URL(".", import.meta.url));
  return join(thisFileDir, "app");
}

function resolveDevClientDir(root: string): string {
  const workspaceApp = join(root, "packages/ui/app");
  if (existsSync(workspaceApp)) {
    return workspaceApp;
  }

  const thisFileDir = fileURLToPath(new URL(".", import.meta.url));

  const siblingApp = join(thisFileDir, "app");
  if (existsSync(siblingApp)) {
    return siblingApp;
  }

  const parentApp = join(thisFileDir, "..", "app");
  if (existsSync(parentApp)) {
    return parentApp;
  }

  return workspaceApp;
}

export async function startUiServer(options: UiServerOptions = {}): Promise<void> {
  const root = resolve(options.root ?? process.cwd());
  const port = options.port ?? 4311;
  const hmrPort = port + 100;
  const dev = options.dev ?? process.env.NODE_ENV !== "production";
  const app = express();

  const NO_CONTRACT_MESSAGE = "No contract found — run `agentfile init` to get started";

  app.use(express.json({ limit: "2mb" }));

  app.get("/api/status", (_req, res) => {
    if (!ensureContractExists(root)) {
      res.json({
        missingContract: true,
        message: NO_CONTRACT_MESSAGE,
        agents: [],
      });
      return;
    }

    const agents = getAgentStatuses(root);
    res.json({ agents });
  });

  app.get("/api/contract", (_req, res) => {
    if (!ensureContractExists(root)) {
      res.status(404).json({
        message: NO_CONTRACT_MESSAGE,
      });
      return;
    }

    try {
      const contract = readContract(root);
      res.json(contract);
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.post("/api/sync", (_req, res) => {
    if (!ensureContractExists(root)) {
      res.status(404).json({
        message: NO_CONTRACT_MESSAGE,
      });
      return;
    }

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");

    const selectedAgents = Array.from(readSelectedAgents(root));

    res.write(`${JSON.stringify({ type: "start" })}\n`);

    try {
      const result = generate({ root, agents: selectedAgents, dryRun: false });
      for (const item of result.results) {
        if (item.status === "ok") {
          res.write(`${JSON.stringify({ type: "file", path: item.output })}\n`);
        }
        if (item.status === "error") {
          res.write(`${JSON.stringify({ type: "error", message: item.error.message })}\n`);
        }
      }

      res.write(`${JSON.stringify({ type: "done", success: result.success })}\n`);
      res.end();
    } catch (error) {
      res.write(`${JSON.stringify({ type: "error", message: (error as Error).message })}\n`);
      res.end();
    }
  });

  app.get("/api/preview/:agent", (req, res) => {
    if (!ensureContractExists(root)) {
      res.status(404).json({
        message: NO_CONTRACT_MESSAGE,
      });
      return;
    }

    const agent = req.params.agent;

    try {
      const result = generate({ root, agents: [agent], dryRun: true });
      const rendered = result.results.find((item) => item.status === "ok" && item.agent === agent);

      if (!rendered || rendered.status !== "ok") {
        res.status(404).json({ message: `No preview found for agent ${agent}` });
        return;
      }

      res.json({
        agent,
        outputPath: rendered.output,
        content: rendered.content,
      });
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.get("/api/diff/:agent", (req, res) => {
    if (!ensureContractExists(root)) {
      res.status(404).json({
        message: NO_CONTRACT_MESSAGE,
      });
      return;
    }

    const agent = req.params.agent;

    try {
      const result = generate({ root, agents: [agent], dryRun: true });
      const rendered = result.results.find((item) => item.status === "ok" && item.agent === agent);

      if (!rendered || rendered.status !== "ok") {
        res.status(404).json({ message: `No generated output found for agent ${agent}` });
        return;
      }

      const currentPath = join(root, rendered.output);
      const current = existsSync(currentPath) ? readFileSync(currentPath, "utf-8") : "";
      const unified = createPatch(rendered.output, current, rendered.content, "current", "generated");

      res.json({ agent, outputPath: rendered.output, diff: unified });
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.patch("/api/contract", (req, res) => {
    if (!ensureContractExists(root)) {
      res.status(404).json({
        message: NO_CONTRACT_MESSAGE,
      });
      return;
    }

    const incomingRules = req.body?.rules as Contract["rules"] | undefined;
    if (!incomingRules) {
      res.status(400).json({ message: "rules payload is required" });
      return;
    }

    try {
      const currentContract = readContract(root);
      const nextContract: Contract = {
        ...currentContract,
        rules: incomingRules,
      };

      const yamlContent = yaml.dump(nextContract, {
        lineWidth: 120,
        noRefs: true,
      });
      validateContractContent(root, yamlContent);

      const contractPath = join(root, "ai", "contract.yaml");
      writeFileSync(contractPath, yamlContent, "utf-8");

      res.json({ ok: true, contract: nextContract });
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
    }
  });

  if (dev) {
    const { createServer: createViteServer } = await import("vite");
    const clientDir = resolveDevClientDir(root);
    const vite = await createViteServer({
      root: clientDir,
      appType: "spa",
      server: {
        middlewareMode: true,
        hmr: {
          port: hmrPort,
          clientPort: hmrPort,
        },
      },
    });

    const serveDevIndex = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      try {
        const indexHtml = readFileSync(join(clientDir, "index.html"), "utf-8");
        const transformed = await vite.transformIndexHtml(req.originalUrl, indexHtml);
        res.status(200).set({ "Content-Type": "text/html" }).end(transformed);
      } catch (error) {
        next(error);
      }
    };

    app.get("/", serveDevIndex);
    app.get("/index.html", serveDevIndex);
    app.get(/^\/(?!api\/)(?!.*\.[^/]+$).*/, serveDevIndex);
    app.use(vite.middlewares);
  } else {
    const clientDir = resolveStaticClientDir(root);
    app.use(express.static(clientDir));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(join(clientDir, "index.html"));
    });
  }

  const server = app.listen(port, async () => {
    const url = `http://localhost:${port}`;
    console.log(`agentfile UI running at ${url}`);
    if (options.openBrowser) {
      await open(url);
    }
  });

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dev = process.argv.includes("--dev");
  const portArg = process.argv.find((arg) => arg.startsWith("--port="));
  const port = portArg ? Number(portArg.split("=")[1]) : 4311;

  startUiServer({
    root: process.cwd(),
    dev,
    openBrowser: true,
    port,
  }).catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
