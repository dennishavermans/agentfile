/**
 * The same rule, scoped differently per platform.
 *
 * This is the failure mode that is hardest to see by reading the files. A team
 * writes "always validate input at the boundary" in `AGENTS.md`, so it is
 * unconditional, and copies it into a `.cursor/rules/*.mdc` with
 * `globs: src/api/**`, so in Cursor it only attaches when an API file is open.
 * Both files look correct. Nothing is duplicated incorrectly. The rule simply
 * means something different depending on which tool the developer is using.
 *
 * Detecting it needs no semantics: the text is already known to be shared, so
 * the only question is whether the applicability that carries it agrees. That is
 * a comparison of two IR nodes.
 */

import { type Diagnostic, diagnostic } from "../diagnostics/index.js";
import type { Applicability, Instruction } from "../ir/index.js";
import { ROOT_PATH } from "../paths/index.js";
import { type InstructionLine, instructionLines, type LineOptions } from "./lines.js";

/**
 * Canonical form of an applicability, for equality comparison.
 *
 * `always` and a directory scope of the repository root are the same statement
 * — everything is inside the root — so they must canonicalise identically.
 * Otherwise every root `AGENTS.md`/`CLAUDE.md` pair would look like a mismatch.
 */
export function scopeSignature(applies: Applicability): string {
  switch (applies.kind) {
    case "always":
      return "always";
    case "directory":
      return applies.directory === ROOT_PATH ? "always" : `directory:${applies.directory}`;
    case "paths":
      return `paths:${[...applies.patterns].sort().join(",")}`;
    case "model-selected":
      return "model-selected";
    case "manual":
      return "manual";
  }
}

/** How to describe an applicability to a developer reading a diagnostic. */
export function describeScope(applies: Applicability): string {
  switch (applies.kind) {
    case "always":
      return "applies unconditionally";
    case "directory":
      return applies.directory === ROOT_PATH ? "applies unconditionally" : `applies only under ${applies.directory}/`;
    case "paths":
      return `applies only to ${applies.patterns.join(", ")}`;
    case "model-selected":
      return "applies only when the agent selects it";
    case "manual":
      return "applies only when invoked explicitly";
  }
}

export interface ScopeMismatch {
  /** Representative shared lines, in first-seen order. */
  sharedLines: InstructionLine[];
  /** One entry per distinct scope, with where it comes from. */
  scopes: Array<{
    signature: string;
    description: string;
    file: string;
    platform: string;
    line: number;
  }>;
}

export type ScopeOptions = LineOptions;

/**
 * Finds shared instruction text whose applicability differs between files.
 *
 * Only cross-file text is considered, and only where at least two distinct
 * scopes are involved. Findings are grouped by the combination of scopes
 * involved, so a pair of files that disagree about twenty lines is one finding.
 */
export function findScopeMismatches(instructions: readonly Instruction[], options: ScopeOptions = {}): ScopeMismatch[] {
  const byId = new Map(instructions.map((instruction) => [instruction.id, instruction]));
  const byNormalizedLine = new Map<string, InstructionLine[]>();

  for (const entry of instructionLines(instructions, options)) {
    const occurrences = byNormalizedLine.get(entry.normalized);
    if (occurrences) occurrences.push(entry);
    else byNormalizedLine.set(entry.normalized, [entry]);
  }

  const grouped = new Map<string, ScopeMismatch>();

  for (const occurrences of byNormalizedLine.values()) {
    if (new Set(occurrences.map((entry) => entry.file)).size < 2) continue;

    const scopes = new Map<string, ScopeMismatch["scopes"][number]>();
    for (const occurrence of occurrences) {
      const instruction = byId.get(occurrence.instructionId);
      if (!instruction) continue;

      const signature = scopeSignature(instruction.applies);
      if (scopes.has(signature)) continue;
      scopes.set(signature, {
        signature,
        description: describeScope(instruction.applies),
        file: occurrence.file,
        platform: occurrence.platform,
        line: occurrence.line,
      });
    }

    if (scopes.size < 2) continue;

    const ordered = [...scopes.values()].sort((a, b) => a.signature.localeCompare(b.signature));
    const key = ordered.map((scope) => `${scope.file}=${scope.signature}`).join(" ");

    const group = grouped.get(key) ?? { sharedLines: [], scopes: ordered };
    group.sharedLines.push(occurrences[0]);
    grouped.set(key, group);
  }

  return [...grouped.values()].sort(
    (a, b) => a.scopes[0].file.localeCompare(b.scopes[0].file) || a.scopes[0].line - b.scopes[0].line,
  );
}

/** How many shared lines a diagnostic quotes before summarising the rest. */
const QUOTED_LINE_LIMIT = 3;

/** Turns scope mismatches into AGF304 diagnostics. */
export function scopeMismatchDiagnostics(mismatches: readonly ScopeMismatch[]): Diagnostic[] {
  return mismatches.map((mismatch) => {
    const count = mismatch.sharedLines.length;
    const quoted = mismatch.sharedLines.slice(0, QUOTED_LINE_LIMIT);
    const remaining = count - quoted.length;
    const [primary, ...others] = mismatch.scopes;

    return diagnostic({
      code: "AGF304",
      message:
        count === 1
          ? `Same instruction, different scope per platform: "${mismatch.sharedLines[0].text}"`
          : `${count} shared instruction lines are scoped differently per platform`,
      explanation: [
        "The same text is present in several files, but the configuration around it",
        "does not agree on when it applies:",
        "",
        ...mismatch.scopes.map((scope) => `  ${scope.file} (${scope.platform}) — ${scope.description}`),
        "",
        ...quoted.map((entry) => `  ${entry.text}`),
        ...(remaining > 0 ? [`  …and ${remaining} more line${remaining === 1 ? "" : "s"}`] : []),
        "",
        "The rule therefore means something different depending on which tool the",
        "developer is using, and no single file looks wrong on its own.",
      ].join("\n"),
      suggestion:
        "Decide which scope is correct and make every copy agree, or keep the rule in one place and generate the per-platform files from it.",
      location: { file: primary.file, line: primary.line },
      related: others.map((scope) => ({
        location: { file: scope.file, line: scope.line },
        message: `here it ${scope.description}`,
      })),
      data: {
        sharedLines: count,
        scopes: mismatch.scopes.map((scope) => scope.signature).join(" | "),
        files: mismatch.scopes.map((scope) => scope.file).join(","),
      },
    });
  });
}
