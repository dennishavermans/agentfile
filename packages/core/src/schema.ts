import { z } from "zod";

// ─── Skill ─────────────────────────────────────────────────────────────────

export const SkillExampleSchema = z.object({
  input: z.string(),
  output: z.string(),
});

export const SkillSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  context: z.array(z.string()).optional().default([]),
  steps: z.array(z.string()).min(1, "A skill must have at least one step"),
  expected_output: z.string().optional().default(""),
  examples: z.array(SkillExampleSchema).optional().default([]),
});

// ─── Artifact ──────────────────────────────────────────────────────────────
// A generic contract entity with a stable identity, a type label, and an open
// metadata namespace. Artifacts cover any named entity that generates per-IDE
// output files: agents, commands, MCP servers, prompt files, or anything new
// that a future IDE introduces — without schema changes.

export const ArtifactSchema = z.object({
  /** Stable identity used across IDEs and referenced in templates. */
  name: z.string().min(1),
  /**
   * Logical type. Example values: "agent", "command", "mcp-server".
   * Used to select the matching artifact_template in an IDE agent's config.
   * Not an enum — intentionally open for future artifact types.
   */
  type: z.string().min(1),
  /** Human-readable purpose. Available in templates as ${description}. */
  description: z.string().optional().default(""),
  /**
   * Path to a markdown/text file (relative to repo root) whose content is
   * injected into the rendered artifact as ${body}. When absent the template
   * receives an empty string for ${body}.
   */
  content_file: z.string().optional(),
  /**
   * Open key-value bag for platform-specific settings. Templates can reference
   * any key via ${metadata.<key>}. Values are always coerced to strings in
   * the token map; arrays are joined with ", ".
   */
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

// ─── Doc Reference ──────────────────────────────────────────────────────────
// Team documents (DoD, DoR, pre-commit hooks) that templates can reference
// via ${docs.<token>}.

export const DocReferenceSchema = z.object({
  name: z.string().min(1),
  /** Path relative to repo root. */
  file: z.string().min(1),
  /**
   * Short identifier used in templates as ${docs.<token>}.
   * Defaults to `name` when absent.
   */
  token: z.string().optional(),
});

// ─── Contract ──────────────────────────────────────────────────────────────

export const ContractSchema = z.object({
  version: z.literal(1, {
    error: "Unsupported contract version. Only version 1 is supported.",
  }),
  project: z.object({
    name: z.string().min(1, "project.name must not be empty"),
    stack: z
      .array(z.string())
      .min(1, "project.stack must contain at least one entry"),
  }),
  rules: z
    .object({
      coding: z.array(z.string()).optional().default([]),
      architecture: z.array(z.string()).optional().default([]),
      testing: z.array(z.string()).optional().default([]),
      naming: z.array(z.string()).optional().default([]),
    })
    .default(() => ({
      coding: [],
      architecture: [],
      testing: [],
      naming: [],
    })),
  skills: z
    .array(SkillSchema)
    .min(1, "contract must define at least one skill"),
  /**
   * Named entities that generate per-IDE output files.
   * Each artifact has a `type` that maps to an `artifact_templates` entry
   * in the IDE agent's config.yaml.
   */
  artifacts: z.array(ArtifactSchema).optional().default([]),
  /** Team document references usable as ${docs.<token>} in templates. */
  docs: z.array(DocReferenceSchema).optional().default([]),
});

// ─── Agent Config ──────────────────────────────────────────────────────────
// Per-IDE agent configuration (ai/agents/<ide>/config.yaml).

export const ArtifactTemplateSchema = z.object({
  /**
   * Output path pattern. May contain ${name} which is replaced with the
   * artifact's name at generation time.
   * Example: ".github/agents/${name}.agent.md"
   */
  output_pattern: z.string().min(1),
  /**
   * Filename of the template within the agent's directory.
   * Example: "agent.md" → resolved as ai/agents/<ide>/agent.md
   */
  template: z.string().min(1),
  /**
   * When true, all artifacts of this type are rendered into a single file
   * using the template once (the template receives all artifacts as a list).
   * When false (default), the template is rendered once per artifact.
   */
  aggregate: z.boolean().optional().default(false),
});

export const AgentConfigSchema = z.object({
  name: z.string().min(1),
  output: z.string().min(1, "output path must not be empty"),
  description: z.string(),
  /**
   * Map of artifact type → template config. Keyed by the `type` field on
   * artifacts in the contract (e.g. "agent", "command", "mcp-server").
   * When no entry exists for a given artifact type, that type is skipped
   * for this IDE.
   */
  artifact_templates: z
    .record(z.string(), ArtifactTemplateSchema)
    .optional()
    .default({}),
});

// ─── Override ──────────────────────────────────────────────────────────────

export const OverrideSchema = z.object({
  blocks: z
    .array(
      z.object({
        section: z.string().min(1),
        content: z.string(),
      }),
    )
    .default([]),
});

// ─── Exported Types ────────────────────────────────────────────────────────

export type Skill = z.output<typeof SkillSchema>;
export type Artifact = z.output<typeof ArtifactSchema>;
export type DocReference = z.output<typeof DocReferenceSchema>;
export type ArtifactTemplate = z.output<typeof ArtifactTemplateSchema>;
export type Contract = z.output<typeof ContractSchema>;
export type AgentConfig = z.output<typeof AgentConfigSchema>;
export type Override = z.output<typeof OverrideSchema>;

// ─── Agent Selection ───────────────────────────────────────────────────────

export interface AgentSelection {
  requested: string[];
  available: string[];
  resolved: string[];
  unknown: string[];
}

// ─── Agent (resolved, ready for generation) ────────────────────────────────

export interface ResolvedAgent {
  name: string;
  config: AgentConfig;
  template: string;
}

// ─── Generation Result ─────────────────────────────────────────────────────

export type AgentResult =
  | { status: "ok"; agent: string; output: string; content: string }
  | { status: "skipped"; agent: string; reason: string }
  | { status: "error"; agent: string; error: Error };

export interface GenerateResult {
  results: AgentResult[];
  success: boolean;
}
