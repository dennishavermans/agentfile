/**
 * Near-duplicate detection.
 *
 * Exact duplication is the easy half of the problem. The half that actually
 * costs teams is drift: the same rule copied into four platform files, and then
 * one of them edited. After that edit the copies no longer match, so exact
 * comparison goes quiet — at exactly the moment the configuration started
 * disagreeing with itself.
 *
 * This finds those pairs with token-set Jaccard similarity over normalised
 * lines. Jaccard is computed exactly rather than approximated with MinHash: the
 * rework brief lists MinHash as a candidate technique, but MinHash exists to
 * approximate Jaccard when the corpus is too large to compare pairwise, and an
 * instruction corpus is hundreds of lines. Approximating here would add error
 * for no saving, so the pairwise cost is paid and bounded instead.
 *
 * What this does NOT do is detect paraphrase. "Use pnpm" and "npm is
 * forbidden" share no tokens and will never be reported. Paraphrase detection
 * needs embeddings, which the brief keeps optional; the honest boundary is
 * stated in the diagnostic rather than papered over.
 */

import { type Diagnostic, diagnostic } from "../diagnostics/index.js";
import type { Instruction } from "../ir/index.js";
import { type InstructionLine, instructionLines, type LineOptions } from "./lines.js";

/**
 * Function words dropped before comparison.
 *
 * Deliberately tiny, and deliberately free of negations and modality. Dropping
 * "not", "never", "always", or "must" would make "always run the tests" and
 * "never run the tests" identical — turning a contradiction into a duplicate,
 * which is the worst possible failure for this analysis.
 */
const STOPWORDS = new Set([
  "a",
  "also",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "but",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "these",
  "this",
  "those",
  "to",
  "was",
  "we",
  "were",
  "with",
  "you",
  "your",
]);

/**
 * Markers that flip a statement's polarity.
 *
 * Two lines whose polarity differs are never reported as near-duplicates. They
 * may well be a contradiction, but calling a contradiction a duplicate would
 * send a developer to delete one of them — so the pair is skipped and left to
 * conflict analysis (AGF301), which is not deterministic yet.
 */
const NEGATION =
  /\b(not|never|no|none|nor|cannot|cant|dont|doesnt|didnt|wont|shouldnt|avoid|without|forbidden|prohibited)\b/;

/** Content tokens of a normalised line. */
export function tokenize(normalized: string): string[] {
  return normalized
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/** True when the line carries a negation marker. */
export function hasNegation(normalized: string): boolean {
  return NEGATION.test(normalized.replace(/['’]/g, ""));
}

/** |A ∩ B| / |A ∪ B|. Returns 0 for two empty sets. */
export function jaccardSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size && !b.size) return 0;

  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) {
    if (large.has(token)) shared++;
  }

  return shared / (a.size + b.size - shared);
}

/**
 * Similarity at or above which two lines are reported.
 *
 * Chosen against real drift: "Use pnpm as the package manager" against "Use
 * pnpm as the package manager, never npm" scores 0.67, and "Never commit
 * secrets to the repository" against "Never commit secrets to this repo" scores
 * 0.60. Raising the bar past those misses the cases this exists for; lowering it
 * starts pairing rules that merely share vocabulary.
 */
export const NEAR_DUPLICATE_THRESHOLD = 0.6;

/** Fewest content tokens a line needs before its similarity score means anything. */
export const MINIMUM_CONTENT_TOKENS = 4;

/** Fewest tokens two lines must share before the pair is considered at all. */
export const MINIMUM_SHARED_TOKENS = 3;

/**
 * Comparison budget.
 *
 * Reached only on a repository with an extraordinary amount of instruction
 * prose. When it is reached the result says so — a silent cap would report
 * "nothing found" for a corpus that was never fully compared.
 */
export const MAXIMUM_COMPARISONS = 2_000_000;

export interface NearDuplicatePair {
  a: InstructionLine;
  b: InstructionLine;
  /** Jaccard similarity of the two token sets, 0–1. */
  similarity: number;
  /** Tokens both lines contain, sorted. */
  sharedTokens: string[];
}

export interface NearDuplicateResult {
  pairs: NearDuplicatePair[];
  /** True when the comparison budget stopped the search early. */
  truncated: boolean;
  comparisons: number;
}

export interface NearDuplicateOptions extends LineOptions {
  /** Similarity at or above which a pair is reported. Default 0.6. */
  threshold?: number;
  /** Compare lines within the same file too. Default false. */
  includeSameFile?: boolean;
  /** Comparison budget. Default 2,000,000. */
  maxComparisons?: number;
}

/**
 * Finds pairs of instruction lines that say nearly the same thing.
 *
 * Only pairs from different files are reported by default: a file repeating
 * itself is a lint concern about that file, while the same rule in two files
 * that no longer match is configuration disagreeing with itself.
 *
 * Candidate pairs come from an inverted token index, so lines with nothing in
 * common are never compared. That is what keeps this inside a pre-commit budget
 * without approximating the metric.
 */
export function findNearDuplicateInstructions(
  instructions: readonly Instruction[],
  options: NearDuplicateOptions = {},
): NearDuplicateResult {
  const threshold = options.threshold ?? NEAR_DUPLICATE_THRESHOLD;
  const includeSameFile = options.includeSameFile ?? false;
  const budget = options.maxComparisons ?? MAXIMUM_COMPARISONS;

  const lines = instructionLines(instructions, options);
  const tokenSets = lines.map((entry) => new Set(tokenize(entry.normalized)));
  const negated = lines.map((entry) => hasNegation(entry.normalized));

  // Inverted index: token → indices of the lines containing it.
  const postings = new Map<string, number[]>();
  for (let index = 0; index < lines.length; index++) {
    if (tokenSets[index].size < MINIMUM_CONTENT_TOKENS) continue;
    for (const token of tokenSets[index]) {
      const list = postings.get(token);
      if (list) list.push(index);
      else postings.set(token, [index]);
    }
  }

  const pairs: NearDuplicatePair[] = [];
  const compared = new Set<string>();
  let comparisons = 0;
  let truncated = false;

  outer: for (const list of postings.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const left = list[i];
        const right = list[j];
        const key = `${left}:${right}`;
        if (compared.has(key)) continue;

        if (comparisons >= budget) {
          truncated = true;
          break outer;
        }
        compared.add(key);
        comparisons++;

        const a = lines[left];
        const b = lines[right];

        if (!includeSameFile && a.file === b.file) continue;
        // Exact matches are duplication, not drift. AGF302 owns those.
        if (a.normalized === b.normalized) continue;
        // A contradiction is not a duplicate. See NEGATION.
        if (negated[left] !== negated[right]) continue;

        // Both indices came from the postings list, so both already satisfy
        // MINIMUM_CONTENT_TOKENS.
        const setA = tokenSets[left];
        const setB = tokenSets[right];

        const shared = [...setA].filter((token) => setB.has(token)).sort();
        if (shared.length < MINIMUM_SHARED_TOKENS) continue;

        const similarity = jaccardSimilarity(setA, setB);
        if (similarity < threshold) continue;

        pairs.push({ a, b, similarity, sharedTokens: shared });
      }
    }
  }

  // Deterministic ordering: strongest match first, then by location.
  pairs.sort(
    (x, y) =>
      y.similarity - x.similarity ||
      x.a.file.localeCompare(y.a.file) ||
      x.a.line - y.a.line ||
      x.b.file.localeCompare(y.b.file) ||
      x.b.line - y.b.line,
  );

  return { pairs, truncated, comparisons };
}

/** Turns near-duplicate pairs into AGF305 diagnostics. */
export function nearDuplicateDiagnostics(pairs: readonly NearDuplicatePair[]): Diagnostic[] {
  return pairs.map((pair) => {
    const percentage = Math.round(pair.similarity * 100);
    const crossPlatform = pair.a.platform !== pair.b.platform;

    return diagnostic({
      code: "AGF305",
      message: `Near-duplicate instruction (${percentage}% similar): "${pair.a.text}"`,
      explanation: [
        crossPlatform
          ? `These two lines are ${percentage}% similar and are maintained separately for ${pair.a.platform} and ${pair.b.platform}.`
          : `These two lines are ${percentage}% similar.`,
        "",
        `  ${pair.a.file}:${pair.a.line}`,
        `    ${pair.a.text}`,
        `  ${pair.b.file}:${pair.b.line}`,
        `    ${pair.b.text}`,
        "",
        "If they are the same rule, one copy has been edited and the other has not.",
        "If they are genuinely different rules that happen to share wording, this is",
        "not a problem — similarity is measured on words, not meaning.",
      ].join("\n"),
      suggestion:
        "Decide which wording is correct, then keep it in one place and generate the rest, so the copies cannot drift again.",
      location: { file: pair.a.file, line: pair.a.line },
      related: [
        {
          location: { file: pair.b.file, line: pair.b.line },
          message: `${percentage}% similar wording in ${pair.b.platform} configuration`,
        },
      ],
      data: {
        similarity: pair.similarity,
        sharedTokens: pair.sharedTokens.join(","),
        platforms: [pair.a.platform, pair.b.platform].sort().join(","),
      },
    });
  });
}
