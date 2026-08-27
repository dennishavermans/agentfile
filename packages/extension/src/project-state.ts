import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverAgents, loadContract, resolveAgent } from "@agentfile/core";
import type * as vscode from "vscode";

import { AI_AGENTS_FILE } from "./constants.js";
import type { AgentNode, AgentStatus, RuleGroup, SidebarState, SkillNode } from "./types.js";

export function readSelectedAgents(root: string): Set<string> {
  const agentsFile = join(root, AI_AGENTS_FILE);
  if (!existsSync(agentsFile)) {
    return new Set<string>();
  }

  return new Set(
    readFileSync(agentsFile, "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
}

export function writeSelectedAgents(root: string, selectedAgents: Set<string>): void {
  const agentsFile = join(root, AI_AGENTS_FILE);
  const nextContent = `${Array.from(selectedAgents).sort().join("\n")}\n`;
  writeFileSync(agentsFile, nextContent, "utf-8");
}

export function enableAgent(root: string, agentName: string): boolean {
  const selectedAgents = readSelectedAgents(root);
  if (selectedAgents.has(agentName)) {
    return false;
  }

  selectedAgents.add(agentName);
  writeSelectedAgents(root, selectedAgents);
  return true;
}

export function getAgentNodes(root: string): AgentNode[] {
  const contractPath = join(root, "ai", "contract.yaml");
  const contractMtime = existsSync(contractPath) ? statSync(contractPath).mtimeMs : 0;
  const selected = readSelectedAgents(root);
  const agentNames = discoverAgents(join(root, "ai", "agents"));

  return agentNames.map((name) => {
    const resolved = resolveAgent(join(root, "ai", "agents"), name);
    const outputPath = resolved.config.output;
    const absoluteOutput = join(root, outputPath);
    const enabled = selected.has(name);

    let status: AgentStatus = enabled ? "synced" : "disabled";
    if (enabled) {
      if (!existsSync(absoluteOutput)) {
        status = "stale";
      } else {
        const outputMtime = statSync(absoluteOutput).mtimeMs;
        status = contractMtime > outputMtime ? "stale" : "synced";
      }
    }

    return { name, outputPath, status };
  });
}

export function getRuleGroups(root: string): RuleGroup[] {
  const contractPath = join(root, "ai", "contract.yaml");
  if (!existsSync(contractPath)) {
    return [];
  }

  const contract = loadContract(contractPath);
  const categories: Array<keyof typeof contract.rules> = ["coding", "architecture", "testing", "naming"];

  return categories.map((category) => ({
    category,
    entries: contract.rules[category],
  }));
}

export function getSkillNodes(root: string): SkillNode[] {
  const contractPath = join(root, "ai", "contract.yaml");
  if (!existsSync(contractPath)) {
    return [];
  }

  const contract = loadContract(contractPath);
  return contract.skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
  }));
}

export function getSidebarState(root: string): SidebarState {
  const agents = getAgentNodes(root);
  const contractPath = join(root, "ai", "contract.yaml");
  return {
    hasContract: existsSync(contractPath),
    agents,
    rules: getRuleGroups(root),
    skills: getSkillNodes(root),
    activeAgentCount: agents.filter((agent) => agent.status !== "disabled").length,
    staleCount: agents.filter((agent) => agent.status === "stale").length,
  };
}

export function staleCount(root: string): number {
  return getAgentNodes(root).filter((node) => node.status === "stale").length;
}

export function enabledAgentCount(root: string): number {
  return getAgentNodes(root).filter((node) => node.status !== "disabled").length;
}

export function isRelevantAgentfileEditor(editor: vscode.TextEditor | undefined, root: string): boolean {
  if (!editor) {
    return false;
  }

  const activePath = editor.document.uri.fsPath;
  const contractPath = join(root, "ai", "contract.yaml");
  if (activePath === contractPath) {
    return true;
  }

  const outputs = new Set(getAgentNodes(root).map((node) => join(root, node.outputPath)));
  return outputs.has(activePath);
}

export function staleSignature(root: string): string {
  const contractPath = join(root, "ai", "contract.yaml");
  const contractMtime = existsSync(contractPath) ? statSync(contractPath).mtimeMs : 0;
  const names = getAgentNodes(root)
    .filter((node) => node.status === "stale")
    .map((node) => node.name)
    .sort();

  return `${contractMtime}:${names.join(",")}`;
}

export function collectMigrationSources(root: string): string[] {
  const sources = new Set<string>();

  const directCandidates = [
    "AGENTS.md",
    "CLAUDE.md",
    "ai/AGENTS.md",
    ".github/copilot-instructions.md",
    ".cursorrules",
  ];

  for (const candidate of directCandidates) {
    if (existsSync(join(root, candidate))) {
      sources.add(candidate);
    }
  }

  const agentsRoot = join(root, "ai", "agents");
  if (existsSync(agentsRoot)) {
    const walk = (relativeDir: string): void => {
      const absoluteDir = join(root, relativeDir);
      const entries = readdirSync(absoluteDir, { withFileTypes: true });

      for (const entry of entries) {
        const childRelativePath = join(relativeDir, entry.name);
        const normalizedChildPath = childRelativePath.replaceAll("\\", "/");

        if (entry.isDirectory()) {
          walk(normalizedChildPath);
          continue;
        }

        const lower = entry.name.toLowerCase();
        if (lower === "template.md" || lower === "instructions.md" || lower === "prompt.md" || lower === "agents.md") {
          sources.add(normalizedChildPath);
        }
      }
    };

    walk("ai/agents");
  }

  return Array.from(sources).sort();
}
