/**
 * Target capability registry.
 *
 * Every row in this file is backed by a URL in `source`. Nothing is asserted
 * from intuition: if a target's behaviour for a feature has not been read in
 * that target's own documentation, the level is `unknown` — never `supported`
 * and never `unsupported`. `unknown` is a legitimate, reportable answer
 * (AGF203); a guess is not.
 *
 * Verified: 2026-08-25. Platform formats move — re-read the `source` URL before
 * changing a row or shipping a compiler that depends on it.
 */

export type CapabilityLevel =
  /** The target implements the feature natively. */
  | "supported"
  /** The target has no equivalent. Compiling this feature loses behaviour. */
  | "unsupported"
  /** Not native, but reproducible through a documented workaround. */
  | "emulated"
  /** Native but narrower than elsewhere — fewer surfaces, or partial semantics. */
  | "degraded"
  /** Not yet verified against the target's documentation. */
  | "unknown";

export type TargetId = "claude" | "copilot" | "cursor" | "agents-md" | "codex" | (string & {});

export type FeatureId =
  | "instructions.root"
  | "instructions.nested"
  | "instructions.path-scoped"
  | "instructions.imports"
  | "instructions.agents-md"
  | "skills"
  | "skills.resources"
  | "skills.allowed-tools"
  | "subagents"
  | "hooks"
  | "mcp.project-config"
  | "permissions";

export interface FeatureMeta {
  readonly id: FeatureId;
  /** Human title used in diagnostic messages. */
  readonly title: string;
  readonly description: string;
}

export const FEATURES: readonly FeatureMeta[] = [
  {
    id: "instructions.root",
    title: "repository-level instructions",
    description: "A single instruction file that applies to the whole repository.",
  },
  {
    id: "instructions.nested",
    title: "nested per-directory instructions",
    description: "Instruction files in subdirectories that apply to that subtree.",
  },
  {
    id: "instructions.path-scoped",
    title: "path-scoped instructions",
    description: "Instructions activated by glob patterns rather than unconditionally.",
  },
  {
    id: "instructions.imports",
    title: "instruction file imports",
    description: "One instruction file pulling in the content of another.",
  },
  {
    id: "instructions.agents-md",
    title: "native AGENTS.md support",
    description: "Reading AGENTS.md directly, without a bridge file.",
  },
  {
    id: "skills",
    title: "Agent Skills",
    description: "SKILL.md-based skills discovered from the repository.",
  },
  {
    id: "skills.resources",
    title: "skill resources",
    description: "Scripts, references, and assets bundled alongside SKILL.md.",
  },
  {
    id: "skills.allowed-tools",
    title: "skill tool pre-approval",
    description: "The allowed-tools frontmatter field pre-approving tools for a skill.",
  },
  {
    id: "subagents",
    title: "subagent definitions",
    description: "Named delegate agents defined by repository files.",
  },
  {
    id: "hooks",
    title: "lifecycle hooks",
    description: "Commands run by the agent at fixed lifecycle events.",
  },
  {
    id: "mcp.project-config",
    title: "repository MCP configuration",
    description: "MCP servers declared in a committed, repository-level config file.",
  },
  {
    id: "permissions",
    title: "tool permission rules",
    description: "Declarative allow/deny/ask rules for tool use.",
  },
];

export interface CapabilityRow {
  target: TargetId;
  feature: FeatureId;
  level: CapabilityLevel;
  /** Why the level is what it is, phrased for a developer reading a diagnostic. */
  note: string;
  /** Documentation URL that backs this row. Required — no unsourced claims. */
  source: string;
}

const CLAUDE_MEMORY = "https://code.claude.com/docs/en/memory";
const CLAUDE_SKILLS = "https://code.claude.com/docs/en/skills";
const CLAUDE_SUBAGENTS = "https://code.claude.com/docs/en/sub-agents";
const CLAUDE_MCP = "https://code.claude.com/docs/en/mcp";
const CLAUDE_HOOKS = "https://code.claude.com/docs/en/hooks";
const COPILOT_INSTRUCTIONS =
  "https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions";
const COPILOT_SKILLS = "https://docs.github.com/en/copilot/concepts/agents/about-agent-skills";
const CURSOR_RULES = "https://cursor.com/docs/context/rules";
const CURSOR_SKILLS = "https://cursor.com/docs/context/skills";
const AGENTS_MD = "https://agents.md/";

export const CAPABILITIES: readonly CapabilityRow[] = [
  // Claude Code
  {
    target: "claude",
    feature: "instructions.root",
    level: "supported",
    note: "./CLAUDE.md or ./.claude/CLAUDE.md, loaded every session.",
    source: CLAUDE_MEMORY,
  },
  {
    target: "claude",
    feature: "instructions.nested",
    level: "supported",
    note: "Ancestor directories load at launch; subdirectory files load on demand. Files concatenate rather than override.",
    source: CLAUDE_MEMORY,
  },
  {
    target: "claude",
    feature: "instructions.path-scoped",
    level: "supported",
    note: ".claude/rules/*.md with a `paths:` glob list. Rules without `paths` load unconditionally.",
    source: CLAUDE_MEMORY,
  },
  {
    target: "claude",
    feature: "instructions.imports",
    level: "supported",
    note: "`@path` imports, relative to the importing file, recursive to a maximum depth of 4.",
    source: CLAUDE_MEMORY,
  },
  {
    target: "claude",
    feature: "instructions.agents-md",
    level: "emulated",
    note: "Claude Code reads CLAUDE.md, not AGENTS.md. The documented bridge is a CLAUDE.md containing an @AGENTS.md import, or a symlink.",
    source: CLAUDE_MEMORY,
  },
  {
    target: "claude",
    feature: "skills",
    level: "supported",
    note: ".claude/skills/<name>/SKILL.md, plus personal and plugin locations.",
    source: CLAUDE_SKILLS,
  },
  {
    target: "claude",
    feature: "skills.resources",
    level: "supported",
    note: "Supporting files in the skill directory load on demand.",
    source: CLAUDE_SKILLS,
  },
  {
    target: "claude",
    feature: "skills.allowed-tools",
    level: "supported",
    note: "Honored, and routed through the normal permission flow.",
    source: CLAUDE_SKILLS,
  },
  {
    target: "claude",
    feature: "subagents",
    level: "supported",
    note: ".claude/agents/**/*.md with name and description frontmatter.",
    source: CLAUDE_SUBAGENTS,
  },
  {
    target: "claude",
    feature: "hooks",
    level: "supported",
    note: "Lifecycle hooks configured in settings files.",
    source: CLAUDE_HOOKS,
  },
  {
    target: "claude",
    feature: "mcp.project-config",
    level: "supported",
    note: ".mcp.json at the project root, committed and shared; servers require approval before connecting.",
    source: CLAUDE_MCP,
  },
  {
    target: "claude",
    feature: "permissions",
    level: "supported",
    note: "Allow/deny/ask permission rules in settings, enforced by the client.",
    source: CLAUDE_MEMORY,
  },

  // GitHub Copilot
  {
    target: "copilot",
    feature: "instructions.root",
    level: "supported",
    note: ".github/copilot-instructions.md applies to all requests in the repository.",
    source: COPILOT_INSTRUCTIONS,
  },
  {
    target: "copilot",
    feature: "instructions.nested",
    level: "supported",
    note: "AGENTS.md anywhere in the repository; the nearest file in the tree wins.",
    source: COPILOT_INSTRUCTIONS,
  },
  {
    target: "copilot",
    feature: "instructions.path-scoped",
    level: "degraded",
    note: ".github/instructions/*.instructions.md with applyTo globs, but these currently apply only to the Copilot cloud agent and Copilot code review, not to every Copilot surface.",
    source: COPILOT_INSTRUCTIONS,
  },
  {
    target: "copilot",
    feature: "instructions.imports",
    level: "unknown",
    note: "No import mechanism found in the repository-instructions documentation.",
    source: COPILOT_INSTRUCTIONS,
  },
  {
    target: "copilot",
    feature: "instructions.agents-md",
    level: "supported",
    note: "AGENTS.md is read directly; CLAUDE.md and GEMINI.md are also accepted at the repository root.",
    source: COPILOT_INSTRUCTIONS,
  },
  {
    target: "copilot",
    feature: "skills",
    level: "supported",
    note: "Discovered from .github/skills, .claude/skills, and .agents/skills. Works with the cloud agent, code review, CLI, app, and agent mode in VS Code and JetBrains.",
    source: COPILOT_SKILLS,
  },
  {
    target: "copilot",
    feature: "skills.resources",
    level: "supported",
    note: "Skills are folders of instructions, scripts, and resources.",
    source: COPILOT_SKILLS,
  },
  {
    target: "copilot",
    feature: "skills.allowed-tools",
    level: "unknown",
    note: "Frontmatter field support is not enumerated in the Copilot skills documentation.",
    source: COPILOT_SKILLS,
  },

  // Cursor
  {
    target: "cursor",
    feature: "instructions.root",
    level: "supported",
    note: ".cursor/rules/*.mdc with alwaysApply: true applies to every session.",
    source: CURSOR_RULES,
  },
  {
    target: "cursor",
    feature: "instructions.nested",
    level: "supported",
    note: "Nested .cursor/rules directories and nested AGENTS.md; more specific instructions take precedence.",
    source: CURSOR_RULES,
  },
  {
    target: "cursor",
    feature: "instructions.path-scoped",
    level: "supported",
    note: "A globs frontmatter field auto-attaches a rule when matching files enter context.",
    source: CURSOR_RULES,
  },
  {
    target: "cursor",
    feature: "instructions.imports",
    level: "unknown",
    note: "No import mechanism found in the rules documentation.",
    source: CURSOR_RULES,
  },
  {
    target: "cursor",
    feature: "instructions.agents-md",
    level: "supported",
    note: "AGENTS.md is supported as a metadata-free alternative to .mdc rules, at the root and nested.",
    source: CURSOR_RULES,
  },
  {
    target: "cursor",
    feature: "skills",
    level: "supported",
    note: "Loaded from .cursor/skills and .agents/skills, project and user level, including nested monorepo directories.",
    source: CURSOR_SKILLS,
  },
  {
    target: "cursor",
    feature: "skills.resources",
    level: "supported",
    note: "The scripts, references, and assets directories load progressively.",
    source: CURSOR_SKILLS,
  },
  {
    target: "cursor",
    feature: "skills.allowed-tools",
    level: "unknown",
    note: "The documented frontmatter fields are name, description, paths, disable-model-invocation, icon, color, and metadata; allowed-tools is not among them.",
    source: CURSOR_SKILLS,
  },

  // Plain AGENTS.md
  {
    target: "agents-md",
    feature: "instructions.root",
    level: "supported",
    note: "AGENTS.md at the repository root.",
    source: AGENTS_MD,
  },
  {
    target: "agents-md",
    feature: "instructions.nested",
    level: "supported",
    note: "Nested AGENTS.md files are read; the nearest file in the tree takes precedence.",
    source: AGENTS_MD,
  },
  {
    target: "agents-md",
    feature: "instructions.path-scoped",
    level: "unsupported",
    note: "AGENTS.md is plain Markdown with no frontmatter, so there is nowhere to express a path scope.",
    source: AGENTS_MD,
  },
  {
    target: "agents-md",
    feature: "instructions.imports",
    level: "unsupported",
    note: "The format defines no import directive.",
    source: AGENTS_MD,
  },
  {
    target: "agents-md",
    feature: "instructions.agents-md",
    level: "supported",
    note: "This target is AGENTS.md.",
    source: AGENTS_MD,
  },
  {
    target: "agents-md",
    feature: "skills",
    level: "unsupported",
    note: "AGENTS.md is a single Markdown file and defines no skill concept. Skills must be emitted for a specific agent target instead.",
    source: AGENTS_MD,
  },
  {
    target: "agents-md",
    feature: "subagents",
    level: "unsupported",
    note: "The format defines no subagent concept.",
    source: AGENTS_MD,
  },
  {
    target: "agents-md",
    feature: "hooks",
    level: "unsupported",
    note: "The format defines no hook concept.",
    source: AGENTS_MD,
  },
  {
    target: "agents-md",
    feature: "mcp.project-config",
    level: "unsupported",
    note: "The format defines no MCP configuration.",
    source: AGENTS_MD,
  },
  {
    target: "agents-md",
    feature: "permissions",
    level: "unsupported",
    note: "The format defines no permission rules.",
    source: AGENTS_MD,
  },

  // Codex. Only the AGENTS.md rows are verified; every other combination is
  // deliberately absent, and therefore resolves to `unknown`.
  {
    target: "codex",
    feature: "instructions.root",
    level: "supported",
    note: "Listed as an AGENTS.md-consuming agent.",
    source: AGENTS_MD,
  },
  {
    target: "codex",
    feature: "instructions.nested",
    level: "supported",
    note: "Nested AGENTS.md, nearest file wins, per the AGENTS.md standard.",
    source: AGENTS_MD,
  },
  {
    target: "codex",
    feature: "instructions.agents-md",
    level: "supported",
    note: "Listed as an AGENTS.md-consuming agent.",
    source: AGENTS_MD,
  },
];

/** Targets that have at least one verified row. */
export const KNOWN_TARGETS: readonly TargetId[] = [...new Set(CAPABILITIES.map((row) => row.target))].sort();

const INDEX = new Map<string, CapabilityRow>(CAPABILITIES.map((row) => [`${row.target} ${row.feature}`, row]));

export function featureMeta(feature: FeatureId): FeatureMeta | undefined {
  return FEATURES.find((entry) => entry.id === feature);
}

/**
 * Looks up a capability. An absent row is not an error — it means nobody has
 * verified this combination yet, which is reported as `unknown`.
 */
export function capability(target: TargetId, feature: FeatureId): CapabilityRow {
  const found = INDEX.get(`${target} ${feature}`);
  if (found) return found;

  return {
    target,
    feature,
    level: "unknown",
    note: `No verified information about ${feature} on target "${target}".`,
    source: "",
  };
}

/** Every verified row for a target, ordered by feature id. */
export function targetCapabilities(target: TargetId): CapabilityRow[] {
  return CAPABILITIES.filter((row) => row.target === target).sort((a, b) => a.feature.localeCompare(b.feature));
}

/** True only when the target is verified to support the feature natively. */
export function supports(target: TargetId, feature: FeatureId): boolean {
  return capability(target, feature).level === "supported";
}
