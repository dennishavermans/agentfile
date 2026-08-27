/**
 * Reading `agentfile.yaml`.
 *
 * A malformed settings file must never be a silent partial success. Either the
 * file parses and validates and its values are used, or it does not and the run
 * reports why and uses nothing from it — a half-applied configuration is worse
 * than none, because the half that applied looks like the whole.
 */

import { join } from "node:path";
import type { Diagnostic } from "../diagnostics/index.js";
import { diagnostic } from "../diagnostics/index.js";
import type { FileSystem } from "../fs/index.js";
import { loadYamlSource, schemaIssuesToDiagnostics } from "../yaml/index.js";
import { type AgentfileConfig, AgentfileConfigSchema, CONFIG_FILE, EMPTY_CONFIG } from "./schema.js";

export interface LoadedConfig {
  /** Validated settings. Empty when there is no file, or the file was rejected. */
  config: AgentfileConfig;
  /** True when a file was found, whether or not it validated. */
  present: boolean;
  /** Parse and schema findings. Non-empty means nothing from the file was used. */
  diagnostics: Diagnostic[];
}

/** Reads and validates the repository's `agentfile.yaml`, if it has one. */
export function loadConfig(root: string, fs: FileSystem): LoadedConfig {
  const absolute = join(root, CONFIG_FILE);
  if (!fs.exists(absolute)) return { config: EMPTY_CONFIG, present: false, diagnostics: [] };

  let text: string;
  try {
    text = fs.readFile(absolute);
  } catch {
    return {
      config: EMPTY_CONFIG,
      present: true,
      diagnostics: [
        diagnostic({
          code: "AGF003",
          message: `${CONFIG_FILE} could not be read`,
          explanation: "The file exists but could not be opened, so none of its settings were applied.",
          suggestion: "Check the file's permissions.",
          location: { file: CONFIG_FILE },
        }),
      ],
    };
  }

  const source = loadYamlSource(CONFIG_FILE, text);
  if (source.diagnostics.length) {
    return { config: EMPTY_CONFIG, present: true, diagnostics: source.diagnostics };
  }

  // An empty file is a file, not a syntax error, and means "no overrides".
  if (source.value === null || source.value === undefined) {
    return { config: EMPTY_CONFIG, present: true, diagnostics: [] };
  }

  const parsed = AgentfileConfigSchema.safeParse(source.value);
  if (!parsed.success) {
    return { config: EMPTY_CONFIG, present: true, diagnostics: schemaIssuesToDiagnostics(source, parsed.error) };
  }

  return { config: parsed.data, present: true, diagnostics: [] };
}

/**
 * Applies configured severities to a set of findings.
 *
 * `off` removes the finding. Everything else replaces its severity, which is
 * how a team decides that duplication is informational here, or that a security
 * pattern is a hard failure. Applied before `--strict`, so a code set to
 * `warning` is still promoted by strict mode and a code set to `off` is gone
 * before promotion can reach it.
 */
export function applyConfiguredSeverity(
  diagnostics: readonly Diagnostic[],
  severity: AgentfileConfig["severity"],
): Diagnostic[] {
  if (!severity) return [...diagnostics];

  const result: Diagnostic[] = [];
  for (const item of diagnostics) {
    const configured = severity[item.code];
    if (configured === undefined) {
      result.push(item);
      continue;
    }
    if (configured === "off") continue;
    result.push({ ...item, severity: configured });
  }

  return result;
}
