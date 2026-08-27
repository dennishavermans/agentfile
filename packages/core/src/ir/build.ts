import { normalizePath } from "../paths/index.js";
import {
  type AgentConfiguration,
  type Applicability,
  type Instruction,
  IR_VERSION,
  type ProjectMetadata,
  type Provenance,
  type SourceFile,
} from "./types.js";

/** An empty configuration for `root`. The identity value for merging. */
export function emptyConfiguration(root: string): AgentConfiguration {
  return {
    version: IR_VERSION,
    root,
    project: { stack: [] },
    instructions: [],
    directives: [],
    skills: [],
    subagents: [],
    commands: [],
    hooks: [],
    mcpServers: [],
    permissions: [],
    settings: [],
    artifacts: [],
    docs: [],
    sources: [],
  };
}

/**
 * Deterministic node identifier.
 *
 * Stability matters: ids appear in `explain` output, in diagnostics, and in
 * caches, so the same input must always produce the same id. Nothing here
 * depends on iteration order, wall-clock time, or randomness.
 */
export function nodeId(kind: string, provenance: Provenance, discriminator: string): string {
  const position = provenance.line === undefined ? "" : `:${provenance.line}`;
  return `${kind}:${normalizePath(provenance.file)}${position}#${discriminator}`;
}

/**
 * Instructions with symlink twins removed.
 *
 * An instruction whose file resolves to another discovered instruction file is
 * the same text under a second name — `CLAUDE.md → AGENTS.md` is the documented
 * way to share one file between platforms. Counting or comparing both would
 * double every figure and report a file as duplicating itself, so anything that
 * measures text (overlap, similarity, context cost, compile sources) reads
 * through this filter. Resolution does not: each platform genuinely loads its
 * own path, and load order must say so.
 */
export function withoutAliases(instructions: readonly Instruction[]): Instruction[] {
  const authored = new Set(instructions.map((instruction) => instruction.provenance.file));
  return instructions.filter(
    (instruction) => !(instruction.provenance.realFile && authored.has(instruction.provenance.realFile)),
  );
}

/** Slugifies a label for use as a node-id discriminator. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Applicability helpers ─────────────────────────────────────────────────

export const ALWAYS: Applicability = { kind: "always" };
export const MODEL_SELECTED: Applicability = { kind: "model-selected" };
export const MANUAL: Applicability = { kind: "manual" };

export function appliesToDirectory(directory: string): Applicability {
  return { kind: "directory", directory: normalizePath(directory) };
}

export function appliesToPaths(patterns: readonly string[]): Applicability {
  return { kind: "paths", patterns: [...patterns] };
}

// ─── Merging ───────────────────────────────────────────────────────────────

function mergeProject(target: ProjectMetadata, incoming: ProjectMetadata): ProjectMetadata {
  const stack = [...target.stack];
  for (const entry of incoming.stack) {
    if (!stack.includes(entry)) stack.push(entry);
  }
  return { name: target.name ?? incoming.name, stack };
}

function mergeSources(target: SourceFile[], incoming: readonly SourceFile[]): SourceFile[] {
  const seen = new Set(target.map((source) => source.path));
  const result = [...target];
  for (const source of incoming) {
    if (!seen.has(source.path)) {
      seen.add(source.path);
      result.push(source);
    }
  }
  return result;
}

/**
 * Combines configurations from several sources into one.
 *
 * Node arrays concatenate in argument order and are never deduplicated here:
 * duplicate detection is a diagnostic (AGF302), not a silent merge. Dropping a
 * node would destroy the provenance that makes the duplicate reportable.
 *
 * `project.name` follows first-wins so that a more specific source passed
 * earlier is not overwritten by a broader one.
 */
export function mergeConfigurations(
  root: string,
  ...configurations: readonly AgentConfiguration[]
): AgentConfiguration {
  const result = emptyConfiguration(root);

  for (const configuration of configurations) {
    result.project = mergeProject(result.project, configuration.project);
    result.instructions.push(...configuration.instructions);
    result.directives.push(...configuration.directives);
    result.skills.push(...configuration.skills);
    result.subagents.push(...configuration.subagents);
    result.commands.push(...configuration.commands);
    result.hooks.push(...configuration.hooks);
    result.mcpServers.push(...configuration.mcpServers);
    result.permissions.push(...configuration.permissions);
    result.settings.push(...configuration.settings);
    result.artifacts.push(...configuration.artifacts);
    result.docs.push(...configuration.docs);
    result.sources = mergeSources(result.sources, configuration.sources);
  }

  return result;
}

/** Total node count, useful for reporting and tests. */
export function countNodes(configuration: AgentConfiguration): number {
  return (
    configuration.instructions.length +
    configuration.directives.length +
    configuration.skills.length +
    configuration.subagents.length +
    configuration.commands.length +
    configuration.hooks.length +
    configuration.mcpServers.length +
    configuration.permissions.length +
    configuration.settings.length +
    configuration.artifacts.length +
    configuration.docs.length
  );
}
