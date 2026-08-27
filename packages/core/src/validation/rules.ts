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
import { compatibilityDiagnostics, instructionSizeDiagnostics } from "../capabilities/index.js";
import { repositoryResolutionDiagnostics, unreachableDiagnostics } from "../resolver/index.js";
import { auditHooks, auditInstructionText, auditMcpServers, auditPermissions } from "../security/index.js";
import { analyzeSkillQuality, checkSkillReferences, inspectSkillResources, validateSkills } from "../skills/index.js";
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
  emits: ["AGF201", "AGF202", "AGF203", "AGF206"],
  run: (context) => {
    if (!context.targets.length) {
      return { diagnostics: [], skipped: "no target was named, so there is nothing to check compatibility against" };
    }
    return {
      diagnostics: [
        ...compatibilityDiagnostics(context.configuration, context.targets),
        ...instructionSizeDiagnostics(context.configuration, context.targets),
      ],
    };
  },
};

/**
 * `SKILL.md` is an external standard, so this checks the configuration against
 * the published specification rather than against an agentfile format. Every
 * constraint it enforces has a source recorded in `skills/spec.ts`.
 */
const skillSpecification: Rule = {
  id: "skill-specification",
  layer: "structural",
  description: "Skills checked against the published Agent Skills specification",
  emits: ["AGF101", "AGF102", "AGF004"],
  run: (context) => ({
    diagnostics: [
      ...validateSkills(context.configuration),
      ...checkSkillReferences(context.configuration, context.files, { root: context.root, fs: context.fs }),
    ],
  }),
};

const skillQuality: Rule = {
  id: "skill-quality",
  layer: "quality",
  description: "Skills that are valid but hard to route on, oversized, or not portable",
  emits: ["AGF103", "AGF104", "AGF105", "AGF106"],
  run: (context) => ({ diagnostics: analyzeSkillQuality(context.configuration) }),
};

/**
 * Static inspection of the files a skill bundles.
 *
 * This is the only rule that reads from disk, and it never executes anything it
 * reads. Files it could not inspect are reported rather than passed over, so a
 * clean result means "these files were checked against these patterns" and not
 * "nothing was found".
 */
const skillScripts: Rule = {
  id: "skill-scripts",
  layer: "security",
  description: "Bundled scripts matched against documented risk patterns, never executed",
  emits: ["AGF501"],
  run: (context) => {
    const result = inspectSkillResources(context.configuration, { root: context.root, fs: context.fs });
    const unreadable = result.skipped.filter((entry) => entry.reason !== "not executable content");

    return {
      diagnostics: result.diagnostics,
      skipped: unreadable.length
        ? `${unreadable.length} bundled file(s) could not be inspected: ${unreadable
            .map((entry) => `${entry.file} (${entry.reason})`)
            .join(", ")}`
        : undefined,
    };
  },
};

/**
 * Hooks, the one piece of configuration that runs on its own.
 *
 * Nobody approves a hook at the moment it fires; committing the file was the
 * approval. Commands are read as text and never executed — reading a hook is
 * exactly the moment not to run it.
 */
const hookCommands: Rule = {
  id: "hook-commands",
  layer: "security",
  description: "Hooks that run automatically, matched against risk patterns and checked for missing scripts",
  emits: ["AGF502", "AGF504", "AGF004", "AGF001"],
  run: (context) => ({
    diagnostics: auditHooks(context.configuration, { files: context.files, root: context.root, fs: context.fs }),
  }),
};

const mcpServers: Rule = {
  id: "mcp-servers",
  layer: "security",
  description: "MCP servers that are unpinned, unencrypted, or carry a credential in committed configuration",
  emits: ["AGF503", "AGF504"],
  run: (context) => ({ diagnostics: auditMcpServers(context.configuration) }),
};

/**
 * Permission rules, checked against Claude Code's documented evaluation
 * mechanics rather than against a style preference. The value of this rule is
 * that it knows the rules a developer reasonably would not.
 */
const permissionRules: Rule = {
  id: "permission-rules",
  layer: "security",
  description: "Permission rules that grant more, less, or nothing compared to how they read",
  emits: ["AGF506"],
  run: (context) => ({ diagnostics: auditPermissions(context.configuration) }),
};

const promptInjection: Rule = {
  id: "prompt-injection",
  layer: "security",
  description: "Instruction text with invisible characters or wording that addresses the agent's instructions",
  emits: ["AGF505"],
  run: (context) => ({ diagnostics: auditInstructionText(context.configuration) }),
};

/** Every rule, in a stable order. */
export const RULES: readonly Rule[] = [
  configurationIntegrity,
  skillSpecification,
  duplicateInstructions,
  unreachableConfiguration,
  inconsistentScope,
  nearDuplicateInstructions,
  contextBudget,
  skillQuality,
  targetCompatibility,
  skillScripts,
  hookCommands,
  mcpServers,
  permissionRules,
  promptInjection,
];

export function findRule(id: string): Rule | undefined {
  return RULES.find((rule) => rule.id === id);
}
