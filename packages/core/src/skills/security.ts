/**
 * Static inspection of files bundled with a skill.
 *
 * Two rules govern everything here, both from the rework brief:
 *
 *   1. **Nothing is executed.** A script is read as text and matched against
 *      patterns. No shell is spawned, no interpreter is invoked, no file is made
 *      executable. That holds even when the whole point of the file is to be
 *      run.
 *   2. **Risk is described, safety is never claimed.** A clean result means "no
 *      pattern in this list matched", which is a much weaker statement than
 *      "this script is safe", and the wording says so. Pattern matching cannot
 *      see intent, cannot follow a variable, and cannot read a binary.
 *
 * Every pattern carries a name and a reason, so a finding can be argued with on
 * its merits rather than accepted because a tool said so.
 */

import { join } from "node:path";
import { type Diagnostic, diagnostic } from "../diagnostics/index.js";
import type { FileSystem } from "../fs/index.js";
import type { AgentConfiguration, SkillEntry } from "../ir/index.js";
import { basenameOf } from "../paths/index.js";
import { type RiskMatch, scanText } from "../security/patterns.js";

/**
 * Largest file worth reading.
 *
 * A bundled asset can be arbitrarily large, and reading a megabyte of minified
 * output to grep it is a cost with no matching benefit. Skips are reported, not
 * silent.
 */
export const MAX_INSPECTED_BYTES = 256 * 1024;

/** Extensions treated as executable content regardless of which directory they sit in. */
const SCRIPT_EXTENSIONS = [".sh", ".bash", ".zsh", ".fish", ".ps1", ".py", ".rb", ".pl", ".js", ".mjs", ".cjs", ".ts"];

/** Findings a single file reports before the rest are summarised. */
const MATCHES_PER_FILE = 3;

function isScript(path: string, kind: string): boolean {
  if (kind === "script") return true;
  const lowered = path.toLowerCase();
  return SCRIPT_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}

export interface SkillSecurityOptions {
  /** Absolute project root. */
  root: string;
  fs: FileSystem;
  /** Largest file to read. Defaults to `MAX_INSPECTED_BYTES`. */
  maxBytes?: number;
}

export interface SkillSecurityResult {
  diagnostics: Diagnostic[];
  /** Files inspected, so a report can say what the clean result covers. */
  inspected: string[];
  /** Files not inspected, with the reason. Never silent. */
  skipped: Array<{ file: string; reason: string }>;
}

function inspectFile(skill: SkillEntry, relativePath: string, text: string): Diagnostic[] {
  const matches = scanText(text);
  if (!matches.length) return [];

  // One diagnostic per pattern per file: three lines using `sudo` is one
  // observation about the file, not three findings.
  const byPattern = new Map<string, RiskMatch[]>();
  for (const match of matches) {
    const group = byPattern.get(match.pattern.id);
    if (group) group.push(match);
    else byPattern.set(match.pattern.id, [match]);
  }

  const skillLabel = skill.name || basenameOf(skill.provenance.file);

  return [...byPattern.values()].map((group) => {
    const { pattern } = group[0];
    const quoted = group.slice(0, MATCHES_PER_FILE);
    const remaining = group.length - quoted.length;

    return diagnostic({
      code: "AGF501",
      severity: pattern.severity,
      message: `Skill "${skillLabel}": ${relativePath} ${pattern.title}`,
      explanation: [
        pattern.why,
        "",
        ...quoted.map((match) => `  line ${match.line}: ${match.text}`),
        ...(remaining > 0 ? [`  …and ${remaining} more occurrence${remaining === 1 ? "" : "s"}`] : []),
        "",
        "This is a pattern match on the file's text. Nothing was executed to produce it,",
        "and it cannot see intent — confirm what the script does before acting on this.",
      ].join("\n"),
      suggestion:
        pattern.severity === "info"
          ? "No action needed unless the destinations are unexpected."
          : "Read the script and confirm this is intended. If it is, a comment saying why saves the next reader the same work.",
      location: { file: relativePath, line: group[0].line },
      data: {
        skill: skillLabel,
        risk: pattern.id,
        occurrences: group.length,
        analysis: "static-pattern-match",
      },
    });
  });
}

/**
 * Inspects the scripts bundled with every skill.
 *
 * Reads files. Executes nothing.
 */
export function inspectSkillResources(
  configuration: AgentConfiguration,
  options: SkillSecurityOptions,
): SkillSecurityResult {
  const maxBytes = options.maxBytes ?? MAX_INSPECTED_BYTES;
  const result: SkillSecurityResult = { diagnostics: [], inspected: [], skipped: [] };

  for (const skill of configuration.skills) {
    if (!skill.directory) continue;

    for (const resource of skill.resources) {
      const relativePath = `${skill.directory}/${resource.path}`;

      if (!isScript(resource.path, resource.kind)) {
        result.skipped.push({ file: relativePath, reason: "not executable content" });
        continue;
      }

      let text: string;
      try {
        text = options.fs.readFile(join(options.root, relativePath));
      } catch {
        result.skipped.push({ file: relativePath, reason: "could not be read" });
        continue;
      }

      if (text.length > maxBytes) {
        result.skipped.push({
          file: relativePath,
          reason: `larger than the ${Math.round(maxBytes / 1024)} KB inspection limit`,
        });
        continue;
      }

      result.inspected.push(relativePath);
      result.diagnostics.push(...inspectFile(skill, relativePath, text));
    }
  }

  return result;
}
