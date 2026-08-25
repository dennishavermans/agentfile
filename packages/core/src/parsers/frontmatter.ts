/**
 * YAML frontmatter parsing for markdown configuration files.
 *
 * Every markdown-based agent format in use — SKILL.md, `.claude/rules/*.md`,
 * `.claude/agents/*.md`, Cursor `.mdc`, Copilot `*.instructions.md` — is
 * "optional YAML frontmatter, then markdown". One parser serves all of them.
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
