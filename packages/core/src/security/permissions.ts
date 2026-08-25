/**
 * Permission rules.
 *
 * A permission rule is the one place where a typo silently grants or silently
 * fails to grant. Every finding here is a *documented* mechanic of Claude Code's
 * permission syntax, not a style preference — the value of this check is that it
 * knows the rules a developer reasonably would not:
 *
 *   • `Bash(ls*)` and `Bash(ls *)` are different. Without the space there is no
 *     word boundary, so `Bash(ls*)` also matches `lsof`.
 *   • `:*` is recognised only at the end of a pattern. In `Bash(git:* push)` the
 *     colon is literal and the rule matches nothing.
 *   • An unanchored glob in an *allow* rule — `*`, `B*`, `mcp__*` — is skipped
 *     with a warning and auto-approves nothing.
 *   • Rules are evaluated deny, then ask, then allow, and specificity does not
 *     change that order. A broad deny cannot carry allowlist exceptions, so an
 *     allow rule covered by a deny rule is dead.
 *   • Exec wrappers (`watch`, `setsid`, `ionice`, `flock`) and `find` with
 *     `-exec`/`-delete` are not auto-approved by a prefix rule.
 *
 * Source: https://code.claude.com/docs/en/permissions
 */

import { type Diagnostic, diagnostic, type Location } from "../diagnostics/index.js";
import type { AgentConfiguration, PermissionRule } from "../ir/index.js";

const PERMISSIONS_DOC = "https://code.claude.com/docs/en/permissions";

/** Commands a prefix rule cannot auto-approve, per the documentation. */
const EXEC_WRAPPERS = ["watch", "setsid", "ionice", "flock"];

function locationOf(rule: PermissionRule): Location {
  return { file: rule.provenance.file, line: rule.provenance.line };
}

interface ParsedRule {
  /** Tool name, e.g. `Bash`. */
  tool: string;
  /** Specifier inside the parentheses, or undefined for a bare tool rule. */
  specifier?: string;
}

/** Splits `Tool(specifier)` into its parts. */
export function parsePermissionRule(rule: string): ParsedRule {
  const match = rule.trim().match(/^([^(]+)\((.*)\)$/);
  if (!match) return { tool: rule.trim() };
  return { tool: match[1].trim(), specifier: match[2] };
}

/**
 * AGF506 for a wildcard with no word boundary.
 *
 * `Bash(ls*)` matching `lsof` is the single most surprising documented behaviour
 * in the permission syntax, and the difference from `Bash(ls *)` is one space.
 */
function missingWordBoundary(rule: PermissionRule): Diagnostic[] {
  const { tool, specifier } = parsePermissionRule(rule.rule);
  if (tool !== "Bash" || !specifier) return [];
  if (!specifier.endsWith("*") || specifier.endsWith(" *")) return [];

  const prefix = specifier.slice(0, -1);
  if (!prefix || prefix.endsWith(":")) return [];

  return [
    diagnostic({
      code: "AGF506",
      severity: rule.effect === "allow" ? "warning" : "info",
      message: `Permission rule ${rule.rule} has no word boundary, so it matches more than "${prefix}"`,
      explanation: [
        `A \`*\` with no space before it does not enforce a word boundary, so this rule`,
        `also matches any command starting with "${prefix}" — \`${prefix}x\`, \`${prefix}foo\`, and so on.`,
        "",
        `\`Bash(${prefix} *)\` — with the space — matches only \`${prefix}\` followed by arguments.`,
        rule.effect === "allow"
          ? "\nAs an allow rule this grants more than it appears to."
          : "\nAs a deny or ask rule this is broader than it appears, which is usually the safe direction.",
        `\nPermission syntax:\n  ${PERMISSIONS_DOC}`,
      ].join("\n"),
      suggestion: `Write \`Bash(${prefix} *)\` if you meant the command "${prefix}" with any arguments.`,
      location: locationOf(rule),
      data: { rule: rule.rule, effect: rule.effect, problem: "missing-word-boundary" },
    }),
  ];
}

/** AGF506 for `:*` used anywhere but the end, where the colon is literal. */
function misplacedColonWildcard(rule: PermissionRule): Diagnostic[] {
  const { specifier } = parsePermissionRule(rule.rule);
  if (!specifier?.includes(":*")) return [];
  if (specifier.endsWith(":*")) return [];

  return [
    diagnostic({
      code: "AGF506",
      severity: "error",
      message: `Permission rule ${rule.rule} matches nothing: \`:*\` is only recognised at the end of a pattern`,
      explanation: [
        "Anywhere else the colon is treated as a literal character, so this rule never",
        "matches a real command. Nothing reports it at load time — the rule simply has",
        "no effect.",
        `\nPermission syntax:\n  ${PERMISSIONS_DOC}`,
      ].join("\n"),
      suggestion: "Move `:*` to the end of the pattern, or use a space-separated prefix form instead.",
      location: locationOf(rule),
      data: { rule: rule.rule, effect: rule.effect, problem: "misplaced-colon-wildcard" },
    }),
  ];
}

/**
 * AGF506 for an unanchored glob in an allow rule.
 *
 * Documented: allow rules accept tool-name globs only after a literal
 * `mcp__<server>__` prefix. Anything else is skipped with a warning and
 * auto-approves nothing — so the rule a team wrote to grant access grants none.
 */
function unanchoredAllowGlob(rule: PermissionRule): Diagnostic[] {
  if (rule.effect !== "allow") return [];

  const { tool, specifier } = parsePermissionRule(rule.rule);
  if (specifier !== undefined) return [];
  if (!tool.includes("*")) return [];
  if (/^mcp__[^*]+__/.test(tool)) return [];

  return [
    diagnostic({
      code: "AGF506",
      severity: "error",
      message: `Allow rule "${rule.rule}" auto-approves nothing`,
      explanation: [
        "Allow rules accept a glob in the tool-name position only after a literal",
        "`mcp__<server>__` prefix, where the server segment contains no glob. Any other",
        "unanchored glob is skipped with a warning at startup and approves nothing.",
        "",
        "The rule looks like a broad grant and is not one, which is the worst of both:",
        "a reader believes access was given, and the agent still prompts.",
        `\nPermission syntax:\n  ${PERMISSIONS_DOC}`,
      ].join("\n"),
      suggestion:
        'Name the tool explicitly, or scope the glob to one server: "mcp__github__get_*". A deny or ask rule may use a bare glob.',
      location: locationOf(rule),
      data: { rule: rule.rule, effect: rule.effect, problem: "unanchored-allow-glob" },
    }),
  ];
}

/** AGF506 for a prefix rule over a command the documentation says it cannot approve. */
function unapprovableWrapper(rule: PermissionRule): Diagnostic[] {
  if (rule.effect !== "allow") return [];

  const { tool, specifier } = parsePermissionRule(rule.rule);
  if (tool !== "Bash" || !specifier) return [];

  const command = specifier.trim().split(/\s+/)[0].replace(/\*$/, "");
  if (!EXEC_WRAPPERS.includes(command) && command !== "find") return [];
  if (!specifier.includes("*")) return [];

  return [
    diagnostic({
      code: "AGF506",
      message: `Allow rule ${rule.rule} does not auto-approve ${command}`,
      explanation: [
        command === "find"
          ? "A `Bash(find *)` rule does not cover `find` with `-exec` or `-delete`, so those forms still prompt."
          : `Exec wrappers such as ${EXEC_WRAPPERS.join(", ")} cannot be auto-approved by a prefix rule, so this always prompts in manual mode.`,
        "",
        "The rule is not wrong, but it does not do what it looks like it does.",
        `\nPermission syntax:\n  ${PERMISSIONS_DOC}`,
      ].join("\n"),
      suggestion: "Write an exact-match rule for the full command string you want approved.",
      location: locationOf(rule),
      data: { rule: rule.rule, effect: rule.effect, problem: "unapprovable-wrapper" },
    }),
  ];
}

/** True when `broad` covers everything `narrow` would match, per prefix semantics. */
function covers(broad: ParsedRule, narrow: ParsedRule): boolean {
  if (broad.tool !== narrow.tool) return false;
  // A bare tool rule covers every specifier of that tool.
  if (broad.specifier === undefined) return true;
  if (narrow.specifier === undefined) return false;

  const prefix = broad.specifier.replace(/(\s\*|:\*|\*)$/, "");
  if (prefix === broad.specifier) return broad.specifier === narrow.specifier;

  return narrow.specifier.startsWith(prefix);
}

/**
 * AGF506 for an allow rule a deny or ask rule already overrides.
 *
 * Documented: rules are evaluated deny, then ask, then allow, and specificity
 * does not change the order. So a narrower allow rule under a broader deny rule
 * is dead — it reads as an exception and is not one.
 */
function shadowedAllow(configuration: AgentConfiguration): Diagnostic[] {
  const parsed = configuration.permissions.map((rule) => ({ rule, parsed: parsePermissionRule(rule.rule) }));
  const blocking = parsed.filter((entry) => entry.rule.effect !== "allow");
  const diagnostics: Diagnostic[] = [];

  for (const allow of parsed.filter((entry) => entry.rule.effect === "allow")) {
    const blocker = blocking.find((entry) => covers(entry.parsed, allow.parsed));
    if (!blocker) continue;

    diagnostics.push(
      diagnostic({
        code: "AGF506",
        message: `Allow rule ${allow.rule.rule} is overridden by ${blocker.rule.effect} rule ${blocker.rule.rule}`,
        explanation: [
          `Rules are evaluated deny, then ask, then allow, and specificity does not change`,
          `that order. \`${blocker.rule.rule}\` matches everything \`${allow.rule.rule}\` matches, so the`,
          blocker.rule.effect === "deny"
            ? "call is blocked and the allow rule never takes effect."
            : "call still prompts and the allow rule never takes effect.",
          "",
          "A broad deny rule cannot carry allowlist exceptions. The allow rule reads as",
          "an exception and is not one.",
          `\nPermission syntax:\n  ${PERMISSIONS_DOC}`,
        ].join("\n"),
        suggestion:
          blocker.rule.effect === "deny"
            ? `Narrow \`${blocker.rule.rule}\` so it no longer covers this call, or remove the allow rule.`
            : `Narrow \`${blocker.rule.rule}\`, or accept that this call prompts.`,
        location: locationOf(allow.rule),
        related: [{ location: locationOf(blocker.rule), message: `${blocker.rule.effect} rule that wins` }],
        data: {
          rule: allow.rule.rule,
          effect: allow.rule.effect,
          overriddenBy: blocker.rule.rule,
          problem: "shadowed-allow",
        },
      }),
    );
  }

  return diagnostics;
}

/**
 * AGF506 for `bypassPermissions` set in a committed file.
 *
 * The vendor's own documentation carries a warning on this mode, and quoting it
 * is more persuasive than anything agentfile could add.
 */
function bypassMode(configuration: AgentConfiguration): Diagnostic[] {
  return configuration.settings
    .filter((setting) => setting.key === "permissions.defaultMode" && setting.value === "bypassPermissions")
    .map((setting) =>
      diagnostic({
        code: "AGF506",
        severity: "error",
        message: `${setting.provenance.file} starts every session in bypassPermissions mode`,
        explanation: [
          "In this mode Claude Code skips permission prompts, including for writes to",
          "protected paths such as `.git` and `.claude`. Claude Code's own documentation",
          "says to use it only in isolated environments like containers or VMs where it",
          "cannot cause damage.",
          "",
          setting.provenance.scope === "local"
            ? "This file is personal and usually untracked, so it affects one machine."
            : "This file is committed, so it applies to everyone on the project — including anyone who has not read this line.",
          `\nPermission modes:\n  ${PERMISSIONS_DOC}#permission-modes`,
        ].join("\n"),
        suggestion:
          setting.provenance.scope === "local"
            ? "Keep it only if this machine is a disposable environment."
            : "Remove it from the committed file. If a container needs it, set it there instead.",
        location: { file: setting.provenance.file, line: setting.provenance.line },
        data: { setting: setting.key, value: setting.value, scope: setting.provenance.scope },
      }),
    );
}

/** Every permission finding for a configuration. */
export function auditPermissions(configuration: AgentConfiguration): Diagnostic[] {
  return [
    ...configuration.permissions.flatMap((rule) => [
      ...missingWordBoundary(rule),
      ...misplacedColonWildcard(rule),
      ...unanchoredAllowGlob(rule),
      ...unapprovableWrapper(rule),
    ]),
    ...shadowedAllow(configuration),
    ...bypassMode(configuration),
  ];
}
