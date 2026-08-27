/**
 * Deriving atomic directives from prose.
 *
 * A discovered instruction file is an opaque markdown block: agentfile does not
 * get to decide what someone's AGENTS.md means. But the single most useful thing
 * `doctor` can report — the same rule maintained in four different files, slowly
 * drifting apart — needs statements, not blocks.
 *
 * So statements are *derived*, and marked `origin: "derived"` to say exactly
 * that. A derived directive is agentfile's reading of a bullet, never a claim
 * about what the author declared. Nothing is rewritten, and the instruction
 * itself is left intact alongside.
 */

import type { Directive, Instruction } from "../ir/index.js";
import { nodeId, slugify } from "../ir/index.js";

/** Bullet list item: `- text`, `* text`, `+ text`. */
const BULLET = /^\s*[-*+]\s+(.*\S)\s*$/;
/** Ordered list item: `1. text`, `2) text`. */
const ORDERED = /^\s*\d+[.)]\s+(.*\S)\s*$/;
/** ATX heading: `## Coding`. */
const HEADING = /^(#{1,6})\s+(.*\S)\s*$/;
/** Fence opening or closing a code block. */
const FENCE = /^\s*(`{3,}|~{3,})/;

/**
 * Shortest bullet worth treating as a rule.
 *
 * Below this, a bullet is almost always a link, a path, or a fragment rather
 * than an instruction, and treating it as one produces noise.
 */
const MINIMUM_DIRECTIVE_LENGTH = 12;

/** Bullets that are structural rather than instructional. */
function isStructuralBullet(text: string): boolean {
  // A bare link, a bare path, or a bare inline-code token.
  if (/^\[[^\]]*\]\([^)]*\)$/.test(text)) return true;
  if (/^`[^`]*`$/.test(text)) return true;
  if (/^\S+\.(md|ts|tsx|js|json|ya?ml)$/i.test(text)) return true;
  return false;
}

/**
 * Strips a `**Label:**` prefix, which markdown instruction files use heavily.
 * The label is structure, not part of the statement.
 */
function stripLabelPrefix(text: string): string {
  return text.replace(/^\*\*([^*]+)\*\*:?\s*/, "").trim();
}

export interface DeriveOptions {
  /** Minimum length of a bullet to be treated as a rule. */
  minimumLength?: number;
}

/**
 * Extracts directives from one instruction's markdown body.
 *
 * The nearest preceding heading becomes the category, so a rule under
 * `## Testing` is grouped with other testing rules regardless of which file or
 * platform it came from. Categories stay open-ended strings — the point is to
 * group, not to validate against a fixed vocabulary.
 */
export function deriveDirectives(instruction: Instruction, options: DeriveOptions = {}): Directive[] {
  const minimumLength = options.minimumLength ?? MINIMUM_DIRECTIVE_LENGTH;
  const lines = instruction.body.split("\n");
  const bodyStartLine = instruction.bodyLine ?? 1;

  const directives: Directive[] = [];
  let category: string | undefined;
  let fence: string | undefined;
  let index = 0;

  for (let offset = 0; offset < lines.length; offset++) {
    const line = lines[offset];

    // Code blocks are examples, not rules.
    const fenceMatch = line.match(FENCE);
    if (fenceMatch) {
      if (fence && line.trimStart().startsWith(fence)) fence = undefined;
      else if (!fence) fence = fenceMatch[1];
      continue;
    }
    if (fence) continue;

    const heading = line.match(HEADING);
    if (heading) {
      category = slugify(heading[2]) || undefined;
      continue;
    }

    const item = line.match(BULLET) ?? line.match(ORDERED);
    if (!item) continue;

    const text = stripLabelPrefix(item[1]);
    if (text.length < minimumLength) continue;
    if (isStructuralBullet(text)) continue;

    const provenance = {
      ...instruction.provenance,
      line: bodyStartLine + offset,
      origin: "derived" as const,
      note: `derived from a bullet in ${instruction.provenance.file}`,
    };

    directives.push({
      id: nodeId("directive", provenance, `derived-${index++}`),
      text,
      category,
      // A derived directive applies exactly where its instruction applies.
      applies: instruction.applies,
      provenance,
    });
  }

  return directives;
}

/** Derives directives from every instruction in a list. */
export function deriveAllDirectives(instructions: readonly Instruction[], options: DeriveOptions = {}): Directive[] {
  return instructions.flatMap((instruction) => deriveDirectives(instruction, options));
}
