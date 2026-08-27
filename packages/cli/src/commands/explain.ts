/// <reference types="node" />

/**
 * `agentfile explain <target>` — source-map information for agent configuration.
 *
 * `context` answers "what applies here". This answers the inverse, which is the
 * question asked when something has already gone wrong: this rule — where does
 * it come from, when does it apply, does it apply *here*, what beats it, and
 * where else is the same thing declared.
 *
 * Every verdict comes from the resolver, so `explain` cannot claim one thing
 * while resolution does another.
 */

import { discover, type ExplainKind, type ExplainTarget, explainTarget, findExplainTargets } from "@agentfile/core";
import chalk from "chalk";
import { logger } from "../logger.js";
import { EXIT_USAGE, parseFindingFormat, printJson, rejectFormat } from "../report.js";

export interface ExplainCommandOptions {
  root?: string;
  format?: string;
  /** Evaluate applicability at this path. */
  at?: string;
  /** Restrict to one kind when a query is ambiguous. */
  kind?: string;
}

const KINDS: readonly ExplainKind[] = ["instruction", "rule", "skill", "subagent", "hook", "mcp-server", "permission"];

/**
 * How many matches to explain in full before switching to a compact list.
 *
 * A query naming a file legitimately matches everything that file contributes,
 * so a handful of matches is an answer rather than an ambiguity.
 */
const FULL_EXPLANATION_LIMIT = 5;

function position(target: ExplainTarget): string {
  const { file, line } = target.provenance;
  return line ? `${file}:${line}` : file;
}

function truncate(text: string, limit = 90): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= limit ? single : `${single.slice(0, limit - 1)}…`;
}

export async function explainCommand(query: string, options: ExplainCommandOptions = {}): Promise<void> {
  const format = parseFindingFormat(options.format);
  if (!format) return rejectFormat(options.format as string, ["human", "json"]);

  if (options.kind && !KINDS.includes(options.kind as ExplainKind)) {
    logger.error(`Unknown kind "${options.kind}". Known kinds: ${KINDS.join(", ")}.`);
    process.exit(EXIT_USAGE);
    return;
  }

  const root = options.root ?? process.cwd();
  const discovery = discover({ root });
  const matches = findExplainTargets(discovery.configuration, query, {
    kind: options.kind as ExplainKind | undefined,
  });

  const explanations = matches.map((match) => explainTarget(discovery.configuration, match, { at: options.at }));

  if (format === "json") {
    printJson({ root, command: "explain", query, at: options.at, matches: explanations });
    if (!matches.length) process.exit(1);
    return;
  }

  logger.title("agentfile explain");

  if (!matches.length) {
    logger.error(`Nothing in this repository's agent configuration matches "${query}".`);
    console.log();
    logger.info("A target can be a file path, a skill or subagent name, or part of a rule's text.");
    logger.info("Run `agentfile context <path>` to see what applies somewhere, or");
    logger.info("`agentfile doctor` to see what configuration exists at all.");
    console.log();
    process.exit(1);
    return;
  }

  // A broad text query can match a great deal. Listing those compactly is more
  // useful than printing forty full explanations.
  if (matches.length > FULL_EXPLANATION_LIMIT) {
    logger.warn(`"${query}" matches ${matches.length} pieces of configuration.`);
    console.log();

    for (const match of matches) {
      console.log(`  ${chalk.gray(match.kind.padEnd(12))} ${truncate(match.label, 60)}`);
      console.log(`    ${chalk.gray(position(match))}`);
    }

    console.log();
    logger.info("Narrow it with a file path, an exact name, or --kind <kind>.");
    console.log();
    return;
  }

  for (const explanation of explanations) {
    const { target } = explanation;

    console.log(`  ${chalk.bold(target.kind)} ${chalk.cyan(truncate(target.label))}`);
    console.log();
    console.log(`  ${chalk.gray("Declared in ".padEnd(16))} ${position(target)}`);
    console.log(`  ${chalk.gray("Platform".padEnd(16))} ${target.provenance.platform}`);
    console.log(
      `  ${chalk.gray("Scope".padEnd(16))} ${target.provenance.scope}` +
        (target.provenance.origin === "declared" ? "" : chalk.gray(` (${target.provenance.origin})`)),
    );
    console.log(`  ${chalk.gray("Applies".padEnd(16))} ${explanation.scope}`);

    if (target.provenance.note) {
      console.log(`  ${chalk.gray("Note".padEnd(16))} ${target.provenance.note}`);
    }
    if (target.matchedBy !== "id") {
      console.log(`  ${chalk.gray("Matched by".padEnd(16))} ${chalk.gray(target.matchedBy)}`);
    }
    console.log();

    if (explanation.at) {
      const verdict = explanation.at;
      const at = verdict.path || "the repository root";

      if (verdict.applies) {
        logger.success(`At ${at}: applies — ${verdict.reason}`);
      } else {
        logger.warn(`At ${at}: does not apply — ${verdict.reason}`);
      }

      if (verdict.rank) {
        console.log(
          `    ${chalk.gray(
            `rank: scope ${verdict.rank.scope}, depth ${verdict.rank.depth}, tier ${verdict.rank.tier}` +
              (verdict.rank.pattern ? `, matched ${verdict.rank.pattern}` : ""),
          )}`,
        );
      }

      if (verdict.outrankedBy.length) {
        console.log();
        console.log(`  ${chalk.gray("More specific here, so these win a disagreement:")}`);
        for (const other of verdict.outrankedBy) {
          console.log(`    ${truncate(other, 80)}`);
        }
      }
      console.log();
    }

    if (explanation.alsoDeclaredIn.length) {
      console.log(`  ${chalk.gray("The same thing is also declared in:")}`);
      for (const provenance of explanation.alsoDeclaredIn) {
        const where = provenance.line ? `${provenance.file}:${provenance.line}` : provenance.file;
        console.log(`    ${where} ${chalk.gray(`(${provenance.platform})`)}`);
      }
      console.log();
    }

    if (explanations.length > 1) logger.divider();
  }

  if (!options.at) {
    logger.info(chalk.gray("Add --at <path> to ask whether this applies to a specific file."));
    console.log();
  }
}
