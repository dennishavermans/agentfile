/**
 * Instruction text, line by line.
 *
 * Two different analyses need the same view of an instruction body: exact
 * overlap between files, and near-duplicate drift within that overlap. They must
 * agree on what counts as a line of instruction, or the same text would be a
 * finding for one and invisible to the other. So the line reader lives here, and
 * both import it.
 */

import { type Instruction, withoutAliases } from "../ir/index.js";

/**
 * Shortest line worth comparing.
 *
 * Short lines collide by coincidence — "## Testing", "- see below", "Done." —
 * and reporting those is how a useful signal becomes noise.
 */
export const MINIMUM_OVERLAP_LINE_LENGTH = 20;

/** Lines that carry no instruction and would only create false matches. */
export function isIgnorableLine(text: string): boolean {
  if (!text) return true;
  // Headings, fences, tables, and horizontal rules are structure.
  if (/^#{1,6}\s/.test(text)) return true;
  if (/^\s*(`{3,}|~{3,})/.test(text)) return true;
  if (/^\s*\|/.test(text)) return true;
  if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) return true;
  // A bare link, path, or import directive.
  if (/^\s*@\S+$/.test(text)) return true;
  if (/^\s*\[[^\]]*\]\([^)]*\)\s*$/.test(text)) return true;
  return false;
}

/**
 * Normalises a line for comparison.
 *
 * Strips list markers, emphasis, and inline-code backticks, then folds case,
 * whitespace, and trailing punctuation — so `- Use pnpm.` and
 * `* **Use pnpm**` compare equal, because they say the same thing.
 */
export function normalizeInstructionLine(line: string): string {
  return line
    .replace(/^\s*([-*+]|\d+[.)])\s+/, "")
    .replace(/[*_`]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!;,:]+$/, "");
}

export interface InstructionLine {
  /** Project-relative path of the file the line came from. */
  file: string;
  platform: string;
  /** 1-based line number in that file. */
  line: number;
  /** The line as authored, trimmed, with the markdown list marker removed. */
  text: string;
  /** Comparison form, from `normalizeInstructionLine`. */
  normalized: string;
  /** Id of the instruction this line belongs to. */
  instructionId: string;
}

export interface LineOptions {
  /** Shortest normalised line to keep. Defaults to `MINIMUM_OVERLAP_LINE_LENGTH`. */
  minimumLength?: number;
}

/**
 * Every comparable line of every instruction.
 *
 * A line repeated inside one file is yielded once. Repetition within a file is a
 * lint concern about that file; letting it through here would make a single file
 * repeating itself look like duplication between sources.
 */
export function instructionLines(instructions: readonly Instruction[], options: LineOptions = {}): InstructionLine[] {
  const minimumLength = options.minimumLength ?? MINIMUM_OVERLAP_LINE_LENGTH;
  const result: InstructionLine[] = [];

  // A symlink twin is the same text under a second name. Comparing it against
  // its own target would report a file as duplicating itself.
  for (const instruction of withoutAliases(instructions)) {
    const startLine = instruction.bodyLine ?? 1;
    const lines = instruction.body.split("\n");
    const seenInThisFile = new Set<string>();

    for (let offset = 0; offset < lines.length; offset++) {
      const raw = lines[offset];
      if (isIgnorableLine(raw.trim())) continue;

      const normalized = normalizeInstructionLine(raw);
      if (normalized.length < minimumLength) continue;
      if (seenInThisFile.has(normalized)) continue;
      seenInThisFile.add(normalized);

      result.push({
        file: instruction.provenance.file,
        platform: String(instruction.provenance.platform),
        line: startLine + offset,
        // The list marker is markdown structure, not part of the instruction,
        // so quoting it back at the developer just adds noise.
        text: raw.trim().replace(/^([-*+]|\d+[.)])\s+/, ""),
        normalized,
        instructionId: instruction.id,
      });
    }
  }

  return result;
}
