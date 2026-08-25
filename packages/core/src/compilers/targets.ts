/**
 * The target compilers.
 *
 * Each one emits only file shapes its target documents — the same registry rows
 * that back `AGF20x` diagnostics back every path written here, and a shape that
 * is not documented is not emitted. Where a target cannot express something the
 * compiler selected, the loss is reported by `fidelity.ts`; nothing is dropped
 * without a finding.
 *
 * All four share one skeleton: select sources, plan files, report fidelity.
 * Only the file-planning differs per target, so only that is target code.
 */

import type { TargetId } from "../capabilities/index.js";
import type { AgentConfiguration, Instruction } from "../ir/index.js";
import { ROOT_PATH } from "../paths/index.js";
import { fidelity } from "./fidelity.js";
import { ensureTrailingNewline, mergeBodies, outputSlug, type SelectedSources, selectSources } from "./sources.js";
import type { CompilePlan, NotCarried, PlannedFile, TargetCompiler } from "./types.js";

/** YAML frontmatter from literal lines. Kept dumb on purpose — no YAML library needed for two fields. */
function frontmatter(lines: string[]): string {
  return `---\n${lines.join("\n")}\n---\n\n`;
}

function yamlList(field: string, values: readonly string[]): string {
  return [`${field}:`, ...values.map((value) => `  - ${JSON.stringify(value)}`)].join("\n");
}

function inDirectory(directory: string, path: string): string {
  return directory === ROOT_PATH ? path : `${directory}/${path}`;
}

interface PlannerResult {
  files: PlannedFile[];
  notCarried?: NotCarried[];
}

function makeCompiler(id: TargetId, plan: (sources: SelectedSources) => PlannerResult): TargetCompiler {
  return {
    id,
    compile(configuration: AgentConfiguration): CompilePlan {
      const sources = selectSources(configuration, id);
      const report = fidelity(configuration, id, sources);
      const planned = plan(sources);

      return {
        target: id,
        files: planned.files.sort((a, b) => a.path.localeCompare(b.path)),
        diagnostics: report.diagnostics,
        notCarried: [...report.notCarried, ...(planned.notCarried ?? [])],
      };
    },
  };
}

// ─── AGENTS.md ──────────────────────────────────────────────────────────────

/**
 * Root and nested AGENTS.md. Plain markdown with no frontmatter, so path-scoped
 * instructions have nowhere to go — fidelity reports them as AGF201 and they
 * are not emitted, rather than folded into the root file where they would apply
 * more broadly than their author scoped them.
 */
export const agentsMdCompiler = makeCompiler("agents-md", (sources) => {
  const files: PlannedFile[] = [];

  if (sources.always.length) {
    files.push({ path: "AGENTS.md", content: mergeBodies(sources.always), source: "agents-md" });
  }
  for (const [directory, instructions] of sources.byDirectory) {
    files.push({
      path: inDirectory(directory, "AGENTS.md"),
      content: mergeBodies(instructions),
      source: "agents-md",
    });
  }

  return { files };
});

// ─── Claude Code ────────────────────────────────────────────────────────────

/**
 * Root and nested CLAUDE.md, plus `.claude/rules/*.md` with a `paths:` list for
 * glob-scoped instructions — all three shapes documented in Claude Code's
 * memory documentation.
 */
export const claudeCompiler = makeCompiler("claude", (sources) => {
  const files: PlannedFile[] = [];

  if (sources.always.length) {
    files.push({ path: "CLAUDE.md", content: mergeBodies(sources.always), source: "claude" });
  }
  for (const [directory, instructions] of sources.byDirectory) {
    files.push({
      path: inDirectory(directory, "CLAUDE.md"),
      content: mergeBodies(instructions),
      source: "claude",
    });
  }
  for (const instruction of sources.byPaths) {
    if (instruction.applies.kind !== "paths") continue;
    files.push({
      path: `.claude/rules/agentfile-${outputSlug(instruction)}.md`,
      content: frontmatter([yamlList("paths", instruction.applies.patterns)]) + ensureTrailingNewline(instruction.body.trim()),
      source: "claude",
    });
  }

  return { files };
});

// ─── GitHub Copilot ─────────────────────────────────────────────────────────

/**
 * `.github/copilot-instructions.md` for the repository, and
 * `.github/instructions/*.instructions.md` with `applyTo` for glob scopes.
 * `applyTo` is documented as comma-separated patterns, so that is what is
 * written. Directory-scoped instructions reach Copilot through AGENTS.md,
 * which is the agents-md target's output — said, not silently skipped.
 */
export const copilotCompiler = makeCompiler("copilot", (sources) => {
  const files: PlannedFile[] = [];
  const notCarried: NotCarried[] = [];

  if (sources.always.length) {
    files.push({
      path: ".github/copilot-instructions.md",
      content: mergeBodies(sources.always),
      source: "copilot",
    });
  }
  for (const instruction of sources.byPaths) {
    if (instruction.applies.kind !== "paths") continue;
    files.push({
      path: `.github/instructions/agentfile-${outputSlug(instruction)}.instructions.md`,
      content:
        frontmatter([`applyTo: ${JSON.stringify(instruction.applies.patterns.join(","))}`]) +
        ensureTrailingNewline(instruction.body.trim()),
      source: "copilot",
    });
  }

  if (sources.byDirectory.size) {
    const count = [...sources.byDirectory.values()].reduce((sum, list) => sum + list.length, 0);
    notCarried.push({
      kind: "directory-scoped instructions",
      count,
      reason:
        "Copilot reads nested scopes from AGENTS.md files, not from a Copilot-specific format. " +
        "Compile the agents-md target to cover them.",
    });
  }

  return { files, notCarried };
});

// ─── Cursor ─────────────────────────────────────────────────────────────────

/**
 * `.cursor/rules/*.mdc`. Always-on instructions merge into one
 * `alwaysApply: true` rule per directory level; each glob-scoped instruction
 * becomes its own rule with a `globs` list, preserving the author's scoping
 * one-to-one.
 */
export const cursorCompiler = makeCompiler("cursor", (sources) => {
  const files: PlannedFile[] = [];

  if (sources.always.length) {
    files.push({
      path: ".cursor/rules/agentfile.mdc",
      content: frontmatter(["alwaysApply: true"]) + mergeBodies(sources.always),
      source: "cursor",
    });
  }
  for (const [directory, instructions] of sources.byDirectory) {
    files.push({
      path: inDirectory(directory, ".cursor/rules/agentfile.mdc"),
      content: frontmatter(["alwaysApply: true"]) + mergeBodies(instructions),
      source: "cursor",
    });
  }
  for (const instruction of sources.byPaths) {
    if (instruction.applies.kind !== "paths") continue;
    files.push({
      path: `.cursor/rules/agentfile-${outputSlug(instruction)}.mdc`,
      content:
        frontmatter([yamlList("globs", instruction.applies.patterns), "alwaysApply: false"]) +
        ensureTrailingNewline(instruction.body.trim()),
      source: "cursor",
    });
  }

  return { files };
});

// ─── Registry ───────────────────────────────────────────────────────────────

/** Targets `agentfile compile` implements. Only shapes with verified registry rows. */
export const COMPILERS: readonly TargetCompiler[] = [agentsMdCompiler, claudeCompiler, copilotCompiler, cursorCompiler];

export function compilerFor(target: string): TargetCompiler | undefined {
  return COMPILERS.find((compiler) => compiler.id === target);
}

/** Ids of the implemented targets, for CLI help and validation. */
export const COMPILE_TARGETS: readonly string[] = COMPILERS.map((compiler) => compiler.id);
