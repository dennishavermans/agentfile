/**
 * Hooks.
 *
 * A hook is the one piece of agent configuration that runs on its own. Nobody
 * approves it at the moment it fires; committing the file was the approval. That
 * makes a hook the highest-leverage thing in a repository to get wrong, and the
 * least likely to be noticed — so it is read carefully and never run.
 *
 * Everything asserted here about hook mechanics comes from Claude Code's own
 * documentation (docs/v2-architecture.md §5.7): the handler types, the matcher
 * semantics, and the fact that hooks merge across every configured source.
 */

import { join } from "node:path";
import { type Diagnostic, diagnostic, type Location } from "../diagnostics/index.js";
import type { FileSystem } from "../fs/index.js";
import type { AgentConfiguration, HookEntry } from "../ir/index.js";
import { scanArgv, scanExpression, scanSecretValue } from "./patterns.js";

const HOOKS_DOC = "https://code.claude.com/docs/en/hooks";

/** Handler types Claude Code documents. Anything else is unrecognised, not wrong. */
const KNOWN_TYPES = ["command", "http", "mcp_tool", "prompt", "agent"];

function locationOf(hook: HookEntry): Location {
  return { file: hook.provenance.file, line: hook.provenance.line };
}

function describe(hook: HookEntry): string {
  return `${hook.event}${hook.matcher && hook.matcher !== "*" ? ` (${hook.matcher})` : ""}`;
}

/**
 * A matcher that fires on every occurrence of its event.
 *
 * Documented: absent, `""`, or `"*"` matches everything. Not a problem, but it
 * changes how much a finding about the command matters — a risky command behind
 * `Bash` runs sometimes; the same command behind `*` runs constantly.
 */
function matchesEverything(hook: HookEntry): boolean {
  return !hook.matcher || hook.matcher === "*" || hook.matcher === "";
}

/** The context sentence every hook finding carries. */
function automatically(hook: HookEntry): string {
  return matchesEverything(hook)
    ? `This runs automatically on every ${hook.event} event, with no prompt.`
    : `This runs automatically when ${hook.event} fires and the matcher "${hook.matcher}" applies, with no prompt.`;
}

/**
 * True when Claude Code will spawn this hook's executable directly.
 *
 * Documented: "Claude Code resolves `command` as an executable on `PATH` and
 * spawns it directly with `args` as the argument vector" when `args` is set, and
 * without it "the `command` string is passed to a shell". The presence of `args`
 * is the whole switch.
 */
function isExecForm(hook: HookEntry): boolean {
  return hook.type === "command" && (hook.args?.length ?? 0) > 0;
}

/**
 * The argv as it will be spawned, for display in a finding.
 *
 * Arguments that contain anything ambiguous on one line are quoted, so a reader
 * can see where one argument ends and the next begins. The result is not meant
 * to be pasted into a shell — that no shell sees it is the point.
 */
function renderArgv(command: string, args: readonly string[]): string {
  return [command, ...args].map((part) => (/[\s"'$`|&;<>()]/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

/**
 * AGF502 for hook commands matching a risk pattern.
 *
 * A `command` hook runs in one of two documented forms, and they are not the
 * same text. Without `args` the string goes to a shell, which interprets pipes,
 * `&&`, redirects and globs. With `args` the executable is spawned directly and
 * "there is no shell, so each `args` element is one argument exactly as written".
 *
 * Reading the second as if it were the first reports `/bin/echo "rm -rf /tmp"` as
 * a recursive delete. It prints a string. That is a false positive on the one
 * surface in this tool where a false positive costs the most, so the two forms
 * are matched by different rules.
 */
function commandRisks(hook: HookEntry): Diagnostic[] {
  if (!hook.command) return [];

  const exec = isExecForm(hook);
  const args = hook.args ?? [];
  const patterns = exec ? scanArgv(hook.command, args) : scanExpression([hook.command, ...args].join(" "));
  if (!patterns.length) return [];

  const target = exec ? renderArgv(hook.command, args) : hook.command;
  const form = exec
    ? "`args` is present, so Claude Code spawns the executable directly. No shell reads\nthese arguments, and the shell mechanisms are not checked for here because they\ncannot occur."
    : "`args` is absent, so the whole string goes to a shell, which interprets pipes,\n`&&`, redirects and globs.";

  return patterns.map((pattern) =>
    diagnostic({
      code: "AGF502",
      // A hook is not a script someone chose to run, so a mechanism that is a
      // warning inside a script is at least a warning here, never less.
      severity: pattern.severity === "info" ? "info" : pattern.severity,
      message: `Hook ${describe(hook)} ${pattern.title}`,
      explanation: [
        pattern.why,
        "",
        `  ${target}`,
        "",
        automatically(hook),
        "",
        form,
        "",
        "This is a pattern match on the command text. Nothing was executed to produce",
        `it, and it cannot see intent.\n\nHook documentation:\n  ${HOOKS_DOC}`,
      ].join("\n"),
      suggestion:
        pattern.severity === "info"
          ? "No action needed unless the destinations are unexpected."
          : "Confirm this is intended for something that runs without being asked. If it is, a comment saying why saves the next reader the same work.",
      location: locationOf(hook),
      data: {
        event: hook.event,
        risk: pattern.id,
        hookType: hook.type,
        form: exec ? "exec" : "shell",
        analysis: "static-pattern-match",
      },
    }),
  );
}

/** AGF502 for an `http` hook that posts over an unencrypted connection. */
function transportRisks(hook: HookEntry): Diagnostic[] {
  if (hook.type !== "http" || !hook.url) return [];
  if (!/^http:\/\//i.test(hook.url)) return [];

  const loopback = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(hook.url);

  return [
    diagnostic({
      code: "AGF502",
      severity: loopback ? "info" : "warning",
      message: `Hook ${describe(hook)} posts to ${hook.url} over plain HTTP`,
      explanation: [
        loopback
          ? "The endpoint is on this machine, so the traffic does not leave it. Recorded so the endpoint is visible."
          : "A hook payload carries the tool input that triggered it, which can include file contents and command lines. Over plain HTTP that is readable and modifiable in transit.",
        "",
        automatically(hook),
      ].join("\n"),
      suggestion: loopback ? "No action needed." : "Use HTTPS, or move the endpoint onto this machine.",
      location: locationOf(hook),
      data: { event: hook.event, url: hook.url, hookType: hook.type },
    }),
  ];
}

/** AGF504 for a literal credential in a hook's headers. */
function headerSecrets(hook: HookEntry): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const [name, value] of Object.entries(hook.headers ?? {})) {
    for (const secret of scanSecretValue(value)) {
      diagnostics.push(
        diagnostic({
          code: "AGF504",
          message: `Hook ${describe(hook)} has a credential in its ${name} header`,
          explanation: [
            secret.why,
            "",
            "Anyone who can read this repository can read this value, and so can anything",
            "that mirrors it. Claude Code interpolates environment variables into hook",
            "headers when they are listed in `allowedEnvVars`, so a reference works here.",
            `\nHook documentation:\n  ${HOOKS_DOC}`,
          ].join("\n"),
          suggestion: `Replace the value with an environment variable reference such as $${name.toUpperCase().replaceAll("-", "_")} and list it in \`allowedEnvVars\`, then rotate the exposed credential.`,
          location: locationOf(hook),
          data: { event: hook.event, header: name, secret: secret.id },
        }),
      );
    }
  }

  return diagnostics;
}

/** AGF001 for a handler type no verified platform documents. */
function unknownType(hook: HookEntry): Diagnostic[] {
  if (KNOWN_TYPES.includes(hook.type)) return [];

  return [
    diagnostic({
      code: "AGF001",
      message: `Hook ${describe(hook)} has an unrecognised type "${hook.type}"`,
      explanation: `Claude Code documents ${KNOWN_TYPES.join(", ")}. A handler with any other type is not one agentfile has verified, so it may be ignored at load time.\n\nHook documentation:\n  ${HOOKS_DOC}`,
      suggestion: `Use one of the documented types, or check the platform's own documentation if "${hook.type}" is newer than this check.`,
      location: locationOf(hook),
      data: { event: hook.event, hookType: hook.type },
    }),
  ];
}

/**
 * AGF004 for a `command` hook whose script is not in the repository.
 *
 * A hook pointing at a missing file fails every time its event fires. Depending
 * on the event that is either noise in every session or a check the team believes
 * is running and is not.
 */
function missingScripts(hook: HookEntry, files: readonly string[], options: HookAuditOptions): Diagnostic[] {
  if (hook.type !== "command" || !hook.command) return [];

  // Only a repository-relative path can be checked. A bare binary name resolves
  // from PATH, and an absolute path outside the repository is not ours to verify.
  const command = hook.command.trim();

  // In exec form the whole string is the executable: no shell splits it on
  // whitespace, and a quote in it is part of the filename rather than a quote.
  // Only shell form needs its first token pulled out.
  let script: string;
  if (isExecForm(hook)) {
    script = command;
  } else {
    const match = command.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
    if (!match) return [];
    script = match[1] ?? match[2] ?? match[3];
  }
  script = script.replace(/^\$\{CLAUDE_PROJECT_DIR\}\/?/, "").replace(/^\.\//, "");

  // Not a relative path inside the repository: nothing to check.
  if (script.startsWith("/") || script.startsWith("~") || !script.includes("/")) return [];
  if (files.includes(script)) return [];
  // The scan is bounded, so the file list proves presence and never absence.
  // Without this, a repository too large to scan in full reports every hook
  // script beyond the cut as missing.
  if (options.fs && options.root !== undefined && options.fs.exists(join(options.root, script))) return [];

  return [
    diagnostic({
      code: "AGF004",
      message: `Hook ${describe(hook)} runs ${script}, which is not in the repository`,
      explanation: [
        `The command is \`${command}\`, and no file at ${script} exists here.`,
        "",
        "A hook pointing at a missing file fails every time its event fires. Depending",
        "on the event, that is either noise in every session or a check the team",
        "believes is running and is not.",
      ].join("\n"),
      suggestion: `Add ${script}, correct the path, or remove the hook.`,
      location: locationOf(hook),
      data: { event: hook.event, script },
    }),
  ];
}

export interface HookAuditOptions {
  /** Project-relative paths of every scanned file, for reference checking. */
  files: readonly string[];
  /**
   * Absolute project root and filesystem, so a script the bounded scan did not
   * reach can still be found. Optional: without them the file list is the only
   * evidence, which proves presence but not absence.
   */
  root?: string;
  fs?: FileSystem;
}

/** Every hook finding for a configuration. */
export function auditHooks(configuration: AgentConfiguration, options: HookAuditOptions): Diagnostic[] {
  return configuration.hooks.flatMap((hook) => [
    ...unknownType(hook),
    ...commandRisks(hook),
    ...transportRisks(hook),
    ...headerSecrets(hook),
    ...missingScripts(hook, options.files, options),
  ]);
}
