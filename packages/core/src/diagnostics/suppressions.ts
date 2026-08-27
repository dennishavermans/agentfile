/**
 * Suppression directives.
 *
 * A linter without a way to say "this one is deliberate" is a linter that gets
 * removed from the pre-commit hook. Every mature tool has this — ESLint's
 * `eslint-disable-next-line`, Ruff's `# noqa` — and the shape they converged on
 * is the shape used here: a comment on the line above, or a file-level comment,
 * naming the codes it silences.
 *
 * Two rules make the mechanism honest rather than a way to hide findings:
 *
 *   • A directive that silences nothing is reported (AGF005). A suppression left
 *     behind after the problem was fixed is a lie about what the file contains,
 *     and stale suppressions are how a suppression file becomes a graveyard.
 *   • Suppressed findings are counted and kept, not dropped. `--format json`
 *     carries them with the directive that silenced them, so a reviewer can ask
 *     what a repository is choosing not to see.
 *
 * The comment syntax varies because the files do. Instruction files are markdown
 * (HTML comments), settings are JSON with comments in practice, and rule files
 * are YAML (`#`). All three forms are accepted everywhere rather than guessed
 * per extension: a directive that silently does not apply because the author
 * picked the wrong comment style is the worst possible outcome.
 */

import { join } from "node:path";
import type { FileSystem } from "../fs/index.js";
import { allDiagnosticCodes, type DiagnosticCode } from "./codes.js";
import { type Diagnostic, diagnostic } from "./types.js";

/** Silences every code, rather than a named list. */
export const ALL_CODES = "*" as const;

export type SuppressedCodes = readonly (DiagnosticCode | typeof ALL_CODES)[];

/** How far a directive reaches. */
export type SuppressionScope =
  /** The rest of the file, from wherever the directive sits. */
  | "file"
  /** The line the directive is on. */
  | "line"
  /** The line after the directive. */
  | "next-line";

export interface SuppressionDirective {
  scope: SuppressionScope;
  codes: SuppressedCodes;
  /** Free text after the code list. Optional, and never interpreted. */
  reason?: string;
  /** 1-based line the directive itself is written on. */
  line: number;
  /** The line this directive governs. Absent for file scope. */
  targetLine?: number;
}

export interface SuppressedDiagnostic {
  diagnostic: Diagnostic;
  directive: SuppressionDirective;
  /** Project-relative file the directive was read from. */
  file: string;
}

export interface SuppressionResult {
  /** Diagnostics that survived, in the order they arrived. */
  diagnostics: Diagnostic[];
  /** Diagnostics a directive silenced, with the directive responsible. */
  suppressed: SuppressedDiagnostic[];
  /** AGF005 findings for directives that silenced nothing. */
  unused: Diagnostic[];
}

/**
 * Matches a directive in any of the three comment styles.
 *
 * The `agentfile-` prefix is required so the token cannot collide with prose,
 * and the trailing text is captured loosely because it is a human reason, not
 * syntax.
 */
const DIRECTIVE = /(?:<!--|#|\/\/)\s*agentfile-disable(-next-line|-line|-file)?\b([^\n]*)/;

/** Strips the HTML comment terminator so it does not end up inside a reason. */
function withoutCommentEnd(text: string): string {
  return text.replace(/-->\s*$/, "").trim();
}

const CODE_TOKEN = /^(AGF\d{3}|\*)$/;

/**
 * Splits the text after the directive keyword into codes and a reason.
 *
 * Tokens are read as codes until one is not a code; everything from there is the
 * reason. A leading `--` or `:` separator is accepted and dropped, because both
 * read naturally and neither is worth failing over.
 */
function parseCodesAndReason(rest: string): { codes: SuppressedCodes; reason?: string } {
  const cleaned = withoutCommentEnd(rest);
  if (!cleaned) return { codes: [ALL_CODES] };

  const tokens = cleaned.split(/[\s,]+/).filter(Boolean);
  const codes: (DiagnosticCode | typeof ALL_CODES)[] = [];

  let index = 0;
  for (; index < tokens.length; index++) {
    const token = tokens[index];
    if (!CODE_TOKEN.test(token)) break;
    codes.push(token as DiagnosticCode | typeof ALL_CODES);
  }

  const remainder = tokens
    .slice(index)
    .join(" ")
    .replace(/^(--|:)\s*/, "")
    .trim();

  return {
    // No codes named means the author meant all of them, matching ESLint's bare
    // `eslint-disable-next-line`.
    codes: codes.length ? codes : [ALL_CODES],
    reason: remainder || undefined,
  };
}

/** Reads every suppression directive in one file's text. */
export function parseSuppressions(text: string): SuppressionDirective[] {
  const directives: SuppressionDirective[] = [];
  const lines = text.split("\n");

  for (let index = 0; index < lines.length; index++) {
    const match = DIRECTIVE.exec(lines[index]);
    if (!match) continue;

    const line = index + 1;
    const suffix = match[1];
    const { codes, reason } = parseCodesAndReason(match[2] ?? "");

    if (suffix === "-file" || suffix === undefined) {
      directives.push({ scope: "file", codes, reason, line });
      continue;
    }

    const scope: SuppressionScope = suffix === "-line" ? "line" : "next-line";
    directives.push({
      scope,
      codes,
      reason,
      line,
      targetLine: scope === "line" ? line : line + 1,
    });
  }

  return directives;
}

function silences(directive: SuppressionDirective, code: DiagnosticCode): boolean {
  return directive.codes.some((entry) => entry === ALL_CODES || entry === code);
}

function governs(directive: SuppressionDirective, diagnosticLine: number | undefined): boolean {
  if (directive.scope === "file") return true;
  // A line-scoped directive cannot match a finding that has no line. Reporting
  // it as unused is correct: the author asked to silence a specific line and
  // nothing on that line was found.
  return diagnosticLine !== undefined && directive.targetLine === diagnosticLine;
}

/**
 * Reads directives from every file that could hold one, once each.
 *
 * Files the diagnostics point at are obviously needed. The configuration files
 * that produced no findings are needed too, and for the more important reason:
 * a directive left behind after the problem was fixed sits in a clean file, so
 * scanning only the files with findings would never report the stale
 * suppressions that actually accumulate.
 */
function directivesByFile(
  diagnostics: readonly Diagnostic[],
  root: string,
  fs: FileSystem,
  extraFiles: readonly string[] = [],
): Map<string, SuppressionDirective[]> {
  const byFile = new Map<string, SuppressionDirective[]>();

  const candidates = [...diagnostics.map((item) => item.location?.file), ...extraFiles];

  for (const file of candidates) {
    if (!file || byFile.has(file)) continue;

    const absolute = join(root, file);
    if (!fs.exists(absolute) || fs.isDirectory(absolute)) {
      byFile.set(file, []);
      continue;
    }

    try {
      byFile.set(file, parseSuppressions(fs.readFile(absolute)));
    } catch {
      // An unreadable file suppresses nothing. The rule that produced the
      // finding already read what it needed; failing here would turn a
      // permissions problem into a lost diagnostic.
      byFile.set(file, []);
    }
  }

  return byFile;
}

export interface SuppressionOptions {
  /** Absolute project root the diagnostic paths are relative to. */
  root: string;
  fs: FileSystem;
  /**
   * Additional project-relative files to read directives from, beyond the ones
   * diagnostics point at. Pass the discovered configuration files so stale
   * directives in now-clean files are still reported.
   */
  files?: readonly string[];
  /** Report directives that silenced nothing. Defaults to true. */
  reportUnused?: boolean;
}

/** Renders a directive's codes for a message. */
function describeCodes(codes: SuppressedCodes): string {
  return codes.includes(ALL_CODES) ? "every code" : codes.join(", ");
}

/**
 * Applies suppression directives to a set of diagnostics.
 *
 * Runs after every rule and before `--strict`, so a suppressed warning is never
 * promoted into a build failure.
 */
export function applySuppressions(diagnostics: readonly Diagnostic[], options: SuppressionOptions): SuppressionResult {
  const byFile = directivesByFile(diagnostics, options.root, options.fs, options.files);
  const used = new Set<SuppressionDirective>();

  const kept: Diagnostic[] = [];
  const suppressed: SuppressedDiagnostic[] = [];

  for (const item of diagnostics) {
    const file = item.location?.file;
    const directives = file ? byFile.get(file) : undefined;

    const directive = directives?.find((entry) => silences(entry, item.code) && governs(entry, item.location?.line));

    if (directive && file) {
      used.add(directive);
      suppressed.push({ diagnostic: item, directive, file });
    } else {
      kept.push(item);
    }
  }

  const unused: Diagnostic[] = [];
  if (options.reportUnused !== false) {
    for (const [file, directives] of byFile) {
      for (const directive of directives) {
        if (used.has(directive)) continue;
        unused.push(unusedDirective(file, directive));
      }
    }
  }

  return { diagnostics: kept, suppressed, unused };
}

/** AGF005 for a directive that silenced nothing. */
function unusedDirective(file: string, directive: SuppressionDirective): Diagnostic {
  const codes = describeCodes(directive.codes);

  return diagnostic({
    code: "AGF005",
    message: `Suppression silences nothing: ${codes}`,
    explanation:
      `This directive suppresses ${codes}, and nothing here reported ${
        directive.codes.includes(ALL_CODES) ? "anything" : "those codes"
      }.\n\n` +
      "Either the problem was fixed and the directive outlived it, or the code\n" +
      "named does not match the finding it was meant to silence.",
    suggestion: "Remove the directive, or correct the code it names.",
    location: { file, line: directive.line },
  });
}

/**
 * Every code a directive may legitimately name.
 *
 * Exposed so `--list-rules` and documentation can be generated from the same
 * registry the suppressions are checked against.
 */
export function suppressibleCodes(): DiagnosticCode[] {
  return allDiagnosticCodes();
}
