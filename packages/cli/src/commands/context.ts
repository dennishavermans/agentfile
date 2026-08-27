/// <reference types="node" />

/**
 * `agentfile context <path>` — the effective configuration for one path.
 *
 * The question a developer actually has is never "what does the configuration
 * say". It is "which of these nine files reached this request, and in what
 * order". Answering that by reading the files is the work this project exists to
 * remove, so it is answered here instead — from the resolver, which is the same
 * code every other command uses. Nothing about applicability is recomputed.
 */

import { alwaysLoadedContext, discover, estimateContext, resolveForPath, withoutAliases } from "@agentfile/core";
import chalk from "chalk";
import { logger } from "../logger.js";
import { parseFormat, printJson, rejectFormat } from "../report.js";

export interface ContextOptions {
  /** Directory to resolve against instead of the current working directory. */
  root?: string;
  /** `human` (default) or `json`. */
  format?: string;
  /** List everything that did not apply, with the reason. */
  excluded?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

/** How many rules and skills to list before summarising the rest. */
const LIST_LIMIT = 20;

export async function contextCommand(targetPath: string, options: ContextOptions = {}): Promise<void> {
  const format = parseFormat(options.format);
  if (!format) return rejectFormat(options.format as string);

  const root = options.root ?? process.cwd();
  const discovery = discover({ root });
  const effective = resolveForPath(discovery.configuration, targetPath);

  // Symlink twins (CLAUDE.md → AGENTS.md) load one text, so they cost it once.
  const contextEstimate = estimateContext(
    withoutAliases(effective.instructions.map((entry) => entry.node)).map((node) => node.body),
  );

  if (format === "json") {
    printJson({
      root,
      command: "context",
      path: effective.path,
      instructions: effective.instructions.map((entry) => ({
        id: entry.node.id,
        title: entry.node.title,
        file: entry.node.provenance.file,
        line: entry.node.provenance.line,
        platform: entry.node.provenance.platform,
        scope: entry.node.provenance.scope,
        origin: entry.node.provenance.origin,
        reason: entry.reason,
        rank: entry.rank,
      })),
      rules: effective.directives.map((entry) => ({
        id: entry.node.id,
        text: entry.node.text,
        category: entry.node.category,
        file: entry.node.provenance.file,
        line: entry.node.provenance.line,
        platform: entry.node.provenance.platform,
        origin: entry.node.provenance.origin,
        reason: entry.reason,
      })),
      skills: effective.skills.map((entry) => ({
        id: entry.node.id,
        name: entry.node.name,
        description: entry.node.description,
        file: entry.node.provenance.file,
        reason: entry.reason,
      })),
      repositoryWide: {
        subagents: effective.subagents.map((entry) => ({ name: entry.name, file: entry.provenance.file })),
        commands: effective.commands.map((entry) => ({ name: entry.name, file: entry.provenance.file })),
        hooks: effective.hooks.map((entry) => ({ event: entry.event, file: entry.provenance.file })),
        mcpServers: effective.mcpServers.map((entry) => ({ name: entry.name, file: entry.provenance.file })),
        permissions: effective.permissions.map((entry) => ({ rule: entry.rule, effect: entry.effect })),
      },
      excluded: effective.excluded.map((entry) => ({
        kind: entry.kind,
        label: entry.label,
        file: entry.provenance.file,
        reason: entry.reason,
      })),
      estimate: {
        characters: contextEstimate.characters,
        lines: contextEstimate.lines,
        estimatedTokens: contextEstimate.estimatedTokens,
        method: contextEstimate.method,
      },
    });
    return;
  }

  logger.title("agentfile context");
  logger.info(effective.path || chalk.gray("(repository root)"));
  console.log();

  if (!discovery.configuration.sources.length) {
    logger.warn("No agent configuration found, so nothing applies anywhere.");
    console.log();
    logger.info("Run `agentfile doctor` to see what agentfile looks for.");
    console.log();
    return;
  }

  // ─── Instructions, in load order ─────────────────────────────────────────
  if (effective.instructions.length) {
    logger.title("Instructions");
    logger.info(chalk.gray("in load order — the most specific is last, and wins a disagreement"));
    console.log();

    const width = Math.max(...effective.instructions.map((entry) => entry.node.provenance.file.length));
    effective.instructions.forEach((entry, index) => {
      const { provenance } = entry.node;
      const position = provenance.line ? `${provenance.file}:${provenance.line}` : provenance.file;
      console.log(
        `  ${chalk.gray(String(index + 1).padStart(2))}  ${chalk.cyan(pad(position, width + 4))} ` +
          `${chalk.gray(pad(String(provenance.platform), 11))} ${chalk.gray(entry.reason.detail)}`,
      );
    });
    console.log();
  } else {
    logger.title("Instructions");
    logger.info("Nothing applies at this path.");
    console.log();
  }

  // ─── Rules ───────────────────────────────────────────────────────────────
  if (effective.directives.length) {
    logger.title(`Rules (${effective.directives.length})`);

    for (const entry of effective.directives.slice(0, LIST_LIMIT)) {
      const { provenance } = entry.node;
      const position = provenance.line ? `${provenance.file}:${provenance.line}` : provenance.file;
      const derived = provenance.origin === "derived" ? chalk.gray(" (read from prose)") : "";
      console.log(`  ${entry.node.text}${derived}`);
      console.log(`    ${chalk.gray(position)}`);
    }

    const remaining = effective.directives.length - LIST_LIMIT;
    if (remaining > 0) logger.info(chalk.gray(`…and ${remaining} more`));
    console.log();
  }

  // ─── Skills ──────────────────────────────────────────────────────────────
  if (effective.skills.length) {
    logger.title(`Skills available (${effective.skills.length})`);

    for (const entry of effective.skills.slice(0, LIST_LIMIT)) {
      console.log(`  ${chalk.cyan(entry.node.name)} ${chalk.gray(entry.node.provenance.file)}`);
      console.log(`    ${chalk.gray(entry.reason.detail)}`);
    }

    const remaining = effective.skills.length - LIST_LIMIT;
    if (remaining > 0) logger.info(chalk.gray(`…and ${remaining} more`));
    console.log();
  }

  // ─── Repository-wide ─────────────────────────────────────────────────────
  const repositoryWide = [
    effective.subagents.length ? `${effective.subagents.length} subagent(s)` : "",
    effective.commands.length ? `${effective.commands.length} command(s)` : "",
    effective.hooks.length ? `${effective.hooks.length} hook(s)` : "",
    effective.mcpServers.length ? `${effective.mcpServers.length} MCP server(s)` : "",
    effective.permissions.length ? `${effective.permissions.length} permission rule(s)` : "",
  ].filter(Boolean);

  if (repositoryWide.length) {
    logger.title("Repository-wide");
    logger.info(repositoryWide.join(", "));
    logger.info(chalk.gray("no verified platform scopes these by path, so they apply everywhere"));
    console.log();
  }

  // ─── Cost ────────────────────────────────────────────────────────────────
  logger.title("Context cost at this path");
  logger.info(
    `${formatBytes(contextEstimate.characters)}, ${contextEstimate.lines} lines, ` +
      `roughly ${contextEstimate.estimatedTokens.toLocaleString("en-US")} tokens ${chalk.gray("(estimated)")}`,
  );

  const always = alwaysLoadedContext(discovery.configuration);
  const extra = contextEstimate.estimatedTokens - always.estimate.estimatedTokens;
  if (extra > 0) {
    logger.info(
      chalk.gray(
        `${always.estimate.estimatedTokens.toLocaleString("en-US")} of that loads in every session; ` +
          `${extra.toLocaleString("en-US")} is specific to this path`,
      ),
    );
  }
  console.log();
  logger.info(
    chalk.gray(
      "Token counts are estimated from character length, not measured with a\n" +
        "  target tokenizer. Treat them as a relative signal, not an exact figure.",
    ),
  );
  console.log();

  // ─── What did not apply ──────────────────────────────────────────────────
  if (!effective.excluded.length) return;

  if (!options.excluded) {
    logger.info(
      chalk.gray(
        `${effective.excluded.length} piece(s) of configuration did not apply here. ` +
          "Run with --excluded to see why.",
      ),
    );
    console.log();
    return;
  }

  logger.title(`Did not apply (${effective.excluded.length})`);
  for (const entry of effective.excluded) {
    console.log(`  ${chalk.gray(entry.kind.padEnd(12))} ${entry.label}`);
    console.log(`    ${chalk.gray(`${entry.provenance.file} — ${entry.reason.detail}`)}`);
  }
  console.log();
}
