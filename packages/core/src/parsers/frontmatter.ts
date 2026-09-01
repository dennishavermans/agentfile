/**
 * YAML frontmatter parsing for markdown configuration files.
 *
 * Most markdown-based agent formats — SKILL.md, `.claude/rules/*.md`,
 * `.claude/agents/*.md`, Copilot `*.instructions.md` — are "optional YAML
 * frontmatter, then markdown", and `parseFrontmatter` serves all of them.
 * Anthropic documents the subagent block as YAML, so strictness is correct
 * there.
 *
 * Cursor `.mdc` is the exception and has its own reader below. It looks like
 * YAML and is not.
 */

import { type Diagnostic, diagnostic } from "../diagnostics/index.js";
import { splitGlobList } from "../paths/index.js";
import { loadYamlSource } from "../yaml/index.js";

/** Opening and closing fence for a frontmatter block. */
const FENCE = /^---[ \t]*\r?$|^---[ \t]*$/;

export interface ParsedFrontmatter {
  /** Parsed frontmatter mapping, or `undefined` when the file has none. */
  data?: Record<string, unknown>;
  /** Markdown body after the frontmatter (or the whole file when there is none). */
  body: string;
  /** 1-based line the body starts on, for provenance. */
  bodyLine: number;
  /** True when a frontmatter block was present, even if it was empty. */
  hasFrontmatter: boolean;
  diagnostics: Diagnostic[];
}

/**
 * Splits a markdown file into frontmatter and body.
 *
 * Frontmatter is recognised only as a `---` fence on the very first line, which
 * is what every one of these formats specifies. A `---` later in the document is
 * a horizontal rule and is left alone.
 */
export function parseFrontmatter(file: string, text: string): ParsedFrontmatter {
  const lines = text.split("\n");

  const firstLine = lines[0] ?? "";
  if (!FENCE.test(firstLine.trim()) || firstLine.trim() !== "---") {
    return { body: text, bodyLine: 1, hasFrontmatter: false, diagnostics: [] };
  }

  let closingIndex = -1;
  for (let index = 1; index < lines.length; index++) {
    if (lines[index].trim() === "---") {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex === -1) {
    return {
      body: text,
      bodyLine: 1,
      hasFrontmatter: false,
      diagnostics: [
        diagnostic({
          code: "AGF003",
          message: "Frontmatter block is never closed",
          explanation:
            "The file opens with `---` but has no closing `---`, so the frontmatter cannot be read " +
            "and the whole file is treated as body text.",
          suggestion: "Add a closing `---` after the frontmatter fields.",
          location: { file, line: 1, column: 1 },
        }),
      ],
    };
  }

  const frontmatterText = lines.slice(1, closingIndex).join("\n");
  const body = lines.slice(closingIndex + 1).join("\n");
  const bodyLine = closingIndex + 2;

  if (!frontmatterText.trim()) {
    return { data: {}, body, bodyLine, hasFrontmatter: true, diagnostics: [] };
  }

  const source = loadYamlSource(file, frontmatterText);
  if (source.diagnostics.length) {
    // Re-anchor parse positions: they are relative to the frontmatter block,
    // which starts one line below the opening fence.
    return {
      body,
      bodyLine,
      hasFrontmatter: true,
      diagnostics: source.diagnostics.map((item) => ({
        ...item,
        location: item.location ? { ...item.location, line: (item.location.line ?? 1) + 1 } : { file, line: 1 },
      })),
    };
  }

  if (source.value === null || source.value === undefined) {
    return { data: {}, body, bodyLine, hasFrontmatter: true, diagnostics: [] };
  }

  if (typeof source.value !== "object" || Array.isArray(source.value)) {
    return {
      body,
      bodyLine,
      hasFrontmatter: true,
      diagnostics: [
        diagnostic({
          code: "AGF001",
          message: "Frontmatter must be a mapping of fields",
          explanation: `The frontmatter in ${file} parsed as a ${
            Array.isArray(source.value) ? "list" : typeof source.value
          } rather than a set of key/value fields.`,
          suggestion: "Write the frontmatter as `key: value` lines.",
          location: { file, line: 2, column: 1 },
        }),
      ],
    };
  }

  return {
    data: source.value as Record<string, unknown>,
    body,
    bodyLine,
    hasFrontmatter: true,
    diagnostics: [],
  };
}

// ─── Field coercion ────────────────────────────────────────────────────────
// Frontmatter is hand-written, and the platforms accept several spellings for
// the same field. These helpers normalise without inventing meaning.

/** Reads a string field. Returns undefined for absent or non-string values. */
/**
 * Cursor `.mdc` frontmatter, read the way Cursor reads it.
 *
 * Cursor takes the raw text after `key:` as the value. It is not a YAML
 * parser, which is why `globs: *.py` works there, why Cursor's own UI writes
 * globs unquoted and comma-separated, and why every example in its docs is
 * unquoted.
 *
 * Parsing these as YAML was wrong in a way that cost more than it looks. A
 * leading `*` is a YAML alias, so the whole block failed and agentfile lost
 * `description` and `alwaysApply` along with the glob — then reported an error
 * on a file that works. Worse, it advised quoting the value, which is the one
 * edit that stops Cursor matching the pattern at all.
 *
 * The format is flat: `key: value` lines, no nesting, no types beyond
 * `alwaysApply`. Anything a real YAML parser would do to the value — resolving
 * aliases, stripping quotes, coercing numbers — would be a divergence from the
 * only program that reads these files.
 */
export function parseCursorFrontmatter(file: string, text: string): ParsedFrontmatter {
  const lines = text.split("\n");

  if ((lines[0] ?? "").trim() !== "---") {
    return { body: text, bodyLine: 1, hasFrontmatter: false, diagnostics: [] };
  }

  let closingIndex = -1;
  for (let index = 1; index < lines.length; index++) {
    if (lines[index].trim() === "---") {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex === -1) {
    return {
      body: text,
      bodyLine: 1,
      hasFrontmatter: false,
      diagnostics: [
        diagnostic({
          code: "AGF003",
          message: "Frontmatter block is never closed",
          explanation:
            "The file opens with `---` but has no closing `---`, so the frontmatter cannot be read " +
            "and the whole file is treated as body text.",
          suggestion: "Add a closing `---` after the frontmatter fields.",
          location: { file, line: 1, column: 1 },
        }),
      ],
    };
  }

  const data: Record<string, unknown> = {};
  for (let index = 1; index < closingIndex; index++) {
    const match = lines[index].match(/^([A-Za-z_][\w-]*):[ \t]?(.*)$/);
    if (!match) continue;

    const [, key, rest] = match;
    const value = rest.trim();
    // `alwaysApply` is the one field Cursor reads as a boolean. Everything
    // else stays the literal text, quotes and all, because that is what
    // Cursor will try to match with.
    data[key] = key === "alwaysApply" && (value === "true" || value === "false") ? value === "true" : value;
  }

  return {
    data,
    body: lines.slice(closingIndex + 1).join("\n"),
    bodyLine: closingIndex + 2,
    hasFrontmatter: true,
    diagnostics: [],
  };
}

/**
 * Agent-config frontmatter, read the way the programs read it.
 *
 * Anthropic documents these blocks as YAML and documents that "YAML that
 * doesn't parse" means Claude Code "reads no fields from the file, skips it,
 * and writes the parse error to the debug log". Both are true, and together
 * they are misleading: the parser Claude Code actually uses is not a strict
 * one, and almost nothing a person writes by hand fails it.
 *
 * Measured against Claude Code 2.1.238 rather than inferred, once per surface:
 *
 * - Subagents: `description: [unclosed` — rejected by `yaml`, `js-yaml` and
 *   Ruby's Psych alike — loads as a working subagent, its description the
 *   literal string `[unclosed`. So did PostHog's five agent files, which
 *   agentfile 2.0.0 reported at error severity.
 * - Skills: trigger.dev's drizzle skill carries an unquoted description
 *   containing `conventions: `. It loads, and the agent echoes the full
 *   description back verbatim. agentfile 2.1.0 reported it as having none.
 * - Commands: a command whose frontmatter reads
 *   `description: uses: colons, badly: everywhere` is listed with exactly
 *   that description.
 * - `.claude/rules`: a rule with the same un-YAML shape still loads its body.
 *
 * Copilot's `.instructions.md` gets the same reading untested — no Copilot to
 * measure against here — because the failure mode of leniency is a missed
 * finding, and the failure mode of strictness is the PostHog report.
 *
 * The mechanics are the same shape as the Cursor fix: try YAML first, because
 * structured fields (`hooks`, `mcpServers`, `experimental`) are real mappings
 * and a strict parse reads them properly. When that fails, fall back to the
 * flat `key: value` reading rather than declaring the file broken, because
 * that is what the program reading it does.
 */
export function parseAgentFrontmatter(file: string, text: string): ParsedFrontmatter {
  const strict = parseFrontmatter(file, text);

  // An unclosed fence is a real defect in either reading: there is no
  // frontmatter block at all, and the whole file becomes body text.
  const unclosed = strict.diagnostics.some((item) => item.message === "Frontmatter block is never closed");
  if (!strict.diagnostics.length || unclosed) return strict;

  const lenient = parseCursorFrontmatter(file, text);
  return { ...lenient, diagnostics: [] };
}

export function stringField(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === "string" ? value : undefined;
}

/** Reads a boolean field, accepting the string spellings YAML users write. */
export function booleanField(data: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = data?.[key];
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/**
 * Reads a list field that platforms allow as either a YAML list or a
 * comma-separated (or space-separated) string. `paths`, `globs`, `applyTo`,
 * `tools`, and `allowed-tools` are all documented in both forms.
 */
export function listField(
  data: Record<string, unknown> | undefined,
  key: string,
  separators: RegExp = /[,\s]+/,
): string[] | undefined {
  const value = data?.[key];
  if (value === undefined || value === null) return undefined;

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim());
  }

  if (typeof value === "string") {
    const entries = value
      .split(separators)
      .map((entry) => entry.trim())
      .filter(Boolean);
    return entries.length ? entries : undefined;
  }

  return undefined;
}

/**
 * Reads a glob-list field such as `paths`, `globs`, or `applyTo`.
 *
 * Accepts a YAML list or a single comma-separated string, which is how all three
 * fields are documented, and splits the string without breaking brace groups.
 */
export function globListField(data: Record<string, unknown> | undefined, key: string): string[] | undefined {
  const value = data?.[key];
  if (value === undefined || value === null) return undefined;

  if (Array.isArray(value)) {
    const entries = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return entries.length ? entries : undefined;
  }

  if (typeof value === "string") {
    const entries = splitGlobList(value);
    return entries.length ? entries : undefined;
  }

  return undefined;
}

/** Reads a string-to-string map field, ignoring non-string values. */
export function mapField(data: Record<string, unknown> | undefined, key: string): Record<string, string> | undefined {
  const value = data?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const result: Record<string, string> = {};
  for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entryValue === "string") result[entryKey] = entryValue;
    else if (typeof entryValue === "number" || typeof entryValue === "boolean") result[entryKey] = String(entryValue);
  }

  return Object.keys(result).length ? result : undefined;
}

/** Frontmatter keys that are not in `known`, preserved for portability analysis. */
export function extraFields(
  data: Record<string, unknown> | undefined,
  known: readonly string[],
): Record<string, unknown> | undefined {
  if (!data) return undefined;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!known.includes(key)) result[key] = value;
  }

  return Object.keys(result).length ? result : undefined;
}
