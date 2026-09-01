/**
 * Discovery of instruction files.
 *
 * Every format handled here is documented in docs/v2-architecture.md §5, with a
 * source URL. Nothing about a platform's behaviour is inferred: where a format
 * has no documented way to express something, the adapter does not invent one.
 */

import { join } from "node:path";
import { type Diagnostic, diagnostic } from "../diagnostics/index.js";
import type { FileSystem } from "../fs/index.js";
import {
  ALWAYS,
  appliesToPaths,
  type Instruction,
  MANUAL,
  MODEL_SELECTED,
  nodeId,
  type PlatformId,
  type SourceFile,
  slugify,
} from "../ir/index.js";
import {
  booleanField,
  globListField,
  parseCursorFrontmatter,
  parseFrontmatter,
  stringField,
} from "../parsers/frontmatter.js";
import { normalizePath } from "../paths/index.js";
import { filesNamed, filesUnder, type RepositoryScan } from "./scan.js";
import {
  basenameOf,
  findImports,
  governedDirectory,
  hierarchicalApplicability,
  originFor,
  provenanceOf,
  scopedPatterns,
} from "./shared.js";

export interface DiscoveredInstructions {
  instructions: Instruction[];
  sources: SourceFile[];
  diagnostics: Diagnostic[];
}

function emptyResult(): DiscoveredInstructions {
  return { instructions: [], sources: [], diagnostics: [] };
}

function readFile(fs: FileSystem, root: string, relativePath: string): string | undefined {
  try {
    return fs.readFile(join(root, relativePath));
  } catch {
    return undefined;
  }
}

function sourceOf(file: string, platform: PlatformId, kind: string, text: string, scope?: SourceFile["scope"]) {
  const provenance = provenanceOf(file, platform, { scope });
  return {
    path: file,
    platform,
    scope: provenance.scope,
    kind,
    bytes: text.length,
  } satisfies SourceFile;
}

// ─── AGENTS.md ─────────────────────────────────────────────────────────────

/**
 * AGENTS.md is plain Markdown with no frontmatter and no required structure.
 * Nested files are read, and the nearest file in the tree takes precedence.
 */
export function discoverAgentsMd(root: string, scan: RepositoryScan, fs: FileSystem): DiscoveredInstructions {
  const result = emptyResult();

  for (const file of filesNamed(scan, "AGENTS.md")) {
    const text = readFile(fs, root, file);
    if (text === undefined) continue;

    const provenance = provenanceOf(file, "agents-md", { origin: originFor(text) });
    result.instructions.push({
      id: nodeId("instruction", provenance, "agents-md"),
      title: file,
      body: text,
      applies: hierarchicalApplicability(file),
      provenance,
    });
    result.sources.push(sourceOf(file, "agents-md", "instructions", text));
  }

  return result;
}

// ─── CLAUDE.md ─────────────────────────────────────────────────────────────

/**
 * Claude Code memory files.
 *
 * `CLAUDE.md` and `.claude/CLAUDE.md` are team-shared; `CLAUDE.local.md` is
 * personal and untracked, and is read after the shared file at the same level,
 * which is why it maps to the `local` scope.
 */
export function discoverClaudeMd(root: string, scan: RepositoryScan, fs: FileSystem): DiscoveredInstructions {
  const result = emptyResult();

  const candidates: Array<{ file: string; scope?: SourceFile["scope"] }> = [
    ...filesNamed(scan, "CLAUDE.md").map((file) => ({ file })),
    ...filesNamed(scan, "CLAUDE.local.md").map((file) => ({ file, scope: "local" as const })),
  ];

  for (const { file, scope } of candidates) {
    const text = readFile(fs, root, file);
    if (text === undefined) continue;

    const provenance = provenanceOf(file, "claude", { scope, origin: originFor(text) });
    const imports = findImports(text);

    result.instructions.push({
      id: nodeId("instruction", provenance, basenameOf(file)),
      title: file,
      body: text,
      applies: hierarchicalApplicability(file),
      provenance,
      imports: imports.length ? imports : undefined,
    });
    result.sources.push(sourceOf(file, "claude", "instructions", text, scope));
  }

  return result;
}

/**
 * `.claude/rules/**\/*.md`.
 *
 * A `paths` frontmatter list scopes the rule to matching files; a rule without
 * `paths` loads unconditionally, at the same priority as the project CLAUDE.md.
 */
export function discoverClaudeRules(root: string, scan: RepositoryScan, fs: FileSystem): DiscoveredInstructions {
  const result = emptyResult();

  for (const file of filesUnder(scan, [".claude/rules"], ".md")) {
    const text = readFile(fs, root, file);
    if (text === undefined) continue;

    const parsed = parseFrontmatter(file, text);
    result.diagnostics.push(...parsed.diagnostics);

    const paths = globListField(parsed.data, "paths");
    const provenance = provenanceOf(file, "claude", { origin: originFor(text) });

    result.instructions.push({
      id: nodeId("instruction", provenance, slugify(basenameOf(file))),
      title: file,
      body: parsed.body,
      bodyLine: parsed.bodyLine,
      // A path-scoped rule is glob-scoped. An unscoped rule follows the file's
      // own position in the tree, matching how nested rule directories behave.
      applies: paths?.length ? appliesToPaths(scopedPatterns(file, paths)) : hierarchicalApplicability(file),
      provenance,
    });
    result.sources.push(sourceOf(file, "claude", "rule", text));
  }

  return result;
}

// ─── Cursor ────────────────────────────────────────────────────────────────

/**
 * `.cursor/rules/**\/*.mdc`.
 *
 * Cursor documents four application modes, and the frontmatter selects between
 * them: `alwaysApply: true` is always-on, `globs` auto-attaches on matching
 * files, a `description` alone lets the agent decide, and none of the three
 * leaves the rule manual-only.
 */
export function discoverCursorRules(root: string, scan: RepositoryScan, fs: FileSystem): DiscoveredInstructions {
  const result = emptyResult();

  for (const file of filesUnder(scan, [".cursor/rules"], ".mdc")) {
    const text = readFile(fs, root, file);
    if (text === undefined) continue;

    // Cursor's own reader, not YAML. See parseCursorFrontmatter.
    const parsed = parseCursorFrontmatter(file, text);
    result.diagnostics.push(...parsed.diagnostics);

    const alwaysApply = booleanField(parsed.data, "alwaysApply");
    const rawGlobs = stringField(parsed.data, "globs");
    const globs = globListField(parsed.data, "globs");
    const description = stringField(parsed.data, "description");

    const unmatchable = unmatchableGlobDiagnostics(file, rawGlobs);
    result.diagnostics.push(...unmatchable);

    // A glob Cursor cannot match is not a path scope, so an unmatchable one
    // falls through to manual. Treating it as a scope would report the rule
    // dead a second time under AGF303 — true, but the same finding with the
    // cause stripped off.
    const pathScoped = !unmatchable.length && globs?.length;

    const applies = alwaysApply
      ? ALWAYS
      : pathScoped
        ? appliesToPaths(scopedPatterns(file, globs as string[]))
        : description && !unmatchable.length
          ? MODEL_SELECTED
          : MANUAL;

    const provenance = provenanceOf(file, "cursor", { origin: originFor(text) });
    result.instructions.push({
      id: nodeId("instruction", provenance, slugify(basenameOf(file))),
      title: description ?? file,
      body: parsed.body,
      bodyLine: parsed.bodyLine,
      applies,
      provenance,
    });
    result.sources.push(sourceOf(file, "cursor", "rule", text));
  }

  return result;
}

/** Legacy single-file Cursor rules, superseded by `.cursor/rules` but still read. */
export function discoverLegacyCursorRules(root: string, scan: RepositoryScan, fs: FileSystem): DiscoveredInstructions {
  const result = emptyResult();

  for (const file of filesNamed(scan, ".cursorrules")) {
    const text = readFile(fs, root, file);
    if (text === undefined) continue;

    const provenance = provenanceOf(file, "cursor", { origin: originFor(text) });
    result.instructions.push({
      id: nodeId("instruction", provenance, "cursorrules"),
      title: file,
      body: text,
      applies: hierarchicalApplicability(file),
      provenance,
    });
    result.sources.push(sourceOf(file, "cursor", "legacy-rule", text));
  }

  return result;
}

/**
 * Globs written in a shape Cursor will not match.
 *
 * Cursor takes the raw text after `globs:` as the pattern list, so quoting or
 * bracketing it does not produce a string — it produces a pattern containing
 * the punctuation. `globs: "*.py"` asks for a file literally named `"*.py"`,
 * quotes included, and nothing matches. The rule then never attaches, with no
 * error anywhere, which is the failure this project exists to surface.
 *
 * Worth stating plainly because the instinct is backwards here: quoting is the
 * right fix in YAML and the wrong one in `.mdc`. Cursor's documentation shows
 * every glob unquoted and comma-separated.
 */
function unmatchableGlobDiagnostics(file: string, globs: string | undefined): Diagnostic[] {
  const value = globs?.trim();
  if (!value) return [];

  const quoted = /^(["']).*\1$/.test(value);
  // A YAML flow sequence, not a glob character class. `[abc]*.ts` and
  // `[a-z]*/**` are legal patterns that open with `[`, so a leading bracket
  // alone proves nothing; the quotes are what make it a list someone typed
  // expecting YAML to unwrap them.
  const bracketed = value.startsWith("[") && value.endsWith("]") && /["']/.test(value);
  if (!quoted && !bracketed) return [];

  const bare = bracketed
    ? value
        .replace(/^\[|\]$/g, "")
        .replace(/["']/g, "")
        .trim()
    : value.slice(1, -1);

  return [
    diagnostic({
      code: "AGF306",
      message: `Cursor will not match globs written as ${bracketed ? "a list" : "a quoted string"}: ${value}`,
      explanation:
        "Cursor reads the text after `globs:` as the pattern list rather than as YAML, so the " +
        `${bracketed ? "brackets and quotes" : "quote characters"} become part of the pattern. ` +
        "Nothing matches, and the rule silently never attaches to any file.",
      suggestion: `Write the patterns bare and comma-separated: globs: ${bare}`,
      location: { file, line: 1 },
      data: { value, form: bracketed ? "list" : "quoted" },
    }),
  ];
}

// ─── GitHub Copilot ────────────────────────────────────────────────────────

/**
 * `.github/copilot-instructions.md` (repository-wide) and
 * `.github/instructions/*.instructions.md` (path-specific, via `applyTo`).
 */
export function discoverCopilotInstructions(
  root: string,
  scan: RepositoryScan,
  fs: FileSystem,
): DiscoveredInstructions {
  const result = emptyResult();

  for (const file of filesNamed(scan, "copilot-instructions.md")) {
    const text = readFile(fs, root, file);
    if (text === undefined) continue;

    const provenance = provenanceOf(file, "copilot", { origin: originFor(text) });
    result.instructions.push({
      id: nodeId("instruction", provenance, "copilot-instructions"),
      title: file,
      body: text,
      applies: hierarchicalApplicability(file),
      provenance,
    });
    result.sources.push(sourceOf(file, "copilot", "instructions", text));
  }

  for (const file of scan.files.filter((path) => path.endsWith(".instructions.md"))) {
    const text = readFile(fs, root, file);
    if (text === undefined) continue;

    const parsed = parseFrontmatter(file, text);
    result.diagnostics.push(...parsed.diagnostics);

    // Copilot documents applyTo as comma-separated glob patterns.
    const applyTo = globListField(parsed.data, "applyTo");
    const provenance = provenanceOf(file, "copilot", { origin: originFor(text) });

    result.instructions.push({
      id: nodeId("instruction", provenance, slugify(basenameOf(file))),
      title: file,
      body: parsed.body,
      bodyLine: parsed.bodyLine,
      applies: applyTo?.length ? appliesToPaths(applyTo) : hierarchicalApplicability(file),
      provenance,
    });
    result.sources.push(sourceOf(file, "copilot", "path-instructions", text));
  }

  return result;
}

// ─── Import resolution ─────────────────────────────────────────────────────

/**
 * Reports imports that point at a file which is not in the repository.
 *
 * Only repository-relative imports are checked. An import that resolves outside
 * the working directory, or into a home directory, is a documented and
 * deliberate pattern — agentfile has no business asserting whether it exists on
 * someone else's machine.
 */
export function checkInstructionImports(
  root: string,
  instructions: readonly Instruction[],
  fs: FileSystem,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const instruction of instructions) {
    for (const target of instruction.imports ?? []) {
      if (target.startsWith("~") || target.startsWith("/")) continue;

      const importingDirectory = governedDirectory(instruction.provenance.file);
      const candidates = [
        normalizePath(target),
        normalizePath(importingDirectory ? `${importingDirectory}/${target}` : target),
      ];

      if (candidates.some((candidate) => fs.exists(join(root, candidate)))) continue;

      diagnostics.push({
        code: "AGF004",
        severity: "error",
        message: `${instruction.provenance.file} imports ${target}, which does not exist`,
        explanation:
          "An import is expanded into context at load time. A missing target means the instructions " +
          "the file promises are simply absent, with no error from the agent.",
        suggestion: `Create ${target}, or remove the import.`,
        location: { file: instruction.provenance.file, line: instruction.provenance.line },
        data: { reference: target, field: "import" },
      });
    }
  }

  return diagnostics;
}
