/**
 * Helpers shared by the discovery adapters.
 */

import type { Applicability, ConfigOrigin, ConfigScope, PlatformId, Provenance } from "../ir/index.js";
import { ALWAYS, appliesToDirectory } from "../ir/index.js";
import { hasGeneratedMarker } from "../manifest.js";
import { basenameOf, dirnameOf, ROOT_PATH } from "../paths/index.js";

/**
 * Configuration directory names whose *parent* is the directory the
 * configuration governs. A rule in `apps/web/.claude/rules/style.md` applies to
 * `apps/web`, not to `apps/web/.claude`.
 */
const CONFIG_DIRECTORIES = [".claude", ".cursor", ".github", ".agents", "ai"];

/**
 * The directory a configuration file governs.
 *
 * Walks out of any configuration-directory segments, so nesting depth reflects
 * the code the configuration applies to rather than where it happens to be
 * filed.
 */
export function governedDirectory(file: string): string {
  let directory = dirnameOf(file);

  while (directory !== ROOT_PATH) {
    const segments = directory.split("/");
    const last = segments[segments.length - 1];

    // Walk out of a configuration directory, and out of its subdirectories
    // (`rules`, `skills`, `agents`, `instructions`) on the way.
    if (CONFIG_DIRECTORIES.includes(last)) {
      segments.pop();
      directory = segments.join("/");
      continue;
    }

    const parentIndex = segments.findIndex((segment) => CONFIG_DIRECTORIES.includes(segment));
    if (parentIndex === -1) break;

    directory = segments.slice(0, parentIndex).join("/");
    break;
  }

  return directory;
}

/**
 * Scope for a discovered file: repository-wide when it governs the root,
 * directory-scoped when it sits inside a subdirectory.
 */
export function scopeFor(file: string, override?: ConfigScope): ConfigScope {
  if (override) return override;
  return governedDirectory(file) === ROOT_PATH ? "project" : "directory";
}

/** Applicability for a hierarchical instruction file: root-wide, or its subtree. */
export function hierarchicalApplicability(file: string): Applicability {
  const directory = governedDirectory(file);
  return directory === ROOT_PATH ? ALWAYS : appliesToDirectory(directory);
}

/**
 * Globs in a nested rule directory are relative to what that directory
 * governs, not to the repository root.
 *
 * Cursor and Claude both let a subproject carry its own rule directory, and a
 * rule in `python/.cursor/rules` writing `globs: *.py` means the Python files
 * beside it. Matching that at the root got it wrong in both directions: the
 * rule was reported dead while `python/conftest.py` sat next to it, and it was
 * reported live whenever any unrelated `*.py` happened to exist at the root —
 * a reachability answer that had nothing to do with the rule.
 *
 * A leading `/` is the author anchoring to the repository root themselves, so
 * that reading is preserved rather than nested a second time.
 */
export function scopedPatterns(file: string, patterns: readonly string[]): string[] {
  const directory = governedDirectory(file);

  return patterns.map((pattern) => {
    const trimmed = pattern.trim();
    if (trimmed.startsWith("/")) return trimmed.slice(1);
    return directory === ROOT_PATH ? trimmed : `${directory}/${trimmed}`;
  });
}

export function provenanceOf(
  file: string,
  platform: PlatformId,
  options: { line?: number; scope?: ConfigScope; origin?: ConfigOrigin; note?: string } = {},
): Provenance {
  return {
    file,
    line: options.line,
    platform,
    scope: scopeFor(file, options.scope),
    origin: options.origin ?? "declared",
    note: options.note,
  };
}

/**
 * Origin for a discovered file, from its own first line.
 *
 * A file carrying the generated-by-agentfile marker was compiled from other
 * sources that are also in the configuration. Recording it as `generated` keeps
 * `explain` truthful and keeps compilers from feeding their own output back
 * into the next compile.
 */
export function originFor(text: string): ConfigOrigin {
  return hasGeneratedMarker(text) ? "generated" : "declared";
}

/**
 * Removes fenced code blocks and inline code spans.
 *
 * Import detection has to ignore code, because a documented `@path` inside a
 * code span is an example, not an import — which is exactly how Claude Code
 * itself parses imports.
 */
export function stripCode(markdown: string): string {
  return markdown.replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1[ \t]*$/gm, "").replace(/`[^`\n]*`/g, "");
}

/**
 * A scoped npm package name: one slash, npm-legal lowercase segments, and no
 * file extension on the second segment. `@next/rspack-core` in prose is a
 * package, and this shape appears in almost every JavaScript repository —
 * treating it as an import would report half the ecosystem as broken. A real
 * one-slash extensionless directory import loses out to this rule; that trade
 * is deliberate, and imports with an extension or a deeper path are unaffected.
 */
const NPM_SCOPED_PACKAGE = /^[a-z0-9~-][a-z0-9._~-]*\/[a-z0-9._~-]+$/;

/**
 * Import targets declared in a markdown body with `@path` syntax.
 *
 * Matches the documented form: an `@` at a word boundary followed by a path.
 * Email addresses and decorators are excluded by requiring the `@` to start a
 * token, and by requiring the target to look like a path or a filename.
 *
 * `]` ends a capture because a markdown link is not an import: in
 * `[Victorien Elvinger @Conaclos](https://github.com/Conaclos)` the capture
 * would otherwise run through the link syntax into the URL, pick up a `/`,
 * and pass the looks-like-a-path gate. Biome's CLAUDE.md credits twenty-two
 * maintainers exactly that way, and no real import target contains a `]`.
 */
export function findImports(markdown: string): string[] {
  const cleaned = stripCode(markdown);
  const found = new Set<string>();

  for (const match of cleaned.matchAll(/(^|[\s(])@([^\s)\]*,;'"]+)/g)) {
    const target = match[2].replace(/[.,:;]+$/, "");

    // A bare word is a mention, not an import. Require a path separator or an
    // extension so `@claude` in prose is not mistaken for a file.
    if (!target.includes("/") && !/\.[a-z0-9]+$/i.test(target)) continue;

    if (NPM_SCOPED_PACKAGE.test(target) && !/\.[a-z0-9]+$/i.test(target.split("/")[1])) continue;

    found.add(target);
  }

  return [...found].sort();
}

export { basenameOf } from "../paths/index.js";

/** Immediate parent directory name of a path, or "" at the root. */
export function parentDirectoryName(path: string): string {
  const directory = dirnameOf(path);
  return directory === ROOT_PATH ? "" : basenameOf(directory);
}
