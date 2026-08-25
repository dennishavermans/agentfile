import { diagnosticMeta } from "./codes.js";
import { type Diagnostic, type DiagnosticSummary, sortDiagnostics, summarize } from "./types.js";

/**
 * Version of the JSON report envelope. Bump only for a breaking change to the
 * envelope shape; adding optional fields is not breaking.
 */
export const DIAGNOSTIC_REPORT_VERSION = 1;

export interface DiagnosticReport {
  version: number;
  summary: DiagnosticSummary;
  diagnostics: Array<
    Diagnostic & {
      /** Denormalised registry metadata so consumers need no second lookup. */
      name: string;
      band: string;
    }
  >;
}

/** Stable, machine-readable report. Ordering is deterministic. */
export function buildReport(diagnostics: readonly Diagnostic[]): DiagnosticReport {
  const ordered = sortDiagnostics(diagnostics);

  return {
    version: DIAGNOSTIC_REPORT_VERSION,
    summary: summarize(ordered),
    diagnostics: ordered.map((item) => {
      const meta = diagnosticMeta(item.code);
      return { ...item, name: meta.name, band: meta.band };
    }),
  };
}

export function formatJson(diagnostics: readonly Diagnostic[]): string {
  return `${JSON.stringify(buildReport(diagnostics), null, 2)}\n`;
}
