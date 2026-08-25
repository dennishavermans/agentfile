/**
 * Deterministic resolution.
 *
 * Given a normalized configuration and a path, answer:
 *
 *   • what applies here
 *   • why it applies
 *   • where it came from
 *   • what was considered and rejected, and why
 *
 * There is exactly one resolution implementation. `context`, `explain`,
 * `doctor`, `validate`, and `compile` all consume this — nothing re-derives
 * applicability on its own.
 *
 * Nothing here touches the filesystem, so resolution is pure, fast, and
 * trivially testable.
 */

import { type Diagnostic, diagnostic } from "../diagnostics/index.js";
import type {
  AgentConfiguration,
  Applicability,
  ConfigScope,
  Directive,
  HookEntry,
  Instruction,
  McpServerEntry,
  PermissionRule,
  Provenance,
  SkillEntry,
  SubagentEntry,
} from "../ir/index.js";
import { compareGlobSpecificity, dirnameOf, isWithin, matchingPatterns, pathDepth } from "../paths/index.js";

/**
 * Precedence of scopes, broadest first. A higher rank is more specific and
 * therefore wins an override and appears later in a concatenation.
 *
 * This mirrors the load order the platforms document for hierarchical
 * instruction files: organisation policy, then the developer's own settings,
 * then the repository, then a directory inside it, then the developer's
 * untracked local overrides.
 */
export const SCOPE_RANK: Record<ConfigScope, number> = {
  managed: 0,
  user: 1,
  project: 2,
  directory: 3,
  local: 4,
};

/** Specificity tiers within a single scope and depth. */
const TIER = {
  always: 0,
  directory: 1,
  paths: 2,
} as const;

export type MatchReason =
  | { kind: "always"; detail: string }
  | { kind: "directory"; directory: string; detail: string }
  | { kind: "paths"; patterns: string[]; detail: string }
  | { kind: "model-selected"; detail: string };

export type ExclusionReason =
  | { kind: "outside-directory"; directory: string; detail: string }
  | { kind: "no-pattern-match"; patterns: string[]; detail: string }
  | { kind: "manual-only"; detail: string };

/**
 * The sort key behind resolution order. Exposed rather than hidden so `explain`
 * can show a developer exactly why one node beat another.
 */
export interface ResolutionRank {
  /** SCOPE_RANK of the node's scope. */
  scope: number;
  /** Depth of the directory that governs the node. Root is 0. */
  depth: number;
  /** 0 unconditional, 1 directory-scoped, 2 glob-scoped. */
  tier: number;
  /** Most specific pattern that matched, for glob-scoped nodes. */
  pattern?: string;
  /** Position in the source array, the final tiebreaker. */
  order: number;
}

export interface Applied<T> {
  node: T;
  reason: MatchReason;
  rank: ResolutionRank;
}

export interface Excluded {
  /** Node kind, e.g. "instruction" or "skill". */
  kind: string;
  /** Short label identifying the node in output. */
  label: string;
  provenance: Provenance;
  reason: ExclusionReason;
}

export interface EffectiveConfiguration {
  /** The normalized path this resolution answers for. */
  path: string;
  /** Ordered least- to most-specific. Instructions concatenate in this order. */
  instructions: Applied<Instruction>[];
  /** Ordered least- to most-specific. The last directive wins an override. */
  directives: Applied<Directive>[];
  /** Skills available at this path. Availability, not activation. */
  skills: Applied<SkillEntry>[];
  /** Node kinds that no verified platform scopes by path. */
  subagents: SubagentEntry[];
  hooks: HookEntry[];
  mcpServers: McpServerEntry[];
  permissions: PermissionRule[];
  /** Considered but not applied, with the reason. Powers "why not?" questions. */
  excluded: Excluded[];
  diagnostics: Diagnostic[];
}

// ─── Applicability evaluation ──────────────────────────────────────────────

/**
 * The directory that governs a node.
 *
 * For a directory-scoped node it is the directory itself. For everything else
 * it is the directory holding the source file, which is what makes a nested
 * `.claude/rules/` or `.cursor/rules/` outrank the repository root one.
 */
function governingDirectory(applies: Applicability, provenance: Provenance): string {
  if (applies.kind === "directory") return applies.directory;
  return dirnameOf(provenance.file);
}

type Evaluation =
  | { applies: true; reason: MatchReason; tier: number; pattern?: string }
  | { applies: false; reason: ExclusionReason };

function evaluate(applies: Applicability, path: string): Evaluation {
  switch (applies.kind) {
    case "always":
      return {
        applies: true,
        tier: TIER.always,
        reason: { kind: "always", detail: "loaded unconditionally" },
      };

    case "directory": {
      if (!isWithin(applies.directory, path)) {
        return {
          applies: false,
          reason: {
            kind: "outside-directory",
            directory: applies.directory,
            detail: `${path} is not inside ${applies.directory || "the project root"}`,
          },
        };
      }
      return {
        applies: true,
        tier: TIER.directory,
        reason: {
          kind: "directory",
          directory: applies.directory,
          detail: `${path} is inside ${applies.directory || "the project root"}`,
        },
      };
    }

    case "paths": {
      const matched = matchingPatterns(path, applies.patterns);
      if (!matched.length) {
        return {
          applies: false,
          reason: {
            kind: "no-pattern-match",
            patterns: [...applies.patterns],
            detail: `${path} matches none of: ${applies.patterns.join(", ")}`,
          },
        };
      }
      // Most specific match last, so it is the one that ranks the node.
      const ranked = [...matched].sort(compareGlobSpecificity);
      const pattern = ranked[ranked.length - 1];
      return {
        applies: true,
        tier: TIER.paths,
        pattern,
        reason: {
          kind: "paths",
          patterns: matched,
          detail: `${path} matches ${pattern}`,
        },
      };
    }

    case "model-selected":
      return {
        applies: true,
        tier: TIER.always,
        reason: {
          kind: "model-selected",
          detail: "available everywhere; the agent decides from the description",
        },
      };

    case "manual":
      return {
        applies: false,
        reason: {
          kind: "manual-only",
          detail: "only applies when invoked explicitly",
        },
      };
  }
}

function rankOf(applies: Applicability, provenance: Provenance, evaluation: Evaluation, order: number): ResolutionRank {
  if (!evaluation.applies) throw new Error("rankOf called for a node that does not apply");

  return {
    scope: SCOPE_RANK[provenance.scope],
    depth: pathDepth(governingDirectory(applies, provenance)),
    tier: evaluation.tier,
    pattern: evaluation.pattern,
    order,
  };
}

/**
 * Resolution order, least specific first:
 *
 *   1. scope       — managed, user, project, directory, local
 *   2. depth       — a deeper governing directory is more specific
 *   3. tier        — unconditional, then directory-scoped, then glob-scoped
 *   4. specificity — for glob-scoped nodes, by pattern specificity
 *   5. order       — declaration order, so the result is always total and stable
 */
function compareApplied(a: ResolutionRank, b: ResolutionRank): number {
  if (a.scope !== b.scope) return a.scope - b.scope;
  if (a.depth !== b.depth) return a.depth - b.depth;
  if (a.tier !== b.tier) return a.tier - b.tier;

  if (a.pattern !== undefined && b.pattern !== undefined && a.pattern !== b.pattern) {
    return compareGlobSpecificity(a.pattern, b.pattern);
  }

  return a.order - b.order;
}

interface Selectable {
  applies: Applicability;
  provenance: Provenance;
}

function select<T extends Selectable>(
  nodes: readonly T[],
  path: string,
  kind: string,
  label: (node: T) => string,
): { applied: Applied<T>[]; excluded: Excluded[] } {
  const applied: Applied<T>[] = [];
  const excluded: Excluded[] = [];

  for (let order = 0; order < nodes.length; order++) {
    const node = nodes[order];
    const evaluation = evaluate(node.applies, path);

    if (evaluation.applies) {
      applied.push({
        node,
        reason: evaluation.reason,
        rank: rankOf(node.applies, node.provenance, evaluation, order),
      });
    } else {
      excluded.push({ kind, label: label(node), provenance: node.provenance, reason: evaluation.reason });
    }
  }

  applied.sort((a, b) => compareApplied(a.rank, b.rank));
  return { applied, excluded };
}

// ─── Duplicate detection ───────────────────────────────────────────────────

/**
 * Normalises a directive for comparison: case, surrounding whitespace, internal
 * whitespace runs, and trailing sentence punctuation. Deliberately conservative
 * — this detects genuine duplicates, not paraphrases. Near-duplicate detection
 * needs similarity metrics and belongs in the analysis layer.
 */
export function normalizeDirectiveText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!;,]+$/, "");
}

function detectDuplicateDirectives(applied: readonly Applied<Directive>[]): Diagnostic[] {
  const groups = new Map<string, Applied<Directive>[]>();

  for (const entry of applied) {
    // Only declared directives. Directives derived from prose are covered by
    // line-level overlap detection, which catches bullets and plain prose
    // alike — reporting both would double up on every bullet.
    if (entry.node.provenance.origin !== "declared") continue;

    const key = normalizeDirectiveText(entry.node.text);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  const diagnostics: Diagnostic[] = [];

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    // Only report when the duplicates come from different files. Repetition
    // inside one file is a lint concern about that file, not a resolution
    // problem about two sources disagreeing on ownership.
    const files = new Set(group.map((entry) => entry.node.provenance.file));
    if (files.size < 2) continue;

    const [first, ...rest] = group;
    const platforms = [...new Set(group.map((entry) => String(entry.node.provenance.platform)))].sort();

    // Whether the copies span platforms changes the advice: one platform means
    // redundant context, several means the rule will drift between tools.
    const explanation =
      platforms.length > 1
        ? `The same instruction is maintained separately for ${platforms.join(", ")}. ` +
          "Every copy costs context in every session, and editing one and forgetting the others is how " +
          "agent configuration silently disagrees with itself."
        : `The same instruction reaches this path from ${files.size} different files. ` +
          "Duplicated context costs tokens in every session and drifts apart as one copy is edited.";

    diagnostics.push(
      diagnostic({
        code: "AGF302",
        message: `Duplicate instruction: "${first.node.text}"`,
        explanation,
        suggestion: `Keep the instruction in one place and remove the ${rest.length} other ${
          rest.length === 1 ? "copy" : "copies"
        }.`,
        location: { file: first.node.provenance.file, line: first.node.provenance.line },
        related: rest.map((entry) => ({
          location: { file: entry.node.provenance.file, line: entry.node.provenance.line },
          message: "also declared here",
        })),
        data: { text: first.node.text, copies: group.length, platforms: platforms.join(",") },
      }),
    );
  }

  return diagnostics;
}

// ─── Entry point ───────────────────────────────────────────────────────────

export interface ResolveOptions {
  /** Include AGF302 duplicate-instruction diagnostics. Default true. */
  detectDuplicates?: boolean;
}

/** Resolves the effective configuration for one path. */
export function resolveForPath(
  configuration: AgentConfiguration,
  targetPath: string,
  options: ResolveOptions = {},
): EffectiveConfiguration {
  const path = targetPath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");

  const instructions = select(configuration.instructions, path, "instruction", (node) => node.title ?? node.id);
  const directives = select(configuration.directives, path, "directive", (node) => node.text);
  const skills = select(configuration.skills, path, "skill", (node) => node.name);

  const diagnostics: Diagnostic[] = [];
  if (options.detectDuplicates !== false) {
    diagnostics.push(...detectDuplicateDirectives(directives.applied));
  }

  return {
    path,
    instructions: instructions.applied,
    directives: directives.applied,
    skills: skills.applied,
    subagents: [...configuration.subagents],
    hooks: [...configuration.hooks],
    mcpServers: [...configuration.mcpServers],
    permissions: [...configuration.permissions],
    excluded: [...instructions.excluded, ...directives.excluded, ...skills.excluded],
    diagnostics,
  };
}

/**
 * Human-readable explanation of why a single node applies (or does not) at a
 * path. This is the data `agentfile explain` renders; keeping it here means the
 * command cannot drift from the resolver.
 */
export interface Explanation {
  label: string;
  kind: string;
  applies: boolean;
  /** Why it applies, or why it does not. */
  reason: string;
  /** Where the node was declared. */
  source: Provenance;
  /** Nodes of the same kind that rank above this one at this path. */
  outrankedBy: string[];
}

export function explainInstruction(effective: EffectiveConfiguration, instructionId: string): Explanation | undefined {
  const index = effective.instructions.findIndex((entry) => entry.node.id === instructionId);

  if (index !== -1) {
    const entry = effective.instructions[index];
    return {
      label: entry.node.title ?? entry.node.id,
      kind: "instruction",
      applies: true,
      reason: entry.reason.detail,
      source: entry.node.provenance,
      outrankedBy: effective.instructions.slice(index + 1).map((other) => other.node.title ?? other.node.id),
    };
  }

  const rejected = effective.excluded.find((entry) => entry.kind === "instruction" && entry.label === instructionId);
  if (!rejected) return undefined;

  return {
    label: rejected.label,
    kind: rejected.kind,
    applies: false,
    reason: rejected.reason.detail,
    source: rejected.provenance,
    outrankedBy: [],
  };
}
