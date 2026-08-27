/**
 * Running validation.
 *
 * One entry point for every command that reports findings. Selection is by layer
 * or by explicit rule id; nothing else about the run differs between `check`,
 * `validate`, and `lint`.
 */

import type { TargetId } from "../capabilities/index.js";
import { type AgentfileConfig, applyConfiguredSeverity, loadConfig } from "../config/index.js";
import {
  applySuppressions,
  type Diagnostic,
  type DiagnosticSummary,
  type SuppressedDiagnostic,
  sortDiagnostics,
  summarize,
} from "../diagnostics/index.js";
import { DEFAULT_IGNORED_DIRECTORIES, type DiscoveryResult, discover } from "../discovery/index.js";
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
  /**
   * Honour `agentfile-disable` directives in the files being checked. Defaults
   * to true; `false` is the "show me everything, including what we chose to
   * ignore" audit view.
   */
  suppressions?: boolean;
  /**
   * Settings from `agentfile.yaml`. Loaded from `root` when not supplied.
   *
   * Every field here is a default that an explicit option overrides: a flag
   * typed at the prompt is a deliberate decision about this run, and a
   * committed file is a decision about the repository.
   */
  config?: AgentfileConfig;
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
  /**
   * Findings a directive silenced, kept rather than dropped.
   *
   * A count of what a repository has chosen not to see belongs in the report;
   * silently discarding them would make "no problems found" unverifiable.
   */
  suppressed: SuppressedDiagnostic[];
  /** The settings actually in force, after flags overrode the file. */
  config: AgentfileConfig;
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
  const fs = options.fs ?? nodeFileSystem;

  // A settings file that does not parse is reported and then ignored entirely.
  // Applying the half that validated would leave the team with settings they
  // believe are in force and are not.
  const loaded = options.config ? { config: options.config, diagnostics: [] } : loadConfig(options.root, fs);
  const config = loaded.config;

  const discovery =
    options.discovery ??
    discover({
      root: options.root,
      fs: options.fs,
      ignore: config.ignore?.length ? [...DEFAULT_IGNORED_DIRECTORIES, ...config.ignore] : undefined,
    });

  const { rules, unknownRules, emptyLayers } = selectRules(options);

  const context = {
    configuration: discovery.configuration,
    root: options.root,
    fs,
    discoveryDiagnostics: discovery.diagnostics,
    files: discovery.scan.files,
    scanTruncated: discovery.scan.truncated,
    targets: options.targets ?? [],
    budgetTokens: options.budgetTokens ?? config.budget,
    similarityThreshold: options.similarityThreshold ?? config.similarity,
  };

  const diagnostics: Diagnostic[] = [...loaded.diagnostics];
  const rulesRun: string[] = [];
  const skipped: RuleSkip[] = [];

  for (const rule of rules) {
    const result = rule.run(context);
    rulesRun.push(rule.id);
    diagnostics.push(...result.diagnostics);
    if (result.skipped) skipped.push({ rule: rule.id, reason: result.skipped });
  }

  // Suppression runs before `--strict`, so a silenced warning is never promoted
  // into a build failure, and the AGF005 findings it produces are themselves
  // subject to promotion like any other warning.
  const honourSuppressions = options.suppressions ?? config.suppressions ?? true;
  const suppression = honourSuppressions
    ? applySuppressions(diagnostics, {
        root: options.root,
        fs: context.fs,
        files: discovery.configuration.sources.map((source) => source.path),
      })
    : { diagnostics: [...diagnostics], suppressed: [], unused: [] };

  // Configured severity is applied before `--strict`, so a code set to
  // `warning` is still promoted by strict mode and a code set to `off` is gone
  // before promotion can reach it.
  const reported = applyConfiguredSeverity([...suppression.diagnostics, ...suppression.unused], config.severity);
  const finalDiagnostics = sortDiagnostics(options.strict ? applyStrict(reported) : reported);

  return {
    diagnostics: finalDiagnostics,
    summary: summarize(finalDiagnostics),
    discovery,
    rulesRun,
    skipped,
    emptyLayers,
    unknownRules,
    suppressed: suppression.suppressed,
    config,
  };
}
