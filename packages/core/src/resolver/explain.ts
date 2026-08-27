/**
 * Source-map information for agent configuration.
 *
 * When an agent behaves unexpectedly, the question is never "what does the
 * configuration say" — it is "which of these nine files reached this request,
 * and which one won". Answering that by reading the files is exactly the work
 * this project exists to remove.
 *
 * So this addresses a node, then reports what it is, where it was declared, when
 * it applies, whether it applies at a given path and why, what outranks it there,
 * and where else the same thing is declared. Every verdict comes from
 * `resolveForPath`, so `explain` cannot say one thing while resolution does
 * another.
 */

import { findInstructionOverlap } from "../analysis/index.js";
import type { AgentConfiguration, Applicability, Provenance } from "../ir/index.js";
import { normalizePath } from "../paths/index.js";
import { type ResolutionRank, resolveForPath } from "./resolve.js";

export type ExplainKind =
  | "instruction"
  | "rule"
  | "skill"
  | "subagent"
  | "hook"
  | "mcp-server"
  | "permission"
  | "setting";

/** How a query found a node. Shown so an ambiguous query is obvious. */
export type MatchedBy = "id" | "file" | "name" | "text";

export interface ExplainTarget {
  id: string;
  kind: ExplainKind;
  /** Short name for output. */
  label: string;
  provenance: Provenance;
  /** Absent for node kinds no verified platform scopes by path. */
  applies?: Applicability;
  /** The text or body, for display. */
  detail: string;
  matchedBy: MatchedBy;
}

/** Everything relevant about one node, at one path or in general. */
export interface NodeExplanation {
  target: ExplainTarget;
  /** When it applies, in words. */
  scope: string;
  /** Verdict at a specific path. Absent when no path was given. */
  at?: PathVerdict;
  /** Other places the same thing is declared. */
  alsoDeclaredIn: Provenance[];
}

export interface PathVerdict {
  path: string;
  applies: boolean;
  /** Why it applies, or why it does not. Straight from the resolver. */
  reason: string;
  /** Present only when it applies. */
  rank?: ResolutionRank;
  /** Nodes of the same kind that rank above it here, least specific first. */
  outrankedBy: string[];
}

/** When a node applies, in words a developer can act on. */
export function describeApplicability(applies: Applicability | undefined): string {
  if (!applies) return "applies to the whole repository; no verified platform scopes this by path";

  switch (applies.kind) {
    case "always":
      return "loaded in every session, regardless of which file is being worked on";
    case "directory":
      return applies.directory
        ? `loaded when working inside ${applies.directory}/`
        : "loaded in every session, regardless of which file is being worked on";
    case "paths":
      return `loaded when working on a file matching ${applies.patterns.join(", ")}`;
    case "model-selected":
      return "available everywhere; the agent decides from the description whether to load it";
    case "manual":
      return "loaded only when invoked explicitly";
  }
}

function firstLine(text: string): string {
  const line = text
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line ?? "";
}

/** Every addressable node, in a uniform shape. */
function allTargets(configuration: AgentConfiguration): Omit<ExplainTarget, "matchedBy">[] {
  const targets: Omit<ExplainTarget, "matchedBy">[] = [];

  for (const instruction of configuration.instructions) {
    targets.push({
      id: instruction.id,
      kind: "instruction",
      label: instruction.title ?? instruction.provenance.file,
      provenance: instruction.provenance,
      applies: instruction.applies,
      detail: firstLine(instruction.body),
    });
  }

  for (const directive of configuration.directives) {
    targets.push({
      id: directive.id,
      kind: "rule",
      label: directive.text,
      provenance: directive.provenance,
      applies: directive.applies,
      detail: directive.text,
    });
  }

  for (const skill of configuration.skills) {
    targets.push({
      id: skill.id,
      kind: "skill",
      label: skill.name,
      provenance: skill.provenance,
      applies: skill.applies,
      detail: skill.description,
    });
  }

  for (const subagent of configuration.subagents) {
    targets.push({
      id: `subagent:${subagent.name}:${subagent.provenance.file}`,
      kind: "subagent",
      label: subagent.name,
      provenance: subagent.provenance,
      detail: subagent.description,
    });
  }

  for (const hook of configuration.hooks) {
    targets.push({
      id: `hook:${hook.event}:${hook.provenance.file}`,
      kind: "hook",
      label: `${hook.event}${hook.matcher ? ` (${hook.matcher})` : ""}`,
      provenance: hook.provenance,
      // Data, shown and never executed. Which field carries the payload depends
      // on the handler type, so all of them are candidates.
      detail: hook.command ?? hook.url ?? hook.prompt ?? `${hook.type} hook`,
    });
  }

  for (const server of configuration.mcpServers) {
    targets.push({
      id: `mcp:${server.name}:${server.provenance.file}`,
      kind: "mcp-server",
      label: server.name,
      provenance: server.provenance,
      detail: server.transport === "stdio" ? (server.command ?? "") : (server.url ?? ""),
    });
  }

  for (const setting of configuration.settings) {
    targets.push({
      id: `setting:${setting.key}:${setting.provenance.file}`,
      kind: "setting",
      label: setting.key,
      provenance: setting.provenance,
      detail: setting.value,
    });
  }

  for (const permission of configuration.permissions) {
    targets.push({
      id: `permission:${permission.rule}:${permission.provenance.file}`,
      kind: "permission",
      label: permission.rule,
      provenance: permission.provenance,
      detail: `${permission.effect} ${permission.rule}`,
    });
  }

  return targets;
}

export interface FindOptions {
  /** Restrict to one kind, for a query that would otherwise be ambiguous. */
  kind?: ExplainKind;
}

/**
 * Resolves a query to the nodes it could mean.
 *
 * Tried in order of how precisely the query identifies something: an exact id,
 * then a source file, then a name, then text. The first strategy that matches
 * anything wins — a query that names a file is not also treated as a substring
 * search, which would bury the answer in coincidental matches. Several matches
 * are all returned so the caller can report the ambiguity rather than pick one.
 */
export function findExplainTargets(
  configuration: AgentConfiguration,
  query: string,
  options: FindOptions = {},
): ExplainTarget[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const candidates = allTargets(configuration).filter((target) => !options.kind || target.kind === options.kind);

  const byId = candidates.filter((target) => target.id === trimmed);
  if (byId.length) return byId.map((target) => ({ ...target, matchedBy: "id" }));

  const path = normalizePath(trimmed);
  const byFile = candidates.filter((target) => target.provenance.file === path);
  if (byFile.length) return byFile.map((target) => ({ ...target, matchedBy: "file" }));

  const lowered = trimmed.toLowerCase();
  const byName = candidates.filter((target) => target.label.toLowerCase() === lowered);
  if (byName.length) return byName.map((target) => ({ ...target, matchedBy: "name" }));

  const byText = candidates.filter(
    (target) => target.label.toLowerCase().includes(lowered) || target.detail.toLowerCase().includes(lowered),
  );
  return byText.map((target) => ({ ...target, matchedBy: "text" }));
}

/** Directive text, normalised the way the resolver's duplicate check does. */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!;,]+$/, "");
}

/**
 * Other places the same thing is declared.
 *
 * Per kind, "the same thing" means what a developer would call the same thing: a
 * rule with the same text, a skill with the same name, an instruction file that
 * shares lines with this one.
 */
function alsoDeclaredIn(configuration: AgentConfiguration, target: ExplainTarget): Provenance[] {
  if (target.kind === "rule") {
    const key = normalizeText(target.label);
    return configuration.directives
      .filter((directive) => directive.id !== target.id && normalizeText(directive.text) === key)
      .map((directive) => directive.provenance);
  }

  if (target.kind === "skill") {
    return configuration.skills
      .filter((skill) => skill.name === target.label && skill.provenance.file !== target.provenance.file)
      .map((skill) => skill.provenance);
  }

  if (target.kind === "instruction") {
    // Reuse the overlap analysis rather than re-deriving what "shared" means.
    const files = new Set<string>();
    for (const overlap of findInstructionOverlap(configuration.instructions)) {
      if (!overlap.files.includes(target.provenance.file)) continue;
      for (const line of overlap.occurrences.flat()) {
        if (line.file !== target.provenance.file) files.add(line.file);
      }
    }

    return [...files].sort().map((file) => {
      const instruction = configuration.instructions.find((entry) => entry.provenance.file === file);
      return instruction?.provenance ?? { file, platform: "generic", scope: "project", origin: "declared" };
    });
  }

  return [];
}

/** Kind names as the resolver labels them in `Excluded.kind`. */
const RESOLVER_KIND: Partial<Record<ExplainKind, string>> = {
  instruction: "instruction",
  rule: "directive",
  skill: "skill",
};

/** Whether a node applies at a path, why, and what beats it there. */
export function verdictAt(configuration: AgentConfiguration, target: ExplainTarget, targetPath: string): PathVerdict {
  const effective = resolveForPath(configuration, targetPath, { detectDuplicates: false });

  const lists = {
    instruction: effective.instructions,
    rule: effective.directives,
    skill: effective.skills,
  } as const;

  const list = lists[target.kind as keyof typeof lists];

  if (!list) {
    // Subagents, hooks, MCP servers, and permissions are not path-scoped by any
    // verified platform, so they are available wherever the repository is.
    return {
      path: effective.path,
      applies: true,
      reason: "not scoped by path on any verified platform, so it is available everywhere",
      outrankedBy: [],
    };
  }

  const index = list.findIndex((entry) => (entry.node as { id: string }).id === target.id);

  if (index !== -1) {
    const entry = list[index];
    return {
      path: effective.path,
      applies: true,
      reason: entry.reason.detail,
      rank: entry.rank,
      // Later in the list is more specific, so those are what win an override.
      outrankedBy: list.slice(index + 1).map((other) => labelOf(other.node)),
    };
  }

  const resolverKind = RESOLVER_KIND[target.kind];
  const rejected = effective.excluded.find((entry) => entry.id === target.id && entry.kind === resolverKind);

  return {
    path: effective.path,
    applies: false,
    reason: rejected?.reason.detail ?? "not part of the resolved configuration at this path",
    outrankedBy: [],
  };
}

function labelOf(node: unknown): string {
  const candidate = node as { title?: string; text?: string; name?: string; id?: string };
  return candidate.title ?? candidate.text ?? candidate.name ?? candidate.id ?? "unknown";
}

export interface ExplainOptions {
  /** Path to evaluate applicability at. */
  at?: string;
}

/** Explains one node. */
export function explainTarget(
  configuration: AgentConfiguration,
  target: ExplainTarget,
  options: ExplainOptions = {},
): NodeExplanation {
  return {
    target,
    scope: describeApplicability(target.applies),
    at: options.at === undefined ? undefined : verdictAt(configuration, target, options.at),
    alsoDeclaredIn: alsoDeclaredIn(configuration, target),
  };
}
