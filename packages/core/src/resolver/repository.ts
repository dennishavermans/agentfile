/**
 * Repository-wide resolution.
 *
 * The resolver answers one question at a time: what applies at this path. Some
 * findings are only visible across paths — two files declaring the same rule for
 * different subtrees never co-apply anywhere, and duplication that only shows up
 * under `apps/mobile/` is invisible from the root.
 *
 * Resolving every file in the repository would answer it and would also be
 * wasteful: only paths where the set of applicable sources differs can produce a
 * new finding. That set is the root plus one probe inside each directory that
 * carries its own configuration.
 *
 * This lives in core rather than in a command so `doctor`, `check`, and
 * `validate` cannot drift apart on what "repository-wide" means.
 */

import type { Diagnostic } from "../diagnostics/index.js";
import type { AgentConfiguration } from "../ir/index.js";
import { ROOT_PATH } from "../paths/index.js";
import { type ResolveOptions, resolveForPath } from "./resolve.js";

/** Directories that carry configuration of their own, sorted. */
export function configuredDirectories(configuration: AgentConfiguration): string[] {
  const directories = new Set<string>();

  const collect = (applies: AgentConfiguration["instructions"][number]["applies"]): void => {
    if (applies.kind === "directory" && applies.directory !== ROOT_PATH) {
      directories.add(applies.directory);
    }
  };

  for (const instruction of configuration.instructions) collect(instruction.applies);
  for (const directive of configuration.directives) collect(directive.applies);
  for (const skill of configuration.skills) collect(skill.applies);

  return [...directories].sort();
}

/**
 * Paths worth resolving to cover every combination of sources that can co-apply.
 *
 * The probe inside a directory is a name that cannot exist, so it matches
 * directory scopes without accidentally matching a glob aimed at a real file
 * extension.
 */
export function probePaths(configuration: AgentConfiguration): string[] {
  return [ROOT_PATH, ...configuredDirectories(configuration).map((directory) => `${directory}/probe`)];
}

/**
 * Resolution diagnostics for the whole repository, deduplicated.
 *
 * The same duplicate surfaces at every path it reaches, so findings are keyed by
 * code and location and reported once.
 */
export function repositoryResolutionDiagnostics(
  configuration: AgentConfiguration,
  options: ResolveOptions = {},
): Diagnostic[] {
  const seen = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  for (const probe of probePaths(configuration)) {
    for (const item of resolveForPath(configuration, probe, options).diagnostics) {
      const key = `${item.code}:${item.location?.file}:${item.location?.line}:${item.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      diagnostics.push(item);
    }
  }

  return diagnostics;
}
