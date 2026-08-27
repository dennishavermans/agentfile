import { type DiagnosticCode, diagnosticMeta, type Severity } from "./codes.js";

/**
 * A position in a source file. Lines and columns are 1-based, matching editors,
 * tsc, and ESLint. Everything except `file` is optional because some sources
 * (JSON without position tracking, derived configuration) cannot supply a
 * position honestly — and a guessed position is worse than none.
 */
export interface Location {
  /** Path relative to the project root, POSIX separators. */
  file: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

/** A secondary location that explains the primary one (the "other side" of a conflict). */
export interface RelatedLocation {
  location: Location;
  message: string;
}

/**
 * A single finding.
 *
 * Identity (`code`) is separate from prose (`message`) so message wording can be
 * improved without breaking consumers that match on codes — the same reason
 * ESLint separates `messageId` from the rendered message.
 */
export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  /** Single-line, specific, no trailing period. */
  message: string;
  /** Optional multi-line context: what was found and why it matters. */
  explanation?: string;
  /** Optional actionable fix. Imperative mood. */
  suggestion?: string;
  location?: Location;
  related?: RelatedLocation[];
  /** Structured payload for machine consumers. Never used for human formatting. */
  data?: Record<string, string | number | boolean>;
}

export interface DiagnosticInput extends Omit<Diagnostic, "severity"> {
  /** Defaults to the code's registered severity. */
  severity?: Severity;
}

/** Creates a diagnostic, applying the code's default severity when unspecified. */
export function diagnostic(input: DiagnosticInput): Diagnostic {
  return {
    ...input,
    severity: input.severity ?? diagnosticMeta(input.code).defaultSeverity,
  };
}

export interface DiagnosticSummary {
  errors: number;
  warnings: number;
  infos: number;
  total: number;
}

export function summarize(diagnostics: readonly Diagnostic[]): DiagnosticSummary {
  let errors = 0;
  let warnings = 0;
  let infos = 0;

  for (const item of diagnostics) {
    if (item.severity === "error") errors++;
    else if (item.severity === "warning") warnings++;
    else infos++;
  }

  return { errors, warnings, infos, total: diagnostics.length };
}

/** True when any diagnostic is an error. The canonical CI exit-code predicate. */
export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === "error");
}

/**
 * Deterministic ordering for output and snapshot tests:
 * file, then line, then column, then code.
 */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => {
    const fileCompare = (a.location?.file ?? "").localeCompare(b.location?.file ?? "");
    if (fileCompare !== 0) return fileCompare;

    const lineCompare = (a.location?.line ?? 0) - (b.location?.line ?? 0);
    if (lineCompare !== 0) return lineCompare;

    const columnCompare = (a.location?.column ?? 0) - (b.location?.column ?? 0);
    if (columnCompare !== 0) return columnCompare;

    return a.code.localeCompare(b.code);
  });
}
