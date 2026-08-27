/**
 * Overlap between instruction files.
 *
 * The problem agentfile exists to solve is one rule maintained in four places.
 * Finding it in prose needs no parsing and no model: the same sentence appearing
 * in `AGENTS.md`, `.cursor/rules/main.mdc`, and `.github/copilot-instructions.md`
 * is detectable by comparing normalised lines, and that is all this does.
 *
 * Line comparison rather than statement extraction is deliberate. It catches
 * bullets and plain prose alike, and it never has to guess whether a sentence
 * "is a rule" — a guess that would either miss real duplication or invent it.
 */

import { type Diagnostic, diagnostic } from "../diagnostics/index.js";
import type { Instruction } from "../ir/index.js";
import { type InstructionLine, instructionLines, type LineOptions } from "./lines.js";

export { MINIMUM_OVERLAP_LINE_LENGTH, normalizeInstructionLine } from "./lines.js";

export type OverlapOptions = LineOptions;

export interface InstructionOverlap {
  /** Files that share these lines, sorted. */
  files: string[];
  /** Platforms those files belong to, sorted and deduplicated. */
  platforms: string[];
  /** One representative occurrence per shared line, in first-seen order. */
  sharedLines: InstructionLine[];
  /** Every occurrence, so a diagnostic can point at each copy. */
  occurrences: InstructionLine[][];
}

/**
 * Finds text shared between different instruction files.
 *
 * Repetition inside a single file is not overlap — that is a lint concern about
 * that one file. This reports only text that spans files, because that is the
 * duplication that drifts.
 */
export function findInstructionOverlap(
  instructions: readonly Instruction[],
  options: OverlapOptions = {},
): InstructionOverlap[] {
  const byNormalizedLine = new Map<string, InstructionLine[]>();

  for (const entry of instructionLines(instructions, options)) {
    const occurrences = byNormalizedLine.get(entry.normalized);
    if (occurrences) occurrences.push(entry);
    else byNormalizedLine.set(entry.normalized, [entry]);
  }

  // Group shared lines by the exact set of files that share them, so a pair of
  // files duplicating twenty lines is one finding rather than twenty.
  const byFileSet = new Map<string, InstructionOverlap>();

  for (const occurrences of byNormalizedLine.values()) {
    const files = [...new Set(occurrences.map((entry) => entry.file))].sort();
    if (files.length < 2) continue;

    const signature = files.join(" ");
    const group = byFileSet.get(signature) ?? {
      files,
      platforms: [],
      sharedLines: [],
      occurrences: [],
    };

    group.sharedLines.push(occurrences[0]);
    group.occurrences.push(occurrences);
    for (const platform of occurrences.map((entry) => entry.platform)) {
      if (!group.platforms.includes(platform)) group.platforms.push(platform);
    }
    group.platforms.sort();

    byFileSet.set(signature, group);
  }

  return [...byFileSet.values()].sort((a, b) => a.files.join(",").localeCompare(b.files.join(",")));
}

/** How many shared lines a diagnostic quotes before summarising the rest. */
const QUOTED_LINE_LIMIT = 5;

/** Turns overlap findings into AGF302 diagnostics. */
export function overlapDiagnostics(overlaps: readonly InstructionOverlap[]): Diagnostic[] {
  return overlaps.map((overlap) => {
    const count = overlap.sharedLines.length;
    const quoted = overlap.sharedLines.slice(0, QUOTED_LINE_LIMIT);
    const remaining = count - quoted.length;

    const crossPlatform = overlap.platforms.length > 1;
    const explanation = [
      crossPlatform
        ? `The same text is maintained separately for ${overlap.platforms.join(", ")}.`
        : `${overlap.files.length} files repeat the same text.`,
      "",
      ...quoted.map((entry) => `  ${entry.text}`),
      ...(remaining > 0 ? [`  …and ${remaining} more line${remaining === 1 ? "" : "s"}`] : []),
      "",
      crossPlatform
        ? "Every copy costs context in every session, and editing one and forgetting the others is how agent configuration silently disagrees with itself."
        : "Duplicated context costs tokens in every session and drifts apart as one copy is edited.",
    ].join("\n");

    // Anchor on the first shared line and point at each file's own copy of it.
    // Pairing one file's name with another file's line number would send the
    // reader to the wrong place.
    const firstLineOccurrences = overlap.occurrences[0];
    const primary = firstLineOccurrences[0];
    const others = firstLineOccurrences.slice(1);

    return diagnostic({
      code: "AGF302",
      message:
        count === 1
          ? `Duplicate instruction across ${overlap.files.length} files: "${primary.text}"`
          : `${count} duplicated instruction lines across ${overlap.files.length} files`,
      explanation,
      suggestion: crossPlatform
        ? "Keep these rules in one file. AGENTS.md and CLAUDE.md can share one text through a symlink or an @AGENTS.md import — both documented; formats that cannot share a file can be generated from one source with `agentfile compile`."
        : "Keep the text in one file and reference it from the others.",
      location: { file: primary.file, line: primary.line },
      related: others.map((occurrence) => ({
        location: { file: occurrence.file, line: occurrence.line },
        message: `also in ${occurrence.platform} configuration`,
      })),
      data: {
        sharedLines: count,
        files: overlap.files.join(","),
        platforms: overlap.platforms.join(","),
      },
    });
  });
}
