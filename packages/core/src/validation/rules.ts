/**
 * The rule set.
 *
 * Every rule is a thin composition over a primitive that already exists and is
 * already tested. That is the point: a rule decides *when* a finding is
 * reported, never *how* it is computed. Adding a second way to compute
 * duplication or reachability here would recreate the drift the rework exists to
 * remove.
 */

import {
  contextBudgetDiagnostics,
  findInstructionOverlap,
  findNearDuplicateInstructions,
  findScopeMismatches,
  nearDuplicateDiagnostics,
  overlapDiagnostics,
  scopeMismatchDiagnostics,
} from "../analysis/index.js";
import { compatibilityDiagnostics } from "../capabilities/index.js";
import { repositoryResolutionDiagnostics, unreachableDiagnostics } from "../resolver/index.js";
import type { Rule } from "./types.js";

/**
 * Structural findings come from reading the configuration, not from a separate
 * pass: a file that will not parse has already failed by the time a rule could
 * look at it. The rule exists so those findings are selectable and layered like
 * everything else, rather than arriving through a side channel.
 */
const configurationIntegrity: Rule = {
  id: "configuration-integrity",
  layer: "structural",
  description: "Schema violations, unparsable files, and references that point at nothing",
  emits: ["AGF001", "AGF002", "AGF003", "AGF004"],
  run: (context) => ({ diagnostics: [...context.discoveryDiagnostics] }),
};

const duplicateInstructions: Rule = {
  id: "duplicate-instructions",
  layer: "resolution",
  description: "The same instruction maintained in more than one file",
  emits: ["AGF302"],
  run: (context) => ({
    diagnostics: [
      // Declared rule lists that both reach one path.
      ...repositoryResolutionDiagnostics(context.configuration),
      // Prose repeated between instruction files.
      ...overlapDiagnostics(findInstructionOverlap(context.configuration.instructions)),
    ],
  }),
};

const unreachableConfiguration: Rule = {
  id: "unreachable-configuration",
  layer: "resolution",
  description: "Glob-scoped configuration that no file in the repository matches",
  emits: ["AGF303"],
  run: (context) => {
    if (!context.files.length) {
      return { diagnostics: [], skipped: "no file list was available to match patterns against" };
    }
    return { diagnostics: unreachableDiagnostics(context.configuration, { files: context.files }) };
  },
};

const inconsistentScope: Rule = {
  id: "inconsistent-scope",
  layer: "resolution",
  description: "Shared instruction text that applies under different conditions per platform",
  emits: ["AGF304"],
  run: (context) => ({
    diagnostics: scopeMismatchDiagnostics(findScopeMismatches(context.configuration.instructions)),
  }),
};

const nearDuplicateInstructions: Rule = {
  id: "near-duplicate-instructions",
  layer: "quality",
  description: "Copies of the same instruction that have drifted apart",
  emits: ["AGF305"],
  run: (context) => {
    const result = findNearDuplicateInstructions(context.configuration.instructions, {
      threshold: context.similarityThreshold,
    });

    return {
      diagnostics: nearDuplicateDiagnostics(result.pairs),
      skipped: result.truncated
        ? `the comparison budget was reached after ${result.comparisons.toLocaleString("en-US")} comparisons, so some pairs were not compared`
        : undefined,
    };
  },
};

const contextBudget: Rule = {
  id: "context-budget",
  layer: "quality",
  description: "Always-loaded context measured against a budget",
  emits: ["AGF401"],
  run: (context) => ({
    diagnostics: contextBudgetDiagnostics(context.configuration, { budgetTokens: context.budgetTokens }),
  }),
};

/**
 * Compatibility is only a question once a target is named. Without one there is
 * nothing to be incompatible with, so the rule reports that it did not run
 * rather than inventing a default target and failing a build over it.
 */
const targetCompatibility: Rule = {
  id: "target-compatibility",
  layer: "compatibility",
  description: "Features the configuration uses that a target does not support natively",
  emits: ["AGF201", "AGF202", "AGF203"],
  run: (context) => {
    if (!context.targets.length) {
      return { diagnostics: [], skipped: "no target was named, so there is nothing to check compatibility against" };
    }
    return { diagnostics: compatibilityDiagnostics(context.configuration, context.targets) };
  },
};

/** Every rule, in a stable order. */
export const RULES: readonly Rule[] = [
  configurationIntegrity,
  duplicateInstructions,
  unreachableConfiguration,
  inconsistentScope,
  nearDuplicateInstructions,
  contextBudget,
  targetCompatibility,
];

export function findRule(id: string): Rule | undefined {
  return RULES.find((rule) => rule.id === id);
}
