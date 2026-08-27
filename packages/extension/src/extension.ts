import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { generate, ValidationError, validateContract } from "@agentfile/core";
import * as vscode from "vscode";
import { parseDocument } from "yaml";

import {
  collectMigrationSources,
  enableAgent,
  enabledAgentCount,
  isRelevantAgentfileEditor,
  readSelectedAgents,
  staleCount,
  staleSignature,
} from "./project-state.js";
import { AgentfileSidebarProvider } from "./sidebar-provider.js";
import type { AgentNode } from "./types.js";
import { findRuleLine, issueToDiagnostic } from "./yaml-helpers.js";

function findUpward(startDir: string, relativePath: string): string | null {
  let dir = startDir;

  while (true) {
    const candidate = join(dir, relativePath);
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }

    dir = parent;
  }
}

function buildCliCommand(root: string, command: string, args = ""): string {
  const monorepoCli = findUpward(root, "packages/cli/dist/bin.js");
  const installedCli = findUpward(root, "node_modules/@agentfile/cli/dist/bin.js");

  if (monorepoCli) {
    return `node "${monorepoCli}" ${command}${args ? ` ${args}` : ""}`;
  }

  if (installedCli) {
    return `node "${installedCli}" ${command}${args ? ` ${args}` : ""}`;
  }

  return `npx --yes @agentfile/cli ${command}${args ? ` ${args}` : ""}`;
}

function scheduleRefresh(refreshUi: () => void, delaysMs: number[]): void {
  for (const delay of delaysMs) {
    setTimeout(() => refreshUi(), delay);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return;
  }

  const root = workspaceFolder.uri.fsPath;
  const contractPath = join(root, "ai", "contract.yaml");
  const contractUri = vscode.Uri.file(contractPath);

  const diagnostics = vscode.languages.createDiagnosticCollection("agentfile");
  context.subscriptions.push(diagnostics);

  const sidebarProvider = new AgentfileSidebarProvider(root);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("agentfile.sidebar", sidebarProvider));

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = "agentfile.sync";
  context.subscriptions.push(statusBar);

  const refreshUi = (): void => {
    sidebarProvider.refresh();

    if (!existsSync(contractPath)) {
      statusBar.hide();
      return;
    }

    const stale = staleCount(root);
    if (stale > 0) {
      statusBar.text = `$(warning) ${stale} stale`;
    } else {
      statusBar.text = `$(sync) agentfile (${enabledAgentCount(root)} agents)`;
    }
    statusBar.show();
  };

  let staleToastInFlight = false;
  let lastStaleToast = "";

  const maybeShowStaleToast = async (): Promise<void> => {
    if (staleToastInFlight) {
      return;
    }

    if (!existsSync(contractPath)) {
      lastStaleToast = "";
      return;
    }

    if (!isRelevantAgentfileEditor(vscode.window.activeTextEditor, root)) {
      return;
    }

    const stale = staleCount(root);
    if (stale === 0) {
      lastStaleToast = "";
      return;
    }

    const signature = staleSignature(root);
    if (signature === lastStaleToast) {
      return;
    }

    staleToastInFlight = true;
    lastStaleToast = signature;

    const action = await vscode.window.showWarningMessage(
      `Agentfile is stale (${stale} output${stale === 1 ? "" : "s"} out of date).`,
      "Sync now",
      "Refresh status",
      "Open Contract",
    );

    if (action === "Sync now") {
      await runSync();
    } else if (action === "Refresh status") {
      refreshUi();
      void maybeShowStaleToast();
    } else if (action === "Open Contract") {
      await openContract();
    }

    staleToastInFlight = false;
  };

  const openContract = async (): Promise<void> => {
    if (!existsSync(contractPath)) {
      void vscode.window.showWarningMessage("No contract found — run agentfile init to get started");
      return;
    }

    const document = await vscode.workspace.openTextDocument(contractUri);
    await vscode.window.showTextDocument(document);
  };

  const openContractRule = async (category?: string, index?: number): Promise<void> => {
    if (!existsSync(contractPath)) {
      await openContract();
      return;
    }

    const document = await vscode.workspace.openTextDocument(contractUri);
    const editor = await vscode.window.showTextDocument(document);

    if (!category || typeof index !== "number") {
      return;
    }

    const line = findRuleLine(document.getText(), category, index);
    if (line === null) {
      return;
    }

    const lineText = document.lineAt(line).text;
    const firstTextColumn = lineText.search(/\S|$/);
    const position = new vscode.Position(line, firstTextColumn);
    const range = new vscode.Range(position, position);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  };

  const openAgentOutput = async (node?: AgentNode): Promise<void> => {
    if (!node) {
      return;
    }

    if (node.status === "disabled") {
      const enabled = enableAgent(root, node.name);
      if (enabled) {
        void vscode.window.showInformationMessage(`${node.name} enabled. Creating ${node.outputPath}...`);
      }
      await runSync();
    }

    const outputUri = vscode.Uri.file(join(root, node.outputPath));
    if (!existsSync(outputUri.fsPath)) {
      await runSync();
    }

    if (!existsSync(outputUri.fsPath)) {
      const action = await vscode.window.showWarningMessage(
        `${node.outputPath} could not be generated for ${node.name}.`,
        "Try again",
        "Open Contract",
      );

      if (action === "Try again") {
        await runSync();
        if (existsSync(outputUri.fsPath)) {
          const document = await vscode.workspace.openTextDocument(outputUri);
          await vscode.window.showTextDocument(document);
          return;
        }
      }

      if (action === "Open Contract") {
        await openContract();
      }

      return;
    }

    const document = await vscode.workspace.openTextDocument(outputUri);
    await vscode.window.showTextDocument(document);
  };

  const runSync = async (): Promise<void> => {
    const terminal = vscode.window.createTerminal({ name: "agentfile sync" });
    terminal.show();
    terminal.sendText(buildCliCommand(root, "sync"), true);

    scheduleRefresh(refreshUi, [400, 1200, 2500, 4500, 7000]);

    try {
      const selectedAgents = Array.from(readSelectedAgents(root));

      if (!selectedAgents.length) {
        refreshUi();
        return;
      }

      const result = generate({ root, agents: selectedAgents, dryRun: true });
      const files = result.results.filter((item) => item.status === "ok").map((item) => item.output);

      if (files.length) {
        void vscode.window.showInformationMessage(`Sync completed. Updated files: ${files.join(", ")}`);
      }
    } catch {
      // Terminal output remains source of truth; this preview list is best-effort.
    }

    refreshUi();
  };

  const initProject = async (): Promise<void> => {
    const terminal = vscode.window.createTerminal({ name: "agentfile init" });
    terminal.show();
    terminal.sendText(buildCliCommand(root, "init"), true);

    scheduleRefresh(refreshUi, [400, 1200, 2500, 4500]);
  };

  const migrateProject = async (): Promise<void> => {
    const sources = collectMigrationSources(root);
    if (!sources.length) {
      void vscode.window.showWarningMessage(
        "No migration source files found. Add instruction files (for example AGENTS.md or ai/agents/**/template.md) and try again.",
      );
      return;
    }

    const terminal = vscode.window.createTerminal({
      name: "agentfile migrate",
    });
    terminal.show();
    const fromArgs = sources.map((source) => `--from "${source}"`).join(" ");
    terminal.sendText(buildCliCommand(root, "migrate", fromArgs), true);

    scheduleRefresh(refreshUi, [400, 1200, 2500, 4500]);
  };

  const runDiff = (): void => {
    const terminal = vscode.window.createTerminal({ name: "agentfile diff" });
    terminal.show();
    terminal.sendText(buildCliCommand(root, "diff"), true);
    scheduleRefresh(refreshUi, [400, 1200, 2500]);
  };

  const runClean = async (): Promise<void> => {
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: "$(eye) Dry run",
          description: "Preview what would be removed without deleting",
          value: "--dry-run",
        },
        {
          label: "$(trash) Clean stale files",
          description: "Remove orphaned generated files and update manifest",
          value: "",
        },
      ],
      { placeHolder: "Choose how to run clean" },
    );

    if (!choice) {
      return;
    }

    const terminal = vscode.window.createTerminal({ name: "agentfile clean" });
    terminal.show();
    terminal.sendText(buildCliCommand(root, "clean", choice.value), true);
    scheduleRefresh(refreshUi, [400, 1200, 2500]);
  };

  const runRollback = async (): Promise<void> => {
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: "$(list-unordered) List backups",
          description: "Show available backup tags in the terminal",
          value: "list",
        },
        {
          label: "$(history) Restore a backup",
          description: "Restore files from a specific backup tag",
          value: "restore",
        },
      ],
      { placeHolder: "Choose rollback action" },
    );

    if (!choice) {
      return;
    }

    if (choice.value === "list") {
      const terminal = vscode.window.createTerminal({
        name: "agentfile rollback",
      });
      terminal.show();
      terminal.sendText(buildCliCommand(root, "rollback", "--list"), true);
      return;
    }

    const tag = await vscode.window.showInputBox({
      prompt: "Enter the backup tag to restore (run 'List backups' first to see available tags)",
      placeHolder: "e.g. migrate-1700000000000",
    });

    if (!tag) {
      return;
    }

    const terminal = vscode.window.createTerminal({
      name: "agentfile rollback",
    });
    terminal.show();
    terminal.sendText(buildCliCommand(root, "rollback", `--tag "${tag}"`), true);
    scheduleRefresh(refreshUi, [400, 1200, 2500]);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("agentfile.focus", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.agentfile");
      await vscode.commands.executeCommand("agentfile.sidebar.focus");
    }),
    vscode.commands.registerCommand("agentfile.refresh", refreshUi),
    vscode.commands.registerCommand("agentfile.sync", runSync),
    vscode.commands.registerCommand("agentfile.init", initProject),
    vscode.commands.registerCommand("agentfile.migrate", migrateProject),
    vscode.commands.registerCommand("agentfile.diff", runDiff),
    vscode.commands.registerCommand("agentfile.clean", runClean),
    vscode.commands.registerCommand("agentfile.rollback", runRollback),
    vscode.commands.registerCommand("agentfile.openContract", openContract),
    vscode.commands.registerCommand("agentfile.openContractRule", openContractRule),
    vscode.commands.registerCommand("agentfile.openAgentOutput", openAgentOutput),
    vscode.commands.registerCommand("agentfile.validate", async () => {
      diagnostics.clear();

      if (!existsSync(contractPath)) {
        void vscode.window.showWarningMessage("No contract found — run agentfile init to get started");
        return;
      }

      try {
        validateContract({ contractPath });
        void vscode.window.showInformationMessage("contract.yaml is valid");
        refreshUi();
        return true;
      } catch (error) {
        if (error instanceof ValidationError) {
          const rawYaml = readFileSync(contractPath, "utf-8");
          const doc = parseDocument(rawYaml, { prettyErrors: false });
          const items = error.issues.map((issue) => issueToDiagnostic(issue, rawYaml, doc));
          diagnostics.set(contractUri, items);
          void vscode.window.showErrorMessage(`Validation failed with ${items.length} issue(s).`);
          return false;
        }

        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 1),
          (error as Error).message,
          vscode.DiagnosticSeverity.Error,
        );
        diagnostics.set(contractUri, [diagnostic]);
        void vscode.window.showErrorMessage((error as Error).message);
        return false;
      }
    }),
  );

  const watcher = vscode.workspace.createFileSystemWatcher("**/ai/contract.yaml");
  context.subscriptions.push(
    watcher,
    watcher.onDidChange(async () => {
      refreshUi();
      void maybeShowStaleToast();
      const action = await vscode.window.showInformationMessage(
        "contract.yaml changed — re-sync to update agent files",
        "Sync now",
        "Refresh status",
      );
      if (action === "Sync now") {
        await runSync();
      }
      if (action === "Refresh status") {
        refreshUi();
      }
    }),
    watcher.onDidCreate(() => {
      refreshUi();
      void maybeShowStaleToast();
    }),
    watcher.onDidDelete(() => {
      diagnostics.clear();
      refreshUi();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      refreshUi();
      void maybeShowStaleToast();
    }),
    vscode.workspace.onDidSaveTextDocument(() => {
      refreshUi();
      void maybeShowStaleToast();
    }),
  );

  refreshUi();
  void maybeShowStaleToast();
}

export function deactivate(): void {}
