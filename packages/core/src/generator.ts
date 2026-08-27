/// <reference types="node" />
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { loadContract, loadOverride, resolveAgent, resolveAgentSelection } from "./loader.js";
import { addMarker } from "./manifest.js";
import {
  buildAggregateArtifactTokens,
  buildArtifactTokens,
  extractPreservedZones,
  renderArtifactTemplate,
  renderSkillMdc,
  renderTemplate,
  type SkillsFormat,
} from "./renderer.js";
import type { AgentConfig, AgentResult, Artifact, Contract, GenerateResult, Override } from "./schema.js";

// ─── Options ───────────────────────────────────────────────────────────────

export interface GenerateOptions {
  root: string;
  agents: string[];
  dryRun?: boolean;
  /** When true, prepend a generated-by-agentfile comment to output files. */
  addMarkers?: boolean;
}

export interface ValidateOptions {
  contractPath: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function writeOutput(absPath: string, content: string, dryRun: boolean, markers: boolean): string {
  const finalContent = markers ? addMarker(absPath, content) : content;
  if (!dryRun) {
    const dir = dirname(absPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(absPath, finalContent, "utf-8");
  }
  return finalContent;
}

// Cursor generates one .mdc file per skill in addition to its main file
function generateCursorSkillFiles(root: string, contract: Contract, dryRun: boolean, markers: boolean): AgentResult[] {
  if (!contract.skills.length) return [];

  return contract.skills.map((skill) => {
    const output = `.cursor/rules/skills/${skill.name}.mdc`;
    const rawContent = renderSkillMdc(skill);
    try {
      const content = writeOutput(join(root, output), rawContent, dryRun, markers);
      return {
        status: "ok" as const,
        agent: `cursor:skill:${skill.name}`,
        output,
        content,
      };
    } catch (err) {
      return {
        status: "error" as const,
        agent: `cursor:skill:${skill.name}`,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  });
}

// ─── Artifact File Generation ─────────────────────────────────────────────

/**
 * Template-driven artifact generation. For each IDE agent whose config.yaml
 * declares `artifact_templates`, renders a file per matching artifact.
 *
 * Supports two modes per artifact type:
 *   aggregate: false (default) — one file per artifact, ${name} in output_pattern
 *   aggregate: true            — one file for all artifacts of that type
 */
function generateArtifactFiles(
  root: string,
  contract: Contract,
  agentName: string,
  agentDir: string,
  config: AgentConfig,
  dryRun: boolean,
  markers: boolean,
): AgentResult[] {
  if (!contract.artifacts.length) return [];
  if (!Object.keys(config.artifact_templates).length) return [];

  const results: AgentResult[] = [];

  // Group artifacts by type
  const byType = new Map<string, Artifact[]>();
  for (const artifact of contract.artifacts) {
    const list = byType.get(artifact.type) ?? [];
    list.push(artifact);
    byType.set(artifact.type, list);
  }

  for (const [type, artifacts] of byType) {
    const tmplConfig = config.artifact_templates[type];
    if (!tmplConfig) continue; // this IDE doesn't handle this artifact type

    // Load the template file from the agent's directory
    const templatePath = join(agentDir, tmplConfig.template);
    if (!existsSync(templatePath)) {
      results.push({
        status: "error",
        agent: `${agentName}:${type}`,
        error: new Error(`Artifact template not found: ${tmplConfig.template} (expected at ${templatePath})`),
      });
      continue;
    }
    const templateContent = readFileSync(templatePath, "utf-8");

    if (tmplConfig.aggregate) {
      // ── Aggregate mode: one file for all artifacts of this type ──
      const bodies = new Map<string, string>();
      for (const artifact of artifacts) {
        if (artifact.content_file) {
          const bodyPath = join(root, artifact.content_file);
          if (existsSync(bodyPath)) {
            bodies.set(artifact.name, readFileSync(bodyPath, "utf-8"));
          }
        }
      }

      const tokens = buildAggregateArtifactTokens(artifacts, bodies);
      const output = tmplConfig.output_pattern;
      const label = `${agentName}:${type}`;

      try {
        const rawContent = renderArtifactTemplate(templateContent, tokens);
        const content = writeOutput(join(root, output), rawContent, dryRun, markers);
        results.push({ status: "ok", agent: label, output, content });
      } catch (err) {
        results.push({
          status: "error",
          agent: label,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    } else {
      // ── Per-artifact mode: one file per artifact ──
      for (const artifact of artifacts) {
        let body = "";
        if (artifact.content_file) {
          const bodyPath = join(root, artifact.content_file);
          if (existsSync(bodyPath)) {
            body = readFileSync(bodyPath, "utf-8");
          }
        }

        const tokens = buildArtifactTokens(artifact, body);
        const output = tmplConfig.output_pattern.replace(/\$\{name\}/g, artifact.name);
        const label = `${agentName}:${type}:${artifact.name}`;

        try {
          const rawContent = renderArtifactTemplate(templateContent, tokens);
          const content = writeOutput(join(root, output), rawContent, dryRun, markers);
          results.push({ status: "ok", agent: label, output, content });
        } catch (err) {
          results.push({
            status: "error",
            agent: label,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }
    }
  }

  return results;
}

// ─── Validate ──────────────────────────────────────────────────────────────

export function validateContract(options: ValidateOptions): Contract {
  return loadContract(options.contractPath);
}

// ─── Generate ──────────────────────────────────────────────────────────────

export function generate(options: GenerateOptions): GenerateResult {
  const { root, agents: requestedAgents, dryRun = false } = options;
  const markers = options.addMarkers !== false;

  const contractPath = join(root, "ai", "contract.yaml");
  const agentsDir = join(root, "ai", "agents");
  const overridePath = join(root, "ai.override.yaml");

  const contract = loadContract(contractPath);
  const override: Override | null = loadOverride(overridePath);

  const selection = resolveAgentSelection(requestedAgents, agentsDir);
  const results: AgentResult[] = [];

  // Report unknown agents as skipped
  for (const unknown of selection.unknown) {
    results.push({
      status: "skipped",
      agent: unknown,
      reason: `No agent folder found at ai/agents/${unknown}`,
    });
  }

  // Generate each resolved agent
  for (const agentName of selection.resolved) {
    const agentDir = join(agentsDir, agentName);

    try {
      const resolved = resolveAgent(agentsDir, agentName);

      // Determine skills rendering format per agent
      const skillsFormat: SkillsFormat =
        agentName === "copilot" ? "copilot" : agentName === "agents-md" ? "agents-md" : "markdown";

      const outputPath = join(root, resolved.config.output);
      const existingContent = existsSync(outputPath) ? readFileSync(outputPath, "utf-8") : null;
      const preservedZones = existingContent ? extractPreservedZones(existingContent) : new Map<string, string>();

      const rawContent = renderTemplate(resolved.template, { contract, override }, skillsFormat, preservedZones);
      const output = resolved.config.output;

      const content = writeOutput(outputPath, rawContent, dryRun, markers);
      results.push({ status: "ok", agent: agentName, output, content });

      // Cursor: also generate per-skill .mdc files
      if (agentName === "cursor") {
        const skillResults = generateCursorSkillFiles(root, contract, dryRun, markers);
        results.push(...skillResults);
      }

      // Template-driven artifact generation (agents, commands, MCP, etc.)
      const artifactResults = generateArtifactFiles(
        root,
        contract,
        agentName,
        agentDir,
        resolved.config,
        dryRun,
        markers,
      );
      results.push(...artifactResults);
    } catch (err) {
      results.push({
        status: "error",
        agent: agentName,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  const success = results.every((r) => r.status !== "error");
  return { results, success };
}
