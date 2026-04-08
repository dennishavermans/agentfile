import * as vscode from "vscode";
import type { parseDocument } from "yaml";

export function issueToDiagnostic(
  issue: string,
  rawYaml: string,
  yamlDoc: ReturnType<typeof parseDocument>,
): vscode.Diagnostic {
  const pathMatch = issue.match(/^([^:]+):\s*(.*)$/);
  const message = pathMatch ? pathMatch[2] : issue;
  const pathText = pathMatch ? pathMatch[1] : "";

  let range = new vscode.Range(0, 0, 0, 1);

  if (pathText) {
    const segments = pathText.split(".").map((part) => {
      const asNumber = Number(part);
      return Number.isNaN(asNumber) ? part : asNumber;
    });

    const node = yamlDoc.getIn(segments, true);
    const nodeRange = node?.rangeAsLinePos;
    if (nodeRange?.start) {
      range = new vscode.Range(
        nodeRange.start.line,
        nodeRange.start.col,
        nodeRange.start.line,
        nodeRange.end?.col ?? nodeRange.start.col + 1,
      );
    }
  }

  if (range.start.line === 0 && rawYaml.length > 0) {
    range = new vscode.Range(0, 0, 0, Math.min(80, rawYaml.split("\n")[0]?.length ?? 1));
  }

  return new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
}

export function findRuleLine(rawYaml: string, category: string, ruleIndex: number): number | null {
  const lines = rawYaml.split("\n");
  let inRules = false;
  let rulesIndent = 0;
  let inCategory = false;
  let categoryIndent = 0;
  let seenRules = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const indent = line.length - line.trimStart().length;

    if (!inRules) {
      if (trimmed === "rules:") {
        inRules = true;
        rulesIndent = indent;
      }
      continue;
    }

    if (indent <= rulesIndent && !trimmed.startsWith("#")) {
      break;
    }

    if (!inCategory) {
      if (trimmed === `${category}:`) {
        inCategory = true;
        categoryIndent = indent;
      }
      continue;
    }

    if (indent <= categoryIndent && !trimmed.startsWith("#")) {
      break;
    }

    if (trimmed.startsWith("- ")) {
      if (seenRules === ruleIndex) {
        return i;
      }
      seenRules += 1;
    }
  }

  return null;
}
