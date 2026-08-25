/**
 * Running validation.
 *
 * One entry point for every command that reports findings. Selection is by layer
 * or by explicit rule id; nothing else about the run differs between `check`,
 * `validate`, and `lint`.
 */

import type { TargetId } from "../capabilities/index.js";
import { type Diagnostic, type DiagnosticSummary, sortDiagnostics, summarize } from "../diagnostics/index.js";
import { type DiscoveryResult, discover } from "../discovery/index.js";
import { type FileSystem, nodeFileSystem } from "../fs/index.js";
import { findRule, RULES } from "./rules.js";
import { IMPLEMENTED_LAYERS, type Rule, type RuleSkip, type ValidationLayer } from "./types.js";

export interface ValidationOptions {
  /** Absolute project root. */
  root: string;
  fs?: FileSystem;
  /** Reuse a discovery pass instead of scanning again. */
  discovery?: DiscoveryResult;
  /** Layers to run. Defaults to every implemented layer. */
  layers?: readonly ValidationLayer[];
  /** Explicit rule ids. Takes precedence over `layers`. */
  rules?: readonly string[];
  /** Targets for the compatibility layer. Empty means that layer reports itself skipped. */
  targets?: readonly TargetId[];
  /** Always-loaded context budget, in estimated tokens. */
  budgetTokens?: number;
  /** Near-duplicate similarity threshold, 0–1. */
  similarityThreshold?: number;
  /**
   * Promote warnings to errors, so a warning fails the exit code.
   *
   * Infos are deliberately left alone: the info-level codes report unverified
   * platform behaviour, and turning "nobody has checked this yet" into a build
   * failure would punish the developer for a gap in agentfile's own registry.
   */
  strict?: boolean;
}

export interface ValidationResult {
  diagnostics: Diagnostic[];
  summary: DiagnosticSummary;
  discovery: DiscoveryResult;
  /** Rule ids that ran, in order. */
  rulesRun: string[];
  /** Rules that were selected but could not do their work, with the reason. */
  skipped: RuleSkip[];
  /** Layers that were selected but have no rules yet. */
  emptyLayers: ValidationLayer[];
  /** Rule ids that were requested but do not exist. */
  unknownRules: string[];
}

/** Rules matching a selection, in registry order. */
export function selectRules(options: Pick<ValidationOptions, "layers" | "rules">): {
  rules: Rule[];
  unknownRules: string[];
  emptyLayers: ValidationLayer[];
} {
  if (options.rules?.length) {
    const rules: Rule[] = [];
    const unknownRules: string[] = [];

    for (const id of options.rules) {
      const rule = findRule(id);
      if (rule) rules.push(rule);
      else unknownRules.push(id);
    }

    // Registry order, so output is stable regardless of how they were listed.
    rules.sort((a, b) => RULES.indexOf(a) - RULES.indexOf(b));
    return { rules, unknownRules, emptyLayers: [] };
  }

  const layers = options.layers ?? IMPLEMENTED_LAYERS;
  const rules = RULES.filter((rule) => layers.includes(rule.layer));
  const emptyLayers = layers.filter((layer) => !RULES.some((rule) => rule.layer === layer));

  return { rules, unknownRules: [], emptyLayers };
}

/** Applies `--strict`: every warning becomes an error. */
function applyStrict(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.map((item) => (item.severity === "warning" ? { ...item, severity: "error" as const } : item));
}

export function runValidation(options: ValidationOptions): ValidationResult {
  const discovery =
    options.discovery ??
    discover({
      root: options.root,
      fs: options.fs,
    });

  const { rules, unknownRules, emptyLayers } = selectRules(options);

  const context = {
    configuration: discovery.configuration,
    root: options.root,
    fs: options.fs ?? nodeFileSystem,
    discoveryDiagnostics: discovery.diagnostics,
    files: discovery.scan.files,
    targets: options.targets ?? [],
    budgetTokens: options.budgetTokens,
    similarityThreshold: options.similarityThreshold,
  };

  const diagnostics: Diagnostic[] = [];
  const rulesRun: string[] = [];
  const skipped: RuleSkip[] = [];

  for (const rule of rules) {
    const result = rule.run(context);
    rulesRun.push(rule.id);
    diagnostics.push(...result.diagnostics);
    if (result.skipped) skipped.push({ rule: rule.id, reason: result.skipped });
  }

  const finalDiagnostics = sortDiagnostics(options.strict ? applyStrict(diagnostics) : diagnostics);

  return {
    diagnostics: finalDiagnostics,
    summary: summarize(finalDiagnostics),
    discovery,
    rulesRun,
    skipped,
    emptyLayers,
    unknownRules,
  };
}
