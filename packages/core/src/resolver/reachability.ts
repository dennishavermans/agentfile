/**
 * Dead configuration.
 *
 * A glob-scoped rule whose patterns match nothing is invisible: it loads no
 * context, changes no behaviour, and produces no error. It just quietly does
 * not exist. That happens for ordinary reasons — a directory was renamed, a
 * pattern has a typo, a rule was written for code that never landed — and
 * nothing else in the toolchain will ever mention it.
 *
 * Detection is a set intersection against the file list the scan already
 * produced, so it costs nothing extra and cannot disagree with the resolver: the
 * same matcher decides both.
 */

import { join } from "node:path";
import { type Diagnostic, diagnostic, type Location } from "../diagnostics/index.js";
import type { FileSystem } from "../fs/index.js";
import type { AgentConfiguration, Applicability, Provenance } from "../ir/index.js";
import { matchesPattern } from "../paths/index.js";

interface Candidate {
  kind: string;
  label: string;
  applies: Applicability;
  provenance: Provenance;
}

function candidates(configuration: AgentConfiguration): Candidate[] {
  const found: Candidate[] = [];

  for (const instruction of configuration.instructions) {
    found.push({
      kind: "instructions",
      label: instruction.title ?? instruction.provenance.file,
      applies: instruction.applies,
      provenance: instruction.provenance,
    });
  }

  for (const skill of configuration.skills) {
    found.push({
      kind: "skill",
      label: skill.name,
      applies: skill.applies,
      provenance: skill.provenance,
    });
  }

  // Derived directives inherit their instruction's applicability, so reporting
  // them too would repeat the same finding once per bullet.
  for (const directive of configuration.directives) {
    if (directive.provenance.origin !== "declared") continue;
    found.push({
      kind: "rule",
      label: directive.text,
      applies: directive.applies,
      provenance: directive.provenance,
    });
  }

  return found;
}

/**
 * The part of a glob before its first wildcard.
 *
 * `proto/**` gives `proto`, `src/api/*.ts` gives `src/api`, and `**\/*.ts`
 * gives nothing. That prefix is a real path, so its existence can be settled
 * with a stat even when the file list cannot settle the glob.
 */
export function literalPrefix(pattern: string): string | undefined {
  const segments: string[] = [];
  for (const segment of pattern.split("/")) {
    if (/[*?[\]{}]/.test(segment)) break;
    segments.push(segment);
  }
  const prefix = segments.join("/");
  return prefix.length ? prefix : undefined;
}

export interface DeadPatternOptions {
  /** Absolute project root and filesystem, used when the file list is incomplete. */
  root?: string;
  fs?: FileSystem;
  /** True when the scan stopped early, so the file list proves nothing absent. */
  truncated?: boolean;
}

/**
 * Patterns in a glob-scoped node that no scanned file matches.
 *
 * A pattern matching nothing in the list is only dead if the list is complete.
 * The scan stops after 20,000 files, and on a repository past that a live
 * pattern looks dead: PostHog's `proto/**` and `tach.toml` were both reported
 * as matching nothing while both were sitting on disk.
 *
 * So when the scan truncated, a pattern is only called dead if its literal
 * prefix is also absent from the disk. A pattern with no literal prefix cannot
 * be settled that way and is left alone rather than guessed at.
 */
export function deadPatterns(
  patterns: readonly string[],
  files: readonly string[],
  options: DeadPatternOptions = {},
): string[] {
  return patterns.filter((pattern) => {
    if (files.some((file) => matchesPattern(file, pattern))) return false;
    if (!options.truncated || !options.fs || options.root === undefined) return true;

    const prefix = literalPrefix(pattern);
    if (prefix === undefined) return false; // nothing checkable; do not accuse
    return !options.fs.exists(join(options.root, prefix));
  });
}

/**
 * Note appended to every AGF303 explanation.
 *
 * The scan skips generated and vendored directories, so a pattern aimed at
 * `dist/` looks dead here. Saying so is cheaper than a developer wondering
 * whether the tool is wrong.
 */
const SCAN_CAVEAT =
  "Reachability is measured against the files in this repository right now, and the scan skips generated and vendored directories. A pattern for code that does not exist yet will show up here.";

export interface ReachabilityOptions {
  /** Project-relative paths of every file the scan found. */
  files: readonly string[];
  /** Absolute project root, so an incomplete scan can be checked against disk. */
  root?: string;
  fs?: FileSystem;
  /** True when the scan stopped early. */
  truncated?: boolean;
}

/** AGF303 findings for glob-scoped configuration that matches nothing. */
export function unreachableDiagnostics(configuration: AgentConfiguration, options: ReachabilityOptions): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const candidate of candidates(configuration)) {
    if (candidate.applies.kind !== "paths") continue;
    const { patterns } = candidate.applies;
    if (!patterns.length) continue;

    const dead = deadPatterns(patterns, options.files, {
      root: options.root,
      fs: options.fs,
      truncated: options.truncated,
    });
    if (!dead.length) continue;

    const location: Location = { file: candidate.provenance.file, line: candidate.provenance.line };
    const allDead = dead.length === patterns.length;

    diagnostics.push(
      diagnostic({
        code: "AGF303",
        message: allDead
          ? `${candidate.kind} "${candidate.label}" never applies: no file matches ${dead.join(", ")}`
          : `${candidate.kind} "${candidate.label}" has ${
              dead.length === 1 ? "a pattern that matches" : `${dead.length} patterns that match`
            } no file: ${dead.join(", ")}`,
        explanation: allDead
          ? `Nothing in the repository matches any of this configuration's patterns, so it is never loaded and never has any effect.\n\n${SCAN_CAVEAT}`
          : `The remaining patterns still match, so this configuration does load — but the dead patterns cover nothing, which usually means a rename or a typo.\n\n${SCAN_CAVEAT}`,
        suggestion: allDead
          ? "Correct the patterns to match the code this is meant to govern, or remove the configuration."
          : `Correct or remove ${dead.length === 1 ? "the dead pattern" : "the dead patterns"}.`,
        location,
        data: {
          kind: candidate.kind,
          label: candidate.label,
          deadPatterns: dead.join(","),
          patterns: patterns.join(","),
        },
      }),
    );
  }

  return diagnostics;
}
