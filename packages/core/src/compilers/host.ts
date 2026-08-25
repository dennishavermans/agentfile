/// <reference types="node" />

/**
 * The compiler host.
 *
 * Compilers plan; the host decides what happens to the plan. Everything with a
 * side effect or a safety judgement lives here, once:
 *
 *   • the generated-file marker, so every output is machine-detectable
 *   • drift detection, so `--check` can gate CI without writing
 *   • the overwrite rule: a file agentfile does not own is never replaced.
 *     Ownership is the marker in the file, the manifest entry, or an explicit
 *     `force` — a hand-written CLAUDE.md is someone's work, not drift.
 *
 * Planning is pure and runs on the `FileSystem` port; only `applyCompilation`
 * touches the real disk, and only with a plan whose actions were already
 * decided.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TargetId } from "../capabilities/index.js";
import { type Diagnostic, diagnostic } from "../diagnostics/index.js";
import type { FileSystem } from "../fs/index.js";
import type { AgentConfiguration } from "../ir/index.js";
import { addMarker, hasGeneratedMarker } from "../manifest.js";
import { COMPILE_TARGETS, compilerFor } from "./targets.js";
import type { CompilePlan } from "./types.js";

/** What would happen to one output file, decided at plan time. */
export type FileAction =
  /** The file does not exist yet. */
  | "create"
  /** The file exists, agentfile owns it, and the content changed. */
  | "update"
  /** The file exists with exactly this content. */
  | "unchanged"
  /** The file exists, agentfile does not own it, and force was not given. */
  | "refused";

export interface CompiledFile {
  /** Project-relative path. */
  path: string;
  /** Final bytes, generated-file marker included. */
  content: string;
  /** Manifest source label, e.g. "claude". */
  source: string;
  target: TargetId;
  action: FileAction;
}

export interface CompilationPlan {
  /** Per-target plans: fidelity diagnostics and what was not carried. */
  targets: CompilePlan[];
  /** Every output file with its decided action, sorted by path. */
  files: CompiledFile[];
  /** Plan-level findings: currently only AGF204 overwrite refusals. */
  diagnostics: Diagnostic[];
}

export interface PlanOptions {
  /** Absolute project root. */
  root: string;
  fs: FileSystem;
  /** Target ids, each one of `COMPILE_TARGETS`. */
  targets: readonly string[];
  /** Paths the manifest records as owned — safe to overwrite. */
  owned?: ReadonlySet<string>;
  /** Overwrite files agentfile does not own. Off by default, loudly. */
  force?: boolean;
}

/**
 * Plans a compilation: runs every requested compiler, applies markers, and
 * decides per file whether it would be created, updated, left alone, or
 * refused. Reads the filesystem; writes nothing.
 */
export function planCompilation(configuration: AgentConfiguration, options: PlanOptions): CompilationPlan {
  const owned = options.owned ?? new Set<string>();
  const targets: CompilePlan[] = [];
  const files: CompiledFile[] = [];
  const diagnostics: Diagnostic[] = [];
  const claimed = new Map<string, { target: TargetId; content: string }>();

  for (const id of options.targets) {
    const compiler = compilerFor(id);
    if (!compiler) {
      throw new Error(`Unknown compile target "${id}". Implemented targets: ${COMPILE_TARGETS.join(", ")}.`);
    }

    const plan = compiler.compile(configuration);
    targets.push(plan);

    for (const planned of plan.files) {
      const content = addMarker(planned.path, planned.content);

      // Target output paths are disjoint by design (AGENTS.md, CLAUDE.md,
      // .github/, .cursor/). Two targets claiming one path with different
      // content is a compiler bug, not a user problem — fail loudly.
      const existing = claimed.get(planned.path);
      if (existing) {
        if (existing.content !== content) {
          throw new Error(
            `Compilers for "${existing.target}" and "${plan.target}" both plan ${planned.path} with different content. This is a bug in agentfile.`,
          );
        }
        continue;
      }
      claimed.set(planned.path, { target: plan.target, content });

      files.push({
        path: planned.path,
        content,
        source: planned.source,
        target: plan.target,
        action: decideAction(planned.path, content, options, owned),
      });
    }
  }

  for (const file of files) {
    if (file.action !== "refused") continue;
    diagnostics.push(
      diagnostic({
        code: "AGF204",
        message: `Compiling ${file.target} would overwrite ${file.path}, which agentfile does not own`,
        explanation: [
          "The file exists, carries no generated-by-agentfile marker, and is not recorded",
          "in the manifest. That is what a hand-written file looks like, and a compiler",
          "must not replace someone's work silently.",
        ].join("\n"),
        suggestion: `Move the hand-written content into a source agentfile compiles from, or run with --force to overwrite ${file.path} deliberately.`,
        location: { file: file.path },
        data: { target: String(file.target), path: file.path },
      }),
    );
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { targets, files, diagnostics };
}

function decideAction(
  path: string,
  content: string,
  options: PlanOptions,
  owned: ReadonlySet<string>,
): FileAction {
  const absolute = join(options.root, path);
  if (!options.fs.exists(absolute)) return "create";

  let current: string;
  try {
    current = options.fs.readFile(absolute);
  } catch {
    return options.force ? "update" : "refused";
  }

  if (current === content) return "unchanged";
  if (options.force || owned.has(path) || hasGeneratedMarker(current)) return "update";
  return "refused";
}

/** Paths whose planned content differs from disk — what `--check` reports. */
export function driftedFiles(plan: CompilationPlan): CompiledFile[] {
  return plan.files.filter((file) => file.action === "create" || file.action === "update");
}

/**
 * Writes every planned create and update. Refused and unchanged files are not
 * touched. Returns the written paths, for reporting and the manifest.
 */
export function applyCompilation(plan: CompilationPlan, root: string): string[] {
  const written: string[] = [];

  for (const file of driftedFiles(plan)) {
    const absolute = join(root, file.path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, file.content, "utf-8");
    written.push(file.path);
  }

  return written;
}
