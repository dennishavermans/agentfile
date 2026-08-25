/**
 * Context cost analysis.
 *
 * Agent instructions are paid for in context on every single session, so the
 * size of what loads unconditionally is one of the few genuinely actionable
 * numbers agentfile can produce without running a model.
 *
 * These are **estimates**, and they say so. A real token count depends on the
 * target's tokenizer; claiming an exact number without running that tokenizer
 * would be dishonest, and the difference matters when a developer is deciding
 * what to cut.
 */

import { type Diagnostic, diagnostic } from "../diagnostics/index.js";
import type { AgentConfiguration, Instruction } from "../ir/index.js";
import { ROOT_PATH } from "../paths/index.js";

/**
 * Characters per token, used for estimation only.
 *
 * Around four characters per token is the widely used rule of thumb for English
 * prose in modern byte-pair tokenizers. Real ratios vary with code, punctuation,
 * and non-Latin scripts, which is exactly why this is reported as an estimate.
 */
export const CHARACTERS_PER_TOKEN = 4;

export interface ContextEstimate {
  /** Exactly measured. */
  characters: number;
  /** Exactly measured. */
  lines: number;
  /** Estimated, not measured. */
  estimatedTokens: number;
  /** How `estimatedTokens` was derived, so output can be explicit about it. */
  method: "characters-per-token-heuristic";
  charactersPerToken: number;
}

/** Estimates the context cost of one or more pieces of text. */
export function estimateContext(text: string | readonly string[]): ContextEstimate {
  const parts = typeof text === "string" ? [text] : text;

  let characters = 0;
  let lines = 0;
  for (const part of parts) {
    characters += part.length;
    lines += part.length ? part.split("\n").length : 0;
  }

  return {
    characters,
    lines,
    estimatedTokens: Math.round(characters / CHARACTERS_PER_TOKEN),
    method: "characters-per-token-heuristic",
    charactersPerToken: CHARACTERS_PER_TOKEN,
  };
}

/**
 * True when an instruction loads regardless of which file is being worked on.
 *
 * Directory-scoped instructions at the repository root count: their subtree is
 * the whole repository, so they are always loaded in practice.
 */
export function isAlwaysLoaded(instruction: Instruction): boolean {
  const { applies } = instruction;
  if (applies.kind === "always") return true;
  if (applies.kind === "directory") return applies.directory === ROOT_PATH;
  return false;
}

export interface AlwaysLoadedContext {
  /** Instructions that enter context in every session. */
  instructions: Instruction[];
  /** Source files those instructions came from. */
  files: string[];
  estimate: ContextEstimate;
  /** Number of atomic directives that always apply. */
  alwaysLoadedDirectives: number;
}

/** Summarises what a repository loads into every session, unconditionally. */
export function alwaysLoadedContext(configuration: AgentConfiguration): AlwaysLoadedContext {
  const instructions = configuration.instructions.filter(isAlwaysLoaded);

  const alwaysLoadedDirectives = configuration.directives.filter((directive) => {
    if (directive.applies.kind === "always") return true;
    return directive.applies.kind === "directory" && directive.applies.directory === ROOT_PATH;
  }).length;

  const files = [...new Set(instructions.map((instruction) => instruction.provenance.file))].sort();

  return {
    instructions,
    files,
    estimate: estimateContext(instructions.map((instruction) => instruction.body)),
    alwaysLoadedDirectives,
  };
}

/**
 * Skills whose description is too weak for an agent to route on.
 *
 * Routing quality is measured here as metadata quality, and nothing more. A
 * description agentfile considers good does not prove any particular model will
 * pick the skill; a description this thin makes it unlikely for any of them.
 */
export interface SkillRoutingSignal {
  name: string;
  file: string;
  /** Why the description is weak. Empty when it looks fine. */
  problems: string[];
  descriptionLength: number;
}

/** Minimum description length before routing metadata looks too thin to act on. */
export const WEAK_DESCRIPTION_LENGTH = 40;

/** Maximum description length allowed by the Agent Skills specification. */
export const MAX_DESCRIPTION_LENGTH = 1024;

/** Maximum name length allowed by the Agent Skills specification. */
export const MAX_SKILL_NAME_LENGTH = 64;

export function analyzeSkillRouting(configuration: AgentConfiguration): SkillRoutingSignal[] {
  return configuration.skills.map((skill) => {
    const problems: string[] = [];
    const description = skill.description.trim();

    if (!description) {
      problems.push("has no description, so nothing tells the agent when to use it");
    } else {
      if (description.length < WEAK_DESCRIPTION_LENGTH) {
        problems.push("description is too short to distinguish this skill from another");
      }
      if (description.length > MAX_DESCRIPTION_LENGTH) {
        problems.push(`description is ${description.length} characters, over the 1024-character specification limit`);
      }
      // The specification asks a description to say what the skill does *and*
      // when to use it. The second half is the part that drives routing.
      if (!/\b(use|when|for|if|after|before)\b/i.test(description)) {
        problems.push("description says what the skill does but not when to use it");
      }
    }

    return {
      name: skill.name,
      file: skill.provenance.file,
      problems,
      descriptionLength: description.length,
    };
  });
}

/**
 * Default always-loaded context budget, in estimated tokens.
 *
 * No agent platform documents a maximum size for always-loaded instructions, so
 * this is agentfile's default and nothing more — it is not a platform limit, and
 * the diagnostic says so. It is set where always-loaded prose stops being free:
 * roughly 16 KB of markdown, paid on every request of every session, before the
 * agent has read a single line of code.
 */
export const DEFAULT_CONTEXT_BUDGET_TOKENS = 4000;

/** How many of the largest contributing files a diagnostic names. */
const LISTED_FILES = 3;

export interface ContextBudgetOptions {
  /** Estimated-token budget. Defaults to `DEFAULT_CONTEXT_BUDGET_TOKENS`. */
  budgetTokens?: number;
}

/**
 * AGF401 when always-loaded context exceeds its budget.
 *
 * The figure is an estimate and the message is explicit about that, because the
 * decision it informs — what to delete — deserves to know how firm the number
 * is. The largest contributors are named, since "you are over budget" without
 * "here is what is big" is not actionable.
 */
export function contextBudgetDiagnostics(
  configuration: AgentConfiguration,
  options: ContextBudgetOptions = {},
): Diagnostic[] {
  const budget = options.budgetTokens ?? DEFAULT_CONTEXT_BUDGET_TOKENS;
  const always = alwaysLoadedContext(configuration);
  const { estimatedTokens } = always.estimate;

  if (estimatedTokens <= budget) return [];

  // Largest first, so the suggestion points at what is worth cutting.
  const byFile = new Map<string, number>();
  for (const instruction of always.instructions) {
    const file = instruction.provenance.file;
    byFile.set(file, (byFile.get(file) ?? 0) + instruction.body.length);
  }
  const largest = [...byFile]
    .sort((a, b) => b[1] - a[1])
    .slice(0, LISTED_FILES)
    .map(([file, characters]) => `  ${file} — roughly ${Math.round(characters / CHARACTERS_PER_TOKEN)} tokens`);

  return [
    diagnostic({
      code: "AGF401",
      message: `Always-loaded context is roughly ${estimatedTokens.toLocaleString("en-US")} tokens, over the ${budget.toLocaleString("en-US")}-token budget`,
      explanation: [
        `${always.files.length} file${always.files.length === 1 ? "" : "s"} load in every session regardless of what is being worked on.`,
        "Largest contributors:",
        "",
        ...largest,
        "",
        "The token figure is estimated from character length, not measured with any",
        `target's tokenizer. The budget is agentfile's default, not a limit imposed by`,
        "an agent platform — no platform documents one.",
      ].join("\n"),
      suggestion:
        "Move the parts that only matter for specific work into path-scoped rules or skills, so they load when they are relevant instead of always.",
      data: {
        estimatedTokens,
        budgetTokens: budget,
        characters: always.estimate.characters,
        files: always.files.length,
        method: always.estimate.method,
      },
    }),
  ];
}
