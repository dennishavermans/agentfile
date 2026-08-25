/**
 * Normalized intermediate representation.
 *
 * This module must not import anything platform-specific. Platform identity
 * lives in `Provenance.platform` and in the capability registry — never in the
 * shape of the data. A new platform is a discovery adapter plus a compiler
 * adapter plus capability rows; it is never an IR change.
 *
 * Every node carries provenance. That is what makes `context`, `explain`,
 * located diagnostics, and lossy-compilation reporting fall out of one
 * primitive instead of three parallel implementations.
 */

/**
 * Known platform identifiers, open for extension. The `(string & {})` arm keeps
 * editor completion for the known values while still accepting a new adapter's
 * identifier without a core change.
 */
export type PlatformId =
  | "agentfile"
  | "agents-md"
  | "claude"
  | "copilot"
  | "cursor"
  | "codex"
  | "generic"
  | (string & {});

/**
 * Where a piece of configuration sits in the inheritance chain, broadest first.
 * The ordering of this union is the precedence order and is relied upon by the
 * resolver — see `SCOPE_RANK`.
 */
export type ConfigScope = "managed" | "user" | "project" | "directory" | "local";

/** How the node came to exist. */
export type ConfigOrigin =
  /** Written literally in a source file. */
  | "declared"
  /** Extracted from prose by agentfile (e.g. bullets parsed out of a markdown block). */
  | "derived"
  /** Pulled in by an import directive such as CLAUDE.md's `@path`. */
  | "imported"
  /** Produced by a previous agentfile compilation. */
  | "generated";

export interface Provenance {
  /** Project-relative POSIX path of the file this came from. */
  file: string;
  /** 1-based line, when the source format supports position tracking. */
  line?: number;
  /** 1-based column. */
  column?: number;
  platform: PlatformId;
  scope: ConfigScope;
  origin: ConfigOrigin;
  /** Free-form note shown in `explain` output, e.g. "imported by CLAUDE.md:3". */
  note?: string;
}

/**
 * How a node decides whether it applies. Each variant corresponds to behaviour
 * that a real platform documents — see docs/v2-architecture.md §5.
 */
export type Applicability =
  /** Loaded unconditionally. Root CLAUDE.md, Cursor `alwaysApply: true`. */
  | { kind: "always" }
  /** Applies to a directory subtree. Nested AGENTS.md / CLAUDE.md. */
  | { kind: "directory"; directory: string }
  /** Applies to paths matching globs. `paths:`, Cursor `globs:`, Copilot `applyTo:`. */
  | { kind: "paths"; patterns: string[] }
  /** The agent chooses based on the description. Skills, Cursor "apply intelligently". */
  | { kind: "model-selected" }
  /** Only when the user explicitly invokes it. */
  | { kind: "manual" };

/**
 * An opaque markdown instruction block, as authored. Foreign instruction files
 * (AGENTS.md, CLAUDE.md, copilot-instructions.md) become instructions: agentfile
 * does not pretend to understand their internal structure.
 */
export interface Instruction {
  /** Stable identifier, derived from provenance. Used by `explain`. */
  id: string;
  /** Heading or filename this block came from, when there is one. */
  title?: string;
  /** Markdown body, verbatim. */
  body: string;
  /**
   * 1-based line in the source file where `body` starts. Defaults to 1 when
   * absent. Set by parsers that skip frontmatter, so positions derived from the
   * body still point at the right line in the real file.
   */
  bodyLine?: number;
  applies: Applicability;
  provenance: Provenance;
  /** Import targets declared inside the body, unresolved (e.g. CLAUDE.md `@path`). */
  imports?: string[];
}

/**
 * A single atomic statement — "use pnpm", "prefer small composable functions".
 *
 * Directives are what make statement-level conflict and duplicate detection
 * possible. Structured sources (contract.yaml rule lists) produce them
 * directly with `origin: "declared"`; prose sources produce them with
 * `origin: "derived"` once a parser extracts them.
 */
export interface Directive {
  id: string;
  /** The statement itself, trimmed. One rule per directive. */
  text: string;
  /** Open-ended grouping label, e.g. "coding". Not an enum by design. */
  category?: string;
  applies: Applicability;
  provenance: Provenance;
}

export type SkillResourceKind = "script" | "reference" | "asset" | "other";

export interface SkillResource {
  /** Path relative to the skill directory. */
  path: string;
  kind: SkillResourceKind;
}

/**
 * A skill, shaped after the Agent Skills specification rather than an
 * agentfile-specific format. Fields beyond the spec's six are preserved in
 * `extensions` so nothing is lost and portability can be reported on.
 */
export interface SkillEntry {
  /** Stable identifier, derived from provenance. Used by `explain`. */
  id: string;
  /** Spec: 1–64 chars, lowercase alphanumerics and single hyphens. */
  name: string;
  /** Spec: 1–1024 chars. */
  description: string;
  license?: string;
  /** Spec: 1–500 chars. */
  compatibility?: string;
  metadata?: Record<string, string>;
  /** Spec: pre-approved tools. Experimental in the spec itself. */
  allowedTools?: string[];
  /** Markdown body after the frontmatter. */
  body: string;
  /** Non-spec frontmatter keys, preserved verbatim for portability analysis. */
  extensions?: Record<string, unknown>;
  resources: SkillResource[];
  applies: Applicability;
  provenance: Provenance;
  /** Directory containing SKILL.md, when the skill came from a real directory. */
  directory?: string;
}

export interface SubagentEntry {
  name: string;
  description: string;
  /** Tool allowlist, as authored. */
  tools?: string[];
  /** Tool denylist, as authored. */
  disallowedTools?: string[];
  model?: string;
  body: string;
  extensions?: Record<string, unknown>;
  provenance: Provenance;
}

/**
 * A lifecycle hook. The `command` is DATA — it is recorded and analysed
 * statically and is never executed by any static-analysis code path.
 */
export interface HookEntry {
  /** Platform event name, e.g. "PreToolUse". Not an enum: platforms differ. */
  event: string;
  /** Tool/matcher expression the hook is scoped to, when the platform has one. */
  matcher?: string;
  command: string;
  provenance: Provenance;
}

export type McpTransport = "stdio" | "http" | "sse" | "ws";

export interface McpServerEntry {
  name: string;
  transport: McpTransport;
  /** stdio only. */
  command?: string;
  /** stdio only. */
  args?: string[];
  env?: Record<string, string>;
  /** Remote transports only. */
  url?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  provenance: Provenance;
}

export interface PermissionRule {
  effect: "allow" | "deny" | "ask";
  /** Rule expression, as authored, e.g. `Bash(git:*)`. */
  rule: string;
  provenance: Provenance;
}

/**
 * A named entity that compiles to one or more target files. Carried over from
 * the contract v1 `artifacts` concept, whose open `type` field was already an
 * adapter seam worth keeping.
 */
export interface ArtifactEntry {
  name: string;
  /** Open-ended logical type, e.g. "agent", "command", "mcp-server". */
  type: string;
  description: string;
  /** Project-relative path whose content becomes the artifact body. */
  contentFile?: string;
  metadata: Record<string, unknown>;
  provenance: Provenance;
}

export interface DocEntry {
  name: string;
  /** Project-relative path. */
  file: string;
  /** Short token used to reference the doc from templates. */
  token: string;
  provenance: Provenance;
}

export interface ProjectMetadata {
  name?: string;
  stack: string[];
}

/** A file that contributed to the configuration. Powers traceability. */
export interface SourceFile {
  /** Project-relative POSIX path. */
  path: string;
  platform: PlatformId;
  scope: ConfigScope;
  /** What kind of source this is, e.g. "contract", "instructions", "skill". */
  kind: string;
  /** Byte length, when known. Used by context-budget analysis. */
  bytes?: number;
}

/** IR envelope version. Bump only on a breaking change to these types. */
export const IR_VERSION = 1;

export interface AgentConfiguration {
  version: typeof IR_VERSION;
  /** Absolute filesystem root the relative paths are anchored to. */
  root: string;
  project: ProjectMetadata;
  instructions: Instruction[];
  directives: Directive[];
  skills: SkillEntry[];
  subagents: SubagentEntry[];
  hooks: HookEntry[];
  mcpServers: McpServerEntry[];
  permissions: PermissionRule[];
  artifacts: ArtifactEntry[];
  docs: DocEntry[];
  sources: SourceFile[];
}
