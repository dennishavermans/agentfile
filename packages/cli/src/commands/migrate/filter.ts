import type { MigrateReportEntry } from "./types.js";

export function detectIDE(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  if (lower.includes("copilot") || lower.includes(".github")) return "copilot";
  if (lower.includes("claude") || lower.includes("claude.md")) return "claude";
  if (lower.includes("cursor") || lower.includes(".cursor")) return "cursor";
  return null;
}

export function filterSourcesByTarget(
  sourcePaths: string[],
  root: string,
  targets?: string[],
  exclude?: string[],
): { filteredSources: string[]; report: MigrateReportEntry[] } {
  const filteredSources: string[] = [];
  const report: MigrateReportEntry[] = [];

  for (const absolutePath of sourcePaths) {
    const ide = detectIDE(absolutePath);
    const relativePath = absolutePath.replace(root + "/", "");

    if (targets?.length && ide && !targets.includes(ide)) {
      report.push({
        path: relativePath,
        classification: "skipped",
        reason: `IDE "${ide}" not in --targets (${targets.join(", ")})`,
      });
      continue;
    }

    if (exclude?.length && ide && exclude.includes(ide)) {
      report.push({
        path: relativePath,
        classification: "skipped",
        reason: `IDE "${ide}" excluded via --exclude`,
      });
      continue;
    }

    filteredSources.push(absolutePath);
    report.push({
      path: relativePath,
      classification: "imported",
      reason: "Content parsed and merged into contract",
    });
  }

  return { filteredSources, report };
}
