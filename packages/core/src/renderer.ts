import type { Artifact, Contract, DocReference, Override, Skill } from "./schema.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RenderContext {
  contract: Contract;
  override: Override | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function renderList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "_None defined._";
}

function renderOverrideBlocks(override: Override | null): string {
  if (!override?.blocks?.length) return "";
  return override.blocks.map((block) => `\n## ${block.section}\n\n${block.content.trim()}`).join("\n");
}

// ─── Skill Renderers ───────────────────────────────────────────────────────
// Each format is a pure function: Skill → string

export function renderSkillMarkdown(skill: Skill): string {
  const lines: string[] = [];

  lines.push(`### ${skill.name}`);
  lines.push(`${skill.description}\n`);

  if (skill.context.length) {
    lines.push("**Context**");
    for (const c of skill.context) {
      lines.push(`- ${c}`);
    }
    lines.push("");
  }

  lines.push("**Steps**");
  for (let i = 0; i < skill.steps.length; i++) {
    lines.push(`${i + 1}. ${skill.steps[i]}`);
  }
  lines.push("");

  if (skill.expected_output) {
    lines.push("**Expected output**");
    lines.push(skill.expected_output.trim());
    lines.push("");
  }

  if (skill.examples.length) {
    lines.push("**Examples**");
    skill.examples.forEach((ex) => {
      lines.push(`- Input: \`${ex.input}\``);
      lines.push(`  Output: ${ex.output.trim()}`);
    });
    lines.push("");
  }

  return lines.join("\n");
}

export function renderSkillMdc(skill: Skill): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push(`description: ${skill.description}`);
  lines.push("alwaysApply: false");
  lines.push("---");
  lines.push("");
  lines.push(`# ${skill.name}`);
  lines.push("");

  if (skill.context.length) {
    lines.push("## Context");
    for (const c of skill.context) {
      lines.push(`- ${c}`);
    }
    lines.push("");
  }

  lines.push("## Steps");
  for (let i = 0; i < skill.steps.length; i++) {
    lines.push(`${i + 1}. ${skill.steps[i]}`);
  }
  lines.push("");

  if (skill.expected_output) {
    lines.push("## Expected output");
    lines.push(skill.expected_output.trim());
    lines.push("");
  }

  if (skill.examples.length) {
    lines.push("## Examples");
    skill.examples.forEach((ex) => {
      lines.push(`**Input:** ${ex.input}`);
      lines.push(`**Output:** ${ex.output.trim()}`);
      lines.push("");
    });
  }

  return `${lines.join("\n").trim()}\n`;
}

export function renderSkillCopilot(skill: Skill): string {
  const steps = skill.steps.join("; ");
  const context = skill.context.length ? ` Context: ${skill.context.join(", ")}.` : "";
  return `- **${skill.name}**: ${skill.description}.${context} Steps: ${steps}.`;
}

// ─── Artifact Token Builder ───────────────────────────────────────────────
// Converts an Artifact's fields + open metadata into a flat token map
// that renderArtifactTemplate can inject into per-IDE artifact templates.

function stringifyMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Builds a token map for a single artifact. Available tokens:
 *   ${name}            — artifact name
 *   ${type}            — artifact type
 *   ${description}     — artifact description
 *   ${body}            — content from content_file (or empty)
 *   ${metadata.<key>}  — any metadata key, stringified
 */
export function buildArtifactTokens(artifact: Artifact, body: string): Record<string, string> {
  const tokens: Record<string, string> = {
    name: artifact.name,
    type: artifact.type,
    description: artifact.description,
    body,
  };

  for (const [key, value] of Object.entries(artifact.metadata)) {
    tokens[`metadata.${key}`] = stringifyMetadataValue(value);
  }

  return tokens;
}

/**
 * Builds a combined token map for all artifacts of a given type.
 * Used when artifact_templates[type].aggregate === true.
 * Exposes ${artifacts_json} as a JSON array for JSON-format templates.
 */
export function buildAggregateArtifactTokens(
  artifacts: Artifact[],
  bodies: Map<string, string>,
): Record<string, string> {
  const jsonEntries = artifacts.map((a) => ({
    name: a.name,
    type: a.type,
    description: a.description,
    body: bodies.get(a.name) ?? "",
    metadata: a.metadata,
  }));

  return {
    artifacts_json: JSON.stringify(jsonEntries, null, 2),
    artifacts_count: String(artifacts.length),
  };
}

/**
 * Renders an artifact template string using a flat token map.
 * Uses the same ${token} syntax as the main renderTemplate, but operates
 * on an arbitrary token map rather than a contract-derived RenderContext.
 */
export function renderArtifactTemplate(template: string, tokens: Record<string, string>): string {
  const pattern = new RegExp(`\\$\\{(${Object.keys(tokens).map(escapeRegExp).join("|")})\\}`, "g");

  return `${template.replace(pattern, (_match, token: string) => tokens[token] ?? _match).trim()}\n`;
}

// ─── Docs Token Builder ───────────────────────────────────────────────────

/**
 * Builds a token→path map for docs[] entries so templates can use
 * ${docs.<token>} to reference team document paths.
 */
export function buildDocsTokens(docs: DocReference[]): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const doc of docs) {
    const key = `docs.${doc.token ?? doc.name}`;
    tokens[key] = doc.file;
  }
  return tokens;
}

// ─── Skills Block Renderers ────────────────────────────────────────────────

function renderSkillsMarkdown(skills: Skill[]): string {
  if (!skills.length) return "";
  return `\n## Skills\n\n${skills.map(renderSkillMarkdown).join("\n")}`;
}

function renderSkillsCopilot(skills: Skill[]): string {
  if (!skills.length) return "";
  return `\n## Available Workflows\n\n${skills.map(renderSkillCopilot).join("\n")}`;
}

function renderSkillsAgentsMd(skills: Skill[]): string {
  if (!skills.length) return "";
  return `\n## Skills\n\n${skills.map(renderSkillMarkdown).join("\n")}`;
}

// ─── Token Map ─────────────────────────────────────────────────────────────

export type SkillsFormat = "markdown" | "copilot" | "agents-md";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildTokenMap(ctx: RenderContext, skillsFormat: SkillsFormat): Record<string, string> {
  const { project, rules, skills, docs } = ctx.contract;

  const renderSkills = () => {
    switch (skillsFormat) {
      case "copilot":
        return renderSkillsCopilot(skills);
      case "agents-md":
        return renderSkillsAgentsMd(skills);
      default:
        return renderSkillsMarkdown(skills);
    }
  };

  return {
    "project.name": project.name,
    "project.stack.join(', ')": project.stack.join(", "),
    "rules.coding": renderList(rules.coding),
    "rules.architecture": renderList(rules.architecture),
    "rules.testing": renderList(rules.testing),
    "rules.naming": renderList(rules.naming),
    skills: renderSkills(),
    override: renderOverrideBlocks(ctx.override),
    ...buildDocsTokens(docs),
  };
}

// ─── Preserve Zones ───────────────────────────────────────────────────────

const PRESERVE_BLOCK = /<!--\s*agentfile:preserve\s+id="([^"]+)"\s*-->([\s\S]*?)<!--\s*agentfile:end-preserve\s*-->/g;

/**
 * Scans an already-rendered on-disk file and returns a Map of
 * preserve-zone id → literal content string for every zone found.
 *
 * Call this on the existing file before re-rendering; then pass the
 * returned Map to `renderTemplate` so the preserved content survives sync.
 */
export function extractPreservedZones(content: string): Map<string, string> {
  const zones = new Map<string, string>();
  PRESERVE_BLOCK.lastIndex = 0;
  let match = PRESERVE_BLOCK.exec(content);
  while (match !== null) {
    zones.set(match[1], match[2]);
    match = PRESERVE_BLOCK.exec(content);
  }
  return zones;
}

/**
 * Re-injects preserved zone content into a freshly rendered string.
 * For each `<!-- agentfile:preserve id="X" --> ... <!-- agentfile:end-preserve -->`
 * pair found in `rendered`, the inner content is replaced by `zones.get(X)` when
 * a matching zone exists. When no match exists the template default is kept.
 */
function applyPreservedZones(rendered: string, zones: Map<string, string>): string {
  PRESERVE_BLOCK.lastIndex = 0;
  return rendered.replace(
    /<!--\s*agentfile:preserve\s+id="([^"]+)"\s*-->([\s\S]*?)<!--\s*agentfile:end-preserve\s*-->/g,
    (_match, id: string, templateDefault: string) => {
      const preserved = zones.get(id);
      const inner = preserved !== undefined ? preserved : templateDefault;
      return `<!-- agentfile:preserve id="${id}" -->${inner}<!-- agentfile:end-preserve -->`;
    },
  );
}

// ─── Renderer ─────────────────────────────────────────────────────────────

/**
 * Renders a template string using a RenderContext.
 * skillsFormat controls how skills are rendered for a given agent.
 * preservedZones should be the result of extractPreservedZones() called on the
 * existing on-disk file (if any) — zones are re-injected verbatim so that
 * IDE-native config inside the file is not lost on sync.
 */
export function renderTemplate(
  template: string,
  ctx: RenderContext,
  skillsFormat: SkillsFormat = "markdown",
  preservedZones: Map<string, string> = new Map(),
): string {
  const tokens = buildTokenMap(ctx, skillsFormat);

  const tokenPattern = new RegExp(`\\$\\{(${Object.keys(tokens).map(escapeRegExp).join("|")})\\}`, "g");

  let output = template.replace(tokenPattern, (_match, token: string) => tokens[token] ?? _match);

  if (preservedZones.size > 0) {
    output = applyPreservedZones(output, preservedZones);
  }

  return `${output.trim()}\n`;
}
