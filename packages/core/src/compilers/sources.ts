/**
 * Which instructions a compile carries, and in what order.
 *
 * Every compiler answers the same three questions the same way, because a
 * difference between targets here would be a bug, not a feature:
 *
 *   1. **Whose content?** Not the target's own files (compiling CLAUDE.md into
 *      CLAUDE.md is a no-op at best and a feedback loop at worst), not files a
 *      previous compile generated (same loop, one step removed), and never
 *      `local`-scoped files — those are personal, and a compile output is meant
 *      to be committed.
 *   2. **In what order?** Sorted by source path, then line. Not by importance —
 *      by something two runs on the same tree cannot disagree about.
 *   3. **What about duplicates?** Repositories that hand-maintain the same text
 *      in AGENTS.md and CLAUDE.md are exactly the repositories that will run
 *      this compiler. Carrying both copies would double the text; the first
 *      occurrence wins and the drop is recorded.
 */

import type { TargetId } from "../capabilities/index.js";
import { type AgentConfiguration, type Instruction, withoutAliases } from "../ir/index.js";

export interface SelectedSources {
  /** Instructions that apply unconditionally, in deterministic order. */
  always: Instruction[];
  /** Directory-scoped instructions, keyed by governed directory. */
  byDirectory: Map<string, Instruction[]>;
  /** Glob-scoped instructions. */
  byPaths: Instruction[];
  /** Instructions left behind because no root-file equivalent exists. */
  modelSelected: Instruction[];
  /** Exact-duplicate bodies dropped, recorded so nothing disappears silently. */
  duplicates: Array<{ kept: string; dropped: string }>;
}

function order(a: Instruction, b: Instruction): number {
  const byFile = a.provenance.file.localeCompare(b.provenance.file);
  if (byFile !== 0) return byFile;
  return (a.provenance.line ?? 0) - (b.provenance.line ?? 0);
}

/** True when an instruction may be carried into a compiled file for `target`. */
export function isCompileSource(instruction: Instruction, target: TargetId): boolean {
  if (instruction.provenance.platform === target) return false;
  if (instruction.provenance.origin === "generated") return false;
  if (instruction.provenance.scope === "local") return false;
  return instruction.body.trim().length > 0;
}

/** Selects and buckets the instructions a compile for `target` carries. */
export function selectSources(configuration: AgentConfiguration, target: TargetId): SelectedSources {
  const selected: SelectedSources = {
    always: [],
    byDirectory: new Map(),
    byPaths: [],
    modelSelected: [],
    duplicates: [],
  };

  const seen = new Map<string, string>();
  // Symlink twins first: a file and its link are one source, not a duplicate.
  const candidates = withoutAliases(configuration.instructions)
    .filter((entry) => isCompileSource(entry, target))
    .sort(order);

  for (const instruction of candidates) {
    const key = instruction.body.trim();
    const kept = seen.get(key);
    if (kept !== undefined) {
      selected.duplicates.push({ kept, dropped: instruction.provenance.file });
      continue;
    }
    seen.set(key, instruction.provenance.file);

    switch (instruction.applies.kind) {
      case "always":
        selected.always.push(instruction);
        break;
      case "directory": {
        const list = selected.byDirectory.get(instruction.applies.directory) ?? [];
        list.push(instruction);
        selected.byDirectory.set(instruction.applies.directory, list);
        break;
      }
      case "paths":
        selected.byPaths.push(instruction);
        break;
      default:
        // model-selected and manual: gated on a judgement or an invocation,
        // which an unconditional instruction file cannot express.
        selected.modelSelected.push(instruction);
    }
  }

  return selected;
}

/**
 * Merges instruction bodies into one file body.
 *
 * With a single source the body passes through verbatim. With several, each
 * section is preceded by a comment naming its source file — invisible in
 * rendered markdown, and the only way a reader of the generated file can trace
 * a line back to where to edit it (REWORK §23: the goal is traceability).
 */
export function mergeBodies(instructions: readonly Instruction[]): string {
  if (instructions.length === 1) return ensureTrailingNewline(instructions[0].body);

  const sections = instructions.map(
    (instruction) => `<!-- agentfile: from ${instruction.provenance.file} -->\n${instruction.body.trim()}`,
  );
  return `${sections.join("\n\n")}\n`;
}

export function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

/**
 * A stable, filesystem-safe name for a per-instruction output file.
 *
 * Derived from the source path so the same input always lands in the same
 * output file, which is what makes regeneration idempotent and diffs readable.
 */
export function outputSlug(instruction: Instruction): string {
  return instruction.provenance.file
    .toLowerCase()
    .replace(/\.(md|mdc)$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
