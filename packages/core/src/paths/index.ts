/**
 * Path normalisation, glob matching, and specificity ordering.
 *
 * Every path handled by the v2 layers is a **project-relative POSIX path** with
 * no leading `./` and no trailing slash. The project root is the empty string.
 * Normalising once at the boundary means the resolver never has to care whether
 * it was handed `apps\mobile\src`, `./apps/mobile/src/`, or `apps/mobile/src`.
 *
 * Glob matching delegates to Node's built-in `path.matchesGlob` (present since
 * v22.5, stable since v24.8) so there is no third-party matcher to keep in sync.
 * Semantics are standard glob:
 *
 *   • `*`  matches within one segment and does not cross `/`
 *   • `**` crosses segment boundaries
 *   • `{a,b}` brace alternatives are supported
 *   • a leading dot is NOT matched by a leading `*` — `**\/*.md` does not match
 *     `.claude/rules/x.md`. Patterns must name dot directories explicitly.
 *
 * The matcher is deliberately behind this module: swapping the engine, or adding
 * an option such as dot-matching, is a single-file change.
 */

import { posix } from "node:path";

/**
 * Glob matching, pinned to POSIX semantics.
 *
 * `path.matchesGlob` resolves to the win32 implementation on Windows, which
 * also treats `\` as a separator. Every path in the IR is normalised to POSIX
 * form regardless of platform, so matching them with win32 rules would make the
 * same repository resolve differently depending on who cloned it.
 */
const matchesGlob = posix.matchesGlob;

/** The project root, expressed as a normalised path. */
export const ROOT_PATH = "";

/**
 * Normalises any incoming path to the project-relative POSIX form.
 * Absolute paths are preserved as absolute (a leading `/` is kept), because
 * losing that would silently change meaning.
 */
export function normalizePath(input: string): string {
  let value = input.replaceAll("\\", "/");

  const isAbsolute = value.startsWith("/");

  // Collapse repeated separators and drop `.` segments.
  const segments = value.split("/").filter((segment) => segment.length > 0 && segment !== ".");

  value = segments.join("/");

  return isAbsolute ? `/${value}` : value;
}

/** Directory portion of a path. Returns ROOT_PATH for a top-level file. */
/** Last path segment. `""` for the root. */
export function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function dirnameOf(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? ROOT_PATH : normalized.slice(0, index);
}

/** Number of segments in a directory path. The root is depth 0. */
export function pathDepth(path: string): number {
  const normalized = normalizePath(path);
  if (normalized === ROOT_PATH) return 0;
  return normalized.split("/").length;
}

/**
 * Directories that contain `path`, root first.
 *
 *   ancestorDirectories("apps/mobile/src/Login.tsx")
 *     → ["", "apps", "apps/mobile", "apps/mobile/src"]
 *
 * Root-first ordering is deliberate: it is the order in which the platforms
 * themselves concatenate hierarchical instruction files.
 */
export function ancestorDirectories(path: string): string[] {
  const dir = dirnameOf(path);
  if (dir === ROOT_PATH) return [ROOT_PATH];

  const segments = dir.split("/");
  const result: string[] = [ROOT_PATH];

  for (let index = 0; index < segments.length; index++) {
    result.push(segments.slice(0, index + 1).join("/"));
  }

  return result;
}

/** True when `child` is inside `parent` (or `parent` is the root). */
export function isWithin(parent: string, child: string): boolean {
  const parentPath = normalizePath(parent);
  const childPath = normalizePath(child);

  if (parentPath === ROOT_PATH) return true;
  if (parentPath === childPath) return true;

  return childPath.startsWith(`${parentPath}/`);
}

/**
 * Expands the shorthand forms users actually write into explicit globs:
 *
 *   `src/`   → `src/**`   (a trailing slash means "everything under here")
 *   `src`    → `src`      (left alone — it may be a file)
 */
export function expandDirectoryPattern(pattern: string): string {
  const trimmed = pattern.trim();
  return trimmed.endsWith("/") ? `${trimmed}**` : trimmed;
}

/** True when `path` matches `pattern`. */
export function matchesPattern(path: string, pattern: string): boolean {
  return matchesGlob(normalizePath(path), expandDirectoryPattern(pattern));
}

/** True when `path` matches at least one pattern. An empty list matches nothing. */
export function matchesAnyPattern(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesPattern(path, pattern));
}

/** Every pattern from `patterns` that matches `path`, in declaration order. */
export function matchingPatterns(path: string, patterns: readonly string[]): string[] {
  return patterns.filter((pattern) => matchesPattern(path, pattern));
}

/**
 * Splits a comma-separated glob list without breaking brace groups.
 *
 * Every platform that accepts a glob list as a single string documents it as
 * comma-separated, and every one of them also supports brace expansion — so a
 * naive `split(",")` mangles `src/**\/*.{ts,tsx}` into two broken patterns.
 * Commas inside `{}` or `[]` are part of the pattern, not separators.
 *
 * Splitting on commas only, never whitespace: a path may legitimately contain a
 * space.
 */
export function splitGlobList(value: string): string[] {
  const patterns: string[] = [];
  let current = "";
  let braceDepth = 0;
  let bracketDepth = 0;

  for (const character of value) {
    if (character === "{") braceDepth++;
    else if (character === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (character === "[") bracketDepth++;
    else if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (character === "," && braceDepth === 0 && bracketDepth === 0) {
      patterns.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  patterns.push(current);

  return patterns.map((pattern) => pattern.trim()).filter(Boolean);
}

// ─── Specificity ───────────────────────────────────────────────────────────

const WILDCARD_CHARS = /[*?{}[\]!]/;

export interface GlobSpecificity {
  /** Segments containing no wildcard characters. */
  literalSegments: number;
  /** Segments containing at least one wildcard character. */
  wildcardSegments: number;
  /** Whether the pattern contains a `**` segment. */
  hasGlobstar: boolean;
  /** Raw pattern length, used only as a final tiebreaker. */
  length: number;
}

export function globSpecificity(pattern: string): GlobSpecificity {
  const expanded = expandDirectoryPattern(pattern);
  const segments = expanded.split("/").filter((segment) => segment.length > 0);

  let literalSegments = 0;
  let wildcardSegments = 0;
  let hasGlobstar = false;

  for (const segment of segments) {
    if (segment === "**") {
      hasGlobstar = true;
      wildcardSegments++;
    } else if (WILDCARD_CHARS.test(segment)) {
      wildcardSegments++;
    } else {
      literalSegments++;
    }
  }

  return { literalSegments, wildcardSegments, hasGlobstar, length: expanded.length };
}

/**
 * Orders patterns from least to most specific — the order in which they should
 * be applied, so that the most specific pattern is applied last and therefore
 * wins. The rules, in order:
 *
 *   1. more literal segments is more specific  (`src/api/*` beats `src/**`)
 *   2. no globstar is more specific            (`src/*.ts` beats `src/**`)
 *   3. fewer wildcard segments is more specific
 *   4. longer pattern is more specific         (final, length-based tiebreaker)
 *   5. lexicographic, purely so ordering is total and stable
 */
export function compareGlobSpecificity(a: string, b: string): number {
  const left = globSpecificity(a);
  const right = globSpecificity(b);

  if (left.literalSegments !== right.literalSegments) {
    return left.literalSegments - right.literalSegments;
  }
  if (left.hasGlobstar !== right.hasGlobstar) {
    return left.hasGlobstar ? -1 : 1;
  }
  if (left.wildcardSegments !== right.wildcardSegments) {
    return right.wildcardSegments - left.wildcardSegments;
  }
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  return a.localeCompare(b);
}

/** Patterns sorted least-specific first. */
export function sortByGlobSpecificity(patterns: readonly string[]): string[] {
  return [...patterns].sort(compareGlobSpecificity);
}
