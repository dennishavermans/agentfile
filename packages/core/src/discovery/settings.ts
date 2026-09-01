/**
 * Discovery of Claude Code settings files.
 *
 * Hooks and permission rules live here rather than in a markdown file, and they
 * are the two surfaces where configuration stops describing what an agent should
 * do and starts deciding what it is allowed to do. Nothing else in the toolchain
 * reads them, so nothing else can report on them.
 *
 * The shapes below are the documented ones — see docs/v2-architecture.md §5.7.
 * A key agentfile has not verified is left alone rather than guessed at.
 */

import { join } from "node:path";
import { type Diagnostic, diagnostic } from "../diagnostics/index.js";
import type { FileSystem } from "../fs/index.js";
import type { ConfigScope, HookEntry, PermissionRule, Provenance, SettingEntry, SourceFile } from "../ir/index.js";
import type { RepositoryScan } from "./scan.js";

/**
 * Settings files agentfile reads, with the scope each carries.
 *
 * User and managed settings live outside the repository and are deliberately not
 * read: agentfile analyses what a repository commits, and reaching into a
 * developer's home directory would make the same repository report differently
 * for different people.
 */
export const SETTINGS_FILES: ReadonlyArray<{ path: string; scope: ConfigScope }> = [
  { path: ".claude/settings.json", scope: "project" },
  { path: ".claude/settings.local.json", scope: "local" },
];

/**
 * Settings keys worth carrying into the IR, because their value changes what is
 * permitted or whether a declared thing runs at all.
 *
 * `disableAllHooks` is the second kind. Documented: "To temporarily disable all
 * hooks without removing them, set `"disableAllHooks": true` in your settings
 * file." Without reading it, every hook in such a repository is reported as
 * something that runs, and none of them do.
 */
const REPORTED_KEYS = ["permissions.defaultMode", "permissions.additionalDirectories", "disableAllHooks"] as const;

export interface DiscoveredSettings {
  hooks: HookEntry[];
  permissions: PermissionRule[];
  settings: SettingEntry[];
  sources: SourceFile[];
  diagnostics: Diagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return Object.keys(result).length ? result : undefined;
}

/**
 * Reads one settings file's hooks.
 *
 * Every documented handler type is carried through, including the ones that run
 * no shell command: an `http` hook posts tool input to an endpoint, which is a
 * different risk from a shell command and has to be visible as such rather than
 * flattened into an empty `command`.
 */
function readHooks(value: unknown, provenance: Provenance): { hooks: HookEntry[]; diagnostics: Diagnostic[] } {
  const hooks: HookEntry[] = [];
  const diagnostics: Diagnostic[] = [];

  if (value === undefined) return { hooks, diagnostics };

  if (!isRecord(value)) {
    diagnostics.push(
      diagnostic({
        code: "AGF001",
        message: "`hooks` must be an object keyed by event name",
        explanation: "Claude Code reads hooks as a map from event name to an array of matcher groups.",
        suggestion:
          'Use the documented shape: { "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [...] } ] } }',
        location: { file: provenance.file },
      }),
    );
    return { hooks, diagnostics };
  }

  for (const [event, groups] of Object.entries(value)) {
    if (!Array.isArray(groups)) {
      diagnostics.push(
        diagnostic({
          code: "AGF001",
          message: `Hook event "${event}" must hold an array of matcher groups`,
          explanation: "A value that is not an array is ignored, so the hooks under it never run.",
          suggestion: `Wrap the matcher group in an array: "${event}": [ { "matcher": "...", "hooks": [...] } ]`,
          location: { file: provenance.file },
          data: { event },
        }),
      );
      continue;
    }

    for (const group of groups) {
      if (!isRecord(group)) continue;

      const matcher = typeof group.matcher === "string" ? group.matcher : undefined;
      const handlers = Array.isArray(group.hooks) ? group.hooks : [];

      if (!handlers.length) {
        diagnostics.push(
          diagnostic({
            code: "AGF001",
            message: `Hook group for "${event}" declares no handlers`,
            explanation: "A matcher group with an empty or missing `hooks` array does nothing.",
            suggestion: "Add a handler, or remove the group.",
            location: { file: provenance.file },
            data: { event },
          }),
        );
        continue;
      }

      for (const handler of handlers) {
        if (!isRecord(handler)) continue;

        const type = typeof handler.type === "string" ? handler.type : "";
        if (!type) {
          diagnostics.push(
            diagnostic({
              code: "AGF001",
              message: `Hook for "${event}" has no \`type\``,
              explanation:
                "Every handler needs a type. Claude Code documents command, http, mcp_tool, prompt, and agent.",
              suggestion: 'Add a `type`, for example { "type": "command", "command": "./scripts/guard.sh" }.',
              location: { file: provenance.file },
              data: { event },
            }),
          );
          continue;
        }

        hooks.push({
          event,
          matcher,
          type,
          command: typeof handler.command === "string" ? handler.command : undefined,
          args: stringList(handler.args),
          url: typeof handler.url === "string" ? handler.url : undefined,
          headers: stringMap(handler.headers),
          server: typeof handler.server === "string" ? handler.server : undefined,
          tool: typeof handler.tool === "string" ? handler.tool : undefined,
          prompt: typeof handler.prompt === "string" ? handler.prompt : undefined,
          condition: typeof handler.if === "string" ? handler.if : undefined,
          timeoutMs: typeof handler.timeout === "number" ? handler.timeout * 1000 : undefined,
          provenance,
        });
      }
    }
  }

  return { hooks, diagnostics };
}

/** Reads one settings file's permission rules and the keys worth reporting. */
function readPermissions(
  value: unknown,
  provenance: Provenance,
): { permissions: PermissionRule[]; settings: SettingEntry[]; diagnostics: Diagnostic[] } {
  const permissions: PermissionRule[] = [];
  const settings: SettingEntry[] = [];
  const diagnostics: Diagnostic[] = [];

  if (value === undefined) return { permissions, settings, diagnostics };

  if (!isRecord(value)) {
    diagnostics.push(
      diagnostic({
        code: "AGF001",
        message: "`permissions` must be an object",
        explanation: "Claude Code reads allow, ask, and deny arrays from a permissions object.",
        suggestion: 'Use the documented shape: { "permissions": { "allow": [...], "deny": [...] } }',
        location: { file: provenance.file },
      }),
    );
    return { permissions, settings, diagnostics };
  }

  for (const effect of ["allow", "ask", "deny"] as const) {
    for (const rule of stringList(value[effect])) {
      permissions.push({ effect, rule, provenance });
    }
  }

  if (typeof value.defaultMode === "string") {
    settings.push({ key: "permissions.defaultMode", value: value.defaultMode, provenance });
  }

  const additional = stringList(value.additionalDirectories);
  if (additional.length) {
    settings.push({
      key: "permissions.additionalDirectories",
      value: additional.join(","),
      provenance,
    });
  }

  return { permissions, settings, diagnostics };
}

/** Reads every settings file the repository commits. */
export function discoverSettings(root: string, scan: RepositoryScan, fs: FileSystem): DiscoveredSettings {
  const result: DiscoveredSettings = {
    hooks: [],
    permissions: [],
    settings: [],
    sources: [],
    diagnostics: [],
  };

  for (const entry of SETTINGS_FILES) {
    if (!scan.files.includes(entry.path)) continue;

    let text: string;
    try {
      text = fs.readFile(join(root, entry.path));
    } catch {
      continue;
    }

    const provenance: Provenance = {
      file: entry.path,
      platform: "claude",
      scope: entry.scope,
      origin: "declared",
    };

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      result.diagnostics.push(
        diagnostic({
          code: "AGF003",
          message: `${entry.path} is not valid JSON`,
          explanation: `${(err as Error).message}\n\nClaude Code cannot read this file, so every hook and permission rule in it is inactive.`,
          suggestion: "Fix the JSON syntax.",
          location: { file: entry.path },
        }),
      );
      result.sources.push({
        path: entry.path,
        platform: "claude",
        scope: entry.scope,
        kind: "settings",
        bytes: text.length,
      });
      continue;
    }

    if (!isRecord(parsed)) {
      result.diagnostics.push(
        diagnostic({
          code: "AGF001",
          message: `${entry.path} must contain a JSON object`,
          explanation: "Claude Code reads settings as a map of keys. Anything else is ignored entirely.",
          suggestion: "Replace the contents with a JSON object.",
          location: { file: entry.path },
        }),
      );
      result.sources.push({
        path: entry.path,
        platform: "claude",
        scope: entry.scope,
        kind: "settings",
        bytes: text.length,
      });
      continue;
    }

    const hooks = readHooks(parsed.hooks, provenance);
    result.hooks.push(...hooks.hooks);
    result.diagnostics.push(...hooks.diagnostics);

    const permissions = readPermissions(parsed.permissions, provenance);
    result.permissions.push(...permissions.permissions);
    result.settings.push(...permissions.settings);
    result.diagnostics.push(...permissions.diagnostics);

    // Recorded whether true or false: the resolver needs to see a `false` here
    // to know it outranks a `true` in a lower-precedence file.
    if (typeof parsed.disableAllHooks === "boolean") {
      result.settings.push({ key: "disableAllHooks", value: String(parsed.disableAllHooks), provenance });
    }

    result.sources.push({
      path: entry.path,
      platform: "claude",
      scope: entry.scope,
      kind: "settings",
      bytes: text.length,
    });
  }

  return result;
}

/** Keys `discoverSettings` carries into the IR. Exposed for tests and docs. */
export const REPORTED_SETTINGS_KEYS: readonly string[] = REPORTED_KEYS;
