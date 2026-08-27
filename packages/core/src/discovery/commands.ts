/**
 * Discovery of slash commands.
 *
 * Commands look like prose and are not. A Claude Code command body can embed
 * shell with `` !`command` ``, which runs the moment the command is invoked —
 * before the model sees anything — under whatever `allowed-tools` grants. That
 * puts commands on the same trust footing as hooks: committing the file was the
 * approval. The shell is extracted here as data for the security audit, and is
 * never executed by any discovery or analysis code path.
 *
 * Cursor's `.cursor/commands/` holds plain markdown with no frontmatter and no
 * execution syntax, so those are read as prompt text only.
 */

import { join } from "node:path";
import { type Diagnostic, diagnostic } from "../diagnostics/index.js";
import type { FileSystem } from "../fs/index.js";
import { type CommandEntry, nodeId, type SourceFile } from "../ir/index.js";
import { booleanField, extraFields, listField, parseFrontmatter, stringField } from "../parsers/frontmatter.js";
import { basenameOf, dirnameOf, normalizePath } from "../paths/index.js";
import { filesUnder, type RepositoryScan } from "./scan.js";
import { findImports, provenanceOf } from "./shared.js";

/** Frontmatter fields Claude Code documents for a command. */
export const COMMAND_FIELDS: readonly string[] = [
  "description",
  "argument-hint",
  "allowed-tools",
  "model",
  "disable-model-invocation",
];

/**
 * The documented `argument-hint` convention is bracket syntax — `[pr-number]`
 * — which YAML parses as a flow sequence, not a string. Both spellings mean
 * the same thing to the platform, so both are read back to the authored form.
 */
function argumentHintOf(data: Record<string, unknown> | undefined): string | undefined {
  const direct = stringField(data, "argument-hint");
  if (direct !== undefined) return direct;

  const value = data?.["argument-hint"];
  if (!Array.isArray(value)) return undefined;
  return value.map((entry) => `[${String(entry)}]`).join(" ");
}

export interface DiscoveredCommands {
  commands: CommandEntry[];
  sources: SourceFile[];
  diagnostics: Diagnostic[];
}

/**
 * Shell embedded in a command body with `` !`command` ``.
 *
 * Matched on the raw body, fenced examples included. Deliberate: the executing
 * platform decides what runs, and reporting a fenced example that would not run
 * is a cheaper mistake than missing real shell because it sat inside a fence.
 */
export function inlineCommandsOf(body: string): string[] {
  return [...body.matchAll(/!`([^`\n]+)`/g)].map((match) => match[1].trim()).filter(Boolean);
}

/**
 * `@file` references whose targets should exist now.
 *
 * A target containing `$` is built from arguments at invocation time and cannot
 * be checked statically, so it is skipped rather than guessed at.
 */
function checkableReferences(body: string): string[] {
  return findImports(body).filter((target) => !target.includes("$"));
}

function brokenReference(file: string, target: string): Diagnostic {
  return diagnostic({
    code: "AGF004",
    message: `Command references @${target}, which does not exist`,
    explanation:
      "An @-reference in a command body is expanded into the prompt when the\n" +
      "command is invoked. A missing target means the command runs with less\n" +
      "context than its author wrote it against, silently.",
    suggestion: "Fix the path, or remove the reference.",
    location: { file },
  });
}

/**
 * Discovers slash commands.
 *
 * Claude Code: `.claude/commands/**‍/*.md`, frontmatter honoured. Cursor:
 * `.cursor/commands/**‍/*.md`, plain markdown by design — a frontmatter block
 * there is prompt text, so it is not parsed as configuration.
 */
export function discoverCommands(root: string, scan: RepositoryScan, fs: FileSystem): DiscoveredCommands {
  const result: DiscoveredCommands = { commands: [], sources: [], diagnostics: [] };

  const entries: Array<{ file: string; platform: "claude" | "cursor" }> = [
    ...filesUnder(scan, [".claude/commands"], ".md").map((file) => ({ file, platform: "claude" as const })),
    ...filesUnder(scan, [".cursor/commands"], ".md").map((file) => ({ file, platform: "cursor" as const })),
  ];

  for (const { file, platform } of entries) {
    let text: string;
    try {
      text = fs.readFile(join(root, file));
    } catch {
      continue;
    }

    // The filename is the invocation name on both platforms; subdirectories
    // group the listing without renaming the command.
    const name = basenameOf(file).replace(/\.md$/, "");
    const provenance = provenanceOf(file, platform);

    let command: CommandEntry;
    if (platform === "claude") {
      const parsed = parseFrontmatter(file, text);
      result.diagnostics.push(...parsed.diagnostics);

      const body = parsed.body;
      command = {
        id: nodeId("command", provenance, name),
        name,
        description: stringField(parsed.data, "description") ?? "",
        argumentHint: argumentHintOf(parsed.data),
        allowedTools: listField(parsed.data, "allowed-tools", /\s*,\s*/),
        model: stringField(parsed.data, "model"),
        disableModelInvocation: booleanField(parsed.data, "disable-model-invocation") ?? undefined,
        body,
        inlineCommands: inlineCommandsOf(body),
        extensions: extraFields(parsed.data, COMMAND_FIELDS),
        provenance,
      };

      for (const target of checkableReferences(body)) {
        const resolved = normalizePath(join(dirnameOf(file), target));
        const absolute = target.startsWith("/") ? target : join(root, resolved);
        // Claude Code resolves @-references against the working directory, and
        // authors also write them relative to the command file. Either
        // existing is good enough; a reference is only broken when neither is.
        if (!fs.exists(absolute) && !fs.exists(join(root, normalizePath(target)))) {
          result.diagnostics.push(brokenReference(file, target));
        }
      }
    } else {
      command = {
        id: nodeId("command", provenance, name),
        name,
        description: "",
        body: text,
        inlineCommands: [],
        provenance,
      };
    }

    result.commands.push(command);
    result.sources.push({
      path: file,
      platform,
      scope: provenance.scope,
      kind: "command",
      bytes: text.length,
    });
  }

  return result;
}
