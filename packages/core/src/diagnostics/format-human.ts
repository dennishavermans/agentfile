import { diagnosticMeta } from "./codes.js";
import { type Diagnostic, type Location, sortDiagnostics, summarize } from "./types.js";

export interface HumanFormatOptions {
  /** Include the code in the heading. Default true. */
  showCodes?: boolean;
  /** Trailing summary line. Default true. */
  showSummary?: boolean;
}

const SEVERITY_LABEL = {
  error: "error",
  warning: "warning",
  info: "info",
} as const;

function formatLocation(location: Location): string {
  if (location.line === undefined) return location.file;
  if (location.column === undefined) return `${location.file}:${location.line}`;
  return `${location.file}:${location.line}:${location.column}`;
}

function indent(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => (line.length ? prefix + line : line))
    .join("\n");
}

/**
 * Human-readable output.
 *
 * The shape follows the rework brief: a titled finding, the explanation, every
 * source location involved, then the suggested fix. Opaque single-line output
 * such as `ERROR AGF301` is explicitly what this avoids.
 */
export function formatHuman(diagnostics: readonly Diagnostic[], options: HumanFormatOptions = {}): string {
  const showCodes = options.showCodes ?? true;
  const showSummary = options.showSummary ?? true;
  const ordered = sortDiagnostics(diagnostics);
  const blocks: string[] = [];

  for (const item of ordered) {
    const meta = diagnosticMeta(item.code);
    const label = SEVERITY_LABEL[item.severity];
    const heading = showCodes ? `${label} ${item.code}: ${item.message}` : `${label}: ${item.message}`;

    const lines: string[] = [heading];

    if (item.explanation) {
      lines.push("", indent(item.explanation));
    }

    const sources: Location[] = [];
    if (item.location) sources.push(item.location);
    for (const related of item.related ?? []) sources.push(related.location);

    if (sources.length) {
      lines.push("", "  Source:");
      if (item.location) {
        lines.push(`    ${formatLocation(item.location)}`);
      }
      for (const related of item.related ?? []) {
        lines.push(`    ${formatLocation(related.location)} — ${related.message}`);
      }
    }

    if (item.suggestion) {
      lines.push("", "  Suggested fix:", indent(item.suggestion, "    "));
    }

    // Keep the band discoverable without cluttering the heading.
    if (showCodes) {
      lines.push("", `  (${meta.band} · ${meta.name})`);
    }

    blocks.push(lines.join("\n"));
  }

  if (!showSummary) return blocks.join("\n\n");

  const counts = summarize(ordered);
  const summary =
    counts.total === 0
      ? "No problems found."
      : `${counts.total} problem${counts.total === 1 ? "" : "s"} ` +
        `(${counts.errors} error${counts.errors === 1 ? "" : "s"}, ` +
        `${counts.warnings} warning${counts.warnings === 1 ? "" : "s"}, ` +
        `${counts.infos} info)`;

  return blocks.length ? `${blocks.join("\n\n")}\n\n${summary}` : summary;
}
