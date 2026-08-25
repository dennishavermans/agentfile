/**
 * Position-aware YAML loading.
 *
 * The v1 loader flattens validation failures into pre-formatted strings, which
 * means every consumer that wants to point at the offending line has to take
 * the string back apart and re-scan the file. Core owns positions instead: parse
 * once, keep the document, and map a schema issue's path to a real line and
 * column.
 *
 * Positions are 1-based, matching editors, `tsc`, and ESLint.
 */

import { LineCounter, parseDocument } from "yaml";
import type { ZodError, ZodIssue } from "zod";
import { type Diagnostic, diagnostic, type Location } from "../diagnostics/index.js";

export interface YamlSource {
  /** Project-relative path, used for diagnostic locations. */
  file: string;
  /** Raw text, kept so callers can render an excerpt. */
  text: string;
  /** Parsed value, or `undefined` when the document failed to parse. */
  value: unknown;
  /** Parse errors, already mapped to located diagnostics. */
  diagnostics: Diagnostic[];
  /** Resolves a value path to a location. Returns `undefined` when unknown. */
  locate(path: ReadonlyArray<string | number>): Location | undefined;
}

/**
 * Parses YAML while retaining positions.
 *
 * Note on the `yaml` API: `Node.rangeAsLinePos` is only populated in some
 * configurations, so this uses the always-present character offsets in
 * `Node.range` and converts them with an explicit `LineCounter`. That is
 * version-robust and needs no feature detection.
 */
export function loadYamlSource(file: string, text: string): YamlSource {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter, keepSourceTokens: false });

  const locate = (path: ReadonlyArray<string | number>): Location | undefined => {
    if (!path.length) return { file, line: 1, column: 1 };

    // Walk from the most specific path towards the root: if `rules.coding.7`
    // does not exist because the list is short, `rules.coding` still points the
    // developer at the right place.
    for (let length = path.length; length > 0; length--) {
      const node = document.getIn(path.slice(0, length) as Array<string | number>, true) as
        | { range?: [number, number, number] }
        | undefined;

      const range = node?.range;
      if (!range) continue;

      const start = lineCounter.linePos(range[0]);
      const end = lineCounter.linePos(range[1]);

      return {
        file,
        line: start.line,
        column: start.col,
        endLine: end.line,
        endColumn: end.col,
      };
    }

    return { file, line: 1, column: 1 };
  };

  const diagnostics: Diagnostic[] = document.errors.map((error) => {
    const start = lineCounter.linePos(error.pos[0]);
    return diagnostic({
      code: "AGF003",
      message: error.message,
      explanation: "The file is not valid YAML, so none of its configuration could be read.",
      suggestion: "Fix the YAML syntax and run the command again.",
      location: { file, line: start.line, column: start.col },
      data: { name: error.name },
    });
  });

  return {
    file,
    text,
    value: diagnostics.length ? undefined : document.toJS(),
    diagnostics,
    locate,
  };
}

/** Renders a Zod issue path the way a developer writes it: `rules.coding.2`. */
export function formatIssuePath(path: ReadonlyArray<string | number | symbol>): string {
  return path.map((segment) => String(segment)).join(".");
}

/**
 * Maps schema validation issues onto located diagnostics.
 *
 * Identity stays in the code (AGF001) and the structured `data`, so tooling can
 * match on the path without parsing prose — which is precisely what the string
 * formatting in the v1 loader forced consumers to do.
 */
export function schemaIssuesToDiagnostics(source: YamlSource, error: ZodError): Diagnostic[] {
  return error.issues.map((issue: ZodIssue) => {
    const path = formatIssuePath(issue.path);
    const location = source.locate(issue.path as ReadonlyArray<string | number>);

    return diagnostic({
      code: "AGF001",
      message: path ? `${path}: ${issue.message}` : issue.message,
      explanation: path
        ? `The value at \`${path}\` in ${source.file} does not satisfy the schema.`
        : `${source.file} does not satisfy the schema.`,
      location,
      data: { path, issue: issue.code },
    });
  });
}
