/**
 * Validation rules.
 *
 * The three commands the rework brief asks for — `check`, `validate`, `lint` —
 * are not three implementations. They are three selections over one rule set,
 * which is what stops them from disagreeing about whether something is a
 * problem. ESLint's flat config works the same way, and for the same reason.
 *
 * A rule owns identity (`id`), a layer, and the codes it can emit. It does not
 * own its own discovery, its own resolver, or its own file access: everything it
 * needs arrives in the context, so a rule is a pure function of the
 * configuration and cannot introduce a second answer to a question core already
 * answers.
 */

import type { TargetId } from "../capabilities/index.js";
import type { Diagnostic, DiagnosticCode } from "../diagnostics/index.js";
import type { FileSystem } from "../fs/index.js";
import type { AgentConfiguration } from "../ir/index.js";

/**
 * Validation layers, from the rework brief's own separation of responsibility.
 *
 * `behavioral` is declared here and carries no rules yet. Naming it now keeps the
 * command surface stable when it lands, and makes it visible that `validate` does
 * not check it — a layer that silently does not exist is worse than one that
 * reports itself as empty.
 */
export type ValidationLayer = "structural" | "resolution" | "quality" | "compatibility" | "security" | "behavioral";

/** Layers that have rules today. */
export const IMPLEMENTED_LAYERS: readonly ValidationLayer[] = [
  "structural",
  "resolution",
  "quality",
  "compatibility",
  "security",
];

/**
 * Layers `agentfile check` runs.
 *
 * Structural and resolution only: both are set operations over data already in
 * memory, which is what keeps `check` inside a pre-commit budget. Quality
 * analysis compares text pairwise and belongs in `lint`.
 */
export const CHECK_LAYERS: readonly ValidationLayer[] = ["structural", "resolution"];

/** Layers `agentfile lint` runs. */
export const LINT_LAYERS: readonly ValidationLayer[] = ["quality"];

export interface RuleContext {
  configuration: AgentConfiguration;
  /** Absolute project root. */
  root: string;
  /**
   * Filesystem access.
   *
   * Almost every rule is a pure function of the configuration, which is what
   * keeps them cheap and trivially testable. Static security inspection is the
   * exception: it has to read files discovery deliberately did not load, because
   * a bundled script's contents have no business in the IR. Access is here
   * rather than smuggled in through a module import, so which rules touch the
   * disk is visible.
   */
  fs: FileSystem;
  /** Findings produced while reading the configuration, before any rule ran. */
  discoveryDiagnostics: readonly Diagnostic[];
  /** Project-relative paths of every scanned file. */
  files: readonly string[];
  /** Targets to check compatibility against. Empty means the caller named none. */
  targets: readonly TargetId[];
  /** Always-loaded context budget in estimated tokens, when overridden. */
  budgetTokens?: number;
  /** Similarity threshold for near-duplicate detection, when overridden. */
  similarityThreshold?: number;
}

/** Why a selected rule produced nothing, when the reason is not "no problems". */
export interface RuleSkip {
  rule: string;
  reason: string;
}

export interface RuleResult {
  diagnostics: Diagnostic[];
  /** Set when the rule could not do its work, rather than finding nothing. */
  skipped?: string;
}

export interface Rule {
  /** Stable, kebab-case, selectable on the command line. */
  id: string;
  layer: ValidationLayer;
  /** One line, shown by `--list-rules`. */
  description: string;
  /** Codes this rule can emit. Cross-checked against the registry by test. */
  emits: readonly DiagnosticCode[];
  run(context: RuleContext): RuleResult;
}
