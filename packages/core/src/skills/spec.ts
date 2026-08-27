/**
 * The Agent Skills specification, as constraints.
 *
 * Every number and rule here comes from the published specification
 * (<https://agentskills.io/specification>), recorded with its source in
 * docs/v2-architecture.md §5.3. Nothing is an agentfile opinion — where the
 * specification says "recommended" rather than "must", the constant says so and
 * the diagnostic that uses it is a warning rather than an error.
 *
 * `SKILL.md` is an external standard. Agentfile validates against it; it does
 * not extend it, and it does not invent a replacement.
 */

/** Spec: `name` is 1–64 characters. */
export const MAX_NAME_LENGTH = 64;

/** Spec: `description` is 1–1024 characters. */
export const MAX_DESCRIPTION_LENGTH = 1024;

/** Spec: `compatibility` is 1–500 characters. */
export const MAX_COMPATIBILITY_LENGTH = 500;

/**
 * Spec: lowercase `a-z0-9` and `-`, no leading or trailing hyphen, no `--`.
 *
 * Written as one anchored pattern so the check and the error message cannot
 * disagree about what is allowed.
 */
export const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Spec: the body should stay under roughly 5000 tokens, and `SKILL.md` under
 * 500 lines. Both are recommendations, so exceeding them is a warning.
 */
export const RECOMMENDED_BODY_TOKENS = 5000;
export const RECOMMENDED_BODY_LINES = 500;

/** Spec: references should be relative paths, one level deep. */
export const MAX_RESOURCE_DEPTH = 1;

/**
 * Claude Code truncates `description` plus `when_to_use` at 1,536 characters in
 * its skill listing. Relevant to portability, not to specification compliance.
 */
export const CLAUDE_LISTING_LIMIT = 1536;

/** Fields the specification defines. Anything else is an extension. */
export const SPEC_FIELDS: readonly string[] = [
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
];

/**
 * Extension keys Claude Code documents.
 *
 * Listed so a portability finding can say *whose* extension a key is, rather
 * than only that it is not in the specification. A key absent from both lists is
 * reported as unrecognised, which is a different and weaker claim.
 */
export const CLAUDE_EXTENSION_FIELDS: readonly string[] = [
  "when_to_use",
  "paths",
  "disallowed-tools",
  "model",
  "effort",
  "disable-model-invocation",
];

/** Cursor's documented frontmatter extensions. */
export const CURSOR_EXTENSION_FIELDS: readonly string[] = ["paths", "disable-model-invocation", "icon", "color"];

export type NameProblem =
  | { kind: "empty" }
  | { kind: "too-long"; length: number }
  | { kind: "invalid-characters" }
  | { kind: "directory-mismatch"; directory: string };

/**
 * Checks a skill name against the specification.
 *
 * The directory check is part of the specification, not a convention: the name
 * must match the parent directory, because that is how every platform's loader
 * finds the skill. A mismatch means the skill loads under a different name than
 * its own frontmatter claims.
 */
export function checkName(name: string, directoryName?: string): NameProblem[] {
  const problems: NameProblem[] = [];
  const trimmed = name.trim();

  if (!trimmed) {
    problems.push({ kind: "empty" });
    return problems;
  }

  if (trimmed.length > MAX_NAME_LENGTH) {
    problems.push({ kind: "too-long", length: trimmed.length });
  }
  if (!NAME_PATTERN.test(trimmed)) {
    problems.push({ kind: "invalid-characters" });
  }
  if (directoryName && trimmed !== directoryName) {
    problems.push({ kind: "directory-mismatch", directory: directoryName });
  }

  return problems;
}

/** Human sentence for a name problem, in the specification's own terms. */
export function describeNameProblem(name: string, problem: NameProblem): string {
  switch (problem.kind) {
    case "empty":
      return "name is empty; the specification requires 1–64 characters";
    case "too-long":
      return `name is ${problem.length} characters, over the specification's 64-character limit`;
    case "invalid-characters":
      return `name "${name}" must be lowercase letters, digits, and single hyphens, with no leading, trailing, or doubled hyphen`;
    case "directory-mismatch":
      return `name "${name}" does not match its directory "${problem.directory}"; the specification requires them to be the same, and platforms load the skill under the directory name`;
  }
}

/** Depth of a resource path below the skill directory. `scripts/build.sh` is 1. */
export function resourceDepth(relativePath: string): number {
  return relativePath.split("/").length - 1;
}
