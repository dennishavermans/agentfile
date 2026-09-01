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
 *   • An `mcp__` rule with parentheses is skipped when the settings file loads.
 *     A deny rule written that way denies nothing.
 *   • A tool's primary content field cannot be matched with `param:value`
 *     syntax. `Bash(command:rm *)` is ignored with a startup warning.
 *   • Environment runners (`npx`, `devbox run`, `docker exec`, …) are not
 *     stripped wrappers, so `Bash(devbox run *)` allows `devbox run rm -rf .`.
 *   • A command is split on `&&`, `||`, `;`, `|`, `|&`, `&` and newlines, and a
 *     rule must match each subcommand on its own. A rule that spans a separator
 *     matches nothing — including `Bash(curl * | sh)` in a deny list.
 *   • The words before the first `*` are all that limit a rule, so in
 *     `Bash(git * main)` only `git` limits it.
 *   • A tool name is a single identifier. `Stop Task` matches no tool.
 *

 * Source: https://code.claude.com/docs/en/permissions
 */

import { type Diagnostic, diagnostic, type Location } from "../diagnostics/index.js";
import type { AgentConfiguration, PermissionRule } from "../ir/index.js";

const PERMISSIONS_DOC = "https://code.claude.com/docs/en/permissions";

/** Commands a prefix rule cannot auto-approve, per the documentation. */
const EXEC_WRAPPERS = ["watch", "setsid", "ionice", "flock"];

/**
 * Fields that hold what a tool actually does, which `param:value` cannot match.
 *
 * Documented, and quoted here because the list is the whole check: "You can't
 * match a tool's primary content field this way: `command` for Bash and
 * PowerShell, `file_path` for Read, Edit, and Write, `path` for Grep and Glob,
 * `notebook_path` for NotebookEdit, and `url` for WebFetch."
 */
const PRIMARY_CONTENT_FIELDS: ReadonlyArray<{ field: string; tools: readonly string[] }> = [
  { field: "command", tools: ["Bash", "PowerShell"] },
  { field: "file_path", tools: ["Read", "Edit", "Write"] },
  { field: "path", tools: ["Grep", "Glob"] },
  { field: "notebook_path", tools: ["NotebookEdit"] },
  { field: "url", tools: ["WebFetch"] },
];

/**
 * Runners that execute their arguments, and that Claude Code does not strip.
 *
 * The documentation names these five and says "such as", so this is the
 * documented list rather than a complete one. Guessing at the rest — `uv run`,
 * `bundle exec`, `pnpm dlx` — would be inventing platform behaviour, which is
 * the mistake this analyser exists to catch in other people's configuration.
 */
const ENVIRONMENT_RUNNERS = ["direnv exec", "devbox run", "mise exec", "docker exec", "npx"];

/**
 * The first shell operator that splits a rule into subcommands, if any.
 *
 * Documented: "The recognized command separators are `&&`, `||`, `;`, `|`,
 * `|&`, `&`, and newlines. A rule must match each subcommand independently."
 * Splitting happens before matching, which is why `Bash(safe-cmd *)` does not
 * cover `safe-cmd && other-cmd` even though `*` matches any text.
 *
 * Quoting matters and is the difference between a useful check and a noisy one.
 * A pipe inside `--jq '.[] | {a}'` or `sed 's|a|b|'` is a character in an
 * argument, not an operator, and 161 rules in a 344-file sample are that shape.
 * `>&` is a redirection, not a background operator, so `2>&1` is not a split —
 * without that, `Bash(bash -i >& /dev/tcp/*)` reads as a dead deny rule.
 */
function commandSeparatorIn(specifier: string): string | undefined {
  let quote: string | undefined;

  for (let index = 0; index < specifier.length; index++) {
    const character = specifier[index];

    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "\\") {
      index++;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ";") return ";";
    if (character === "\n") return "a newline";
    if (character === "|") return specifier[index + 1] === "|" ? "||" : specifier[index + 1] === "&" ? "|&" : "|";
    if (character === "&") {
      if (specifier[index - 1] === ">") continue;
      return specifier[index + 1] === "&" ? "&&" : "&";
    }
  }

  return undefined;
}

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
 *
 * The mechanism is a `*` continuing a word, so it only applies when the
 * character before it is part of one. After punctuation the boundary is already
 * there: `Bash(rm -rf /*)` cannot match a command other than `rm`, the `*` only
 * extends a path, and the fix this check would otherwise suggest —
 * `Bash(rm -rf / *)` — is a different rule that stops matching `rm -rf /etc`.
 * Handing someone a change that quietly weakens their deny rule is worse than
 * saying nothing.
 */
function missingWordBoundary(rule: PermissionRule): Diagnostic[] {
  const { tool, specifier } = parsePermissionRule(rule.rule);
  if (tool !== "Bash" || !specifier) return [];
  if (!specifier.endsWith("*") || specifier.endsWith(" *")) return [];
  if (!/[A-Za-z0-9_]\*$/.test(specifier)) return [];

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

/**
 * AGF506 for `:*` used anywhere but the end, where the colon is literal.
 *
 * Documented for Bash, and for PowerShell which "use the same shape as Bash
 * rules": "The `:*` suffix is an equivalent way to write a trailing wildcard...
 * The `:*` form is only recognized at the end of a pattern."
 *
 * It is not a rule about colons in general. Other tools give the colon their own
 * meaning — `WebFetch(domain:*.example.com)` is a documented form that matches
 * any subdomain at any depth — and reading `:*` there as a broken Bash prefix
 * calls a working rule dead.
 */
const COLON_WILDCARD_TOOLS = ["Bash", "PowerShell"];

function misplacedColonWildcard(rule: PermissionRule): Diagnostic[] {
  const { tool, specifier } = parsePermissionRule(rule.rule);
  if (!COLON_WILDCARD_TOOLS.includes(tool)) return [];
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

/**
 * AGF506 for an `mcp__` rule that carries a specifier.
 *
 * Documented: "When Claude Code loads a settings file, it skips any `mcp__` rule
 * that has parentheses." Skipped, not narrowed — the rule is discarded whole.
 *
 * On a deny rule that is the worst outcome in a permissions file. The rule reads
 * as a restriction, a reviewer counts it as one, and the tool it names is
 * unrestricted. Claude Code does say so, in the invalid-settings dialog and in
 * `claude doctor`, but only to whoever starts an interactive session — not to
 * the reviewer reading the diff, which is where this is decided.
 */
function mcpRuleWithSpecifier(rule: PermissionRule): Diagnostic[] {
  const { tool, specifier } = parsePermissionRule(rule.rule);
  if (!tool.startsWith("mcp__") || specifier === undefined) return [];

  return [
    diagnostic({
      code: "AGF506",
      severity: "error",
      message: `${rule.effect === "deny" ? "Deny" : rule.effect === "ask" ? "Ask" : "Allow"} rule ${rule.rule} is skipped when the settings file loads`,
      explanation: [
        "Claude Code skips any `mcp__` rule that has parentheses. The rule is discarded",
        "whole rather than applied loosely, so it has no effect at all.",
        "",
        rule.effect === "deny"
          ? `Nothing about ${tool} is denied. A deny rule that does not deny is the most\nexpensive kind of mistake in a permissions file: it reads as a restriction and\nis counted as one by whoever reviews it.`
          : `Nothing about ${tool} is ${rule.effect === "ask" ? "gated" : "approved"} by this rule.`,
        "",
        "Claude Code reports the skipped rule in the invalid-settings dialog and in",
        "`claude doctor`, so it is visible to whoever starts a session — but not in the",
        "diff where the rule was added.",
        `\nPermission syntax:\n  ${PERMISSIONS_DOC}`,
      ].join("\n"),
      suggestion:
        rule.effect === "deny"
          ? `Drop the parentheses to cover every use of the tool: "${tool}". To match one parameter on an MCP tool, pass the deny rule with \`--disallowedTools\` instead, which is the only place that works.`
          : `Drop the parentheses to cover every use of the tool: "${tool}". Settings files cannot match a parameter on an MCP tool.`,
      location: locationOf(rule),
      data: { rule: rule.rule, effect: rule.effect, tool, problem: "mcp-rule-with-specifier" },
    }),
  ];
}

/**
 * AGF506 for `param:value` naming a tool's primary content field.
 *
 * Documented: a rule like `Bash(command:rm *)` "would be bypassable by a
 * compound command, so Claude Code ignores it and emits a startup warning".
 *
 * This is the shape someone writes when they have read about parameter matching
 * and not the sentence that excludes these fields. It is also the most natural
 * spelling: `command` really is the Bash tool's parameter, so the rule looks
 * right, and the correct form drops the field name that made it look right.
 *
 * Only deny and ask rules, because only they do parameter matching: "Deny and
 * ask rules can match a top-level input parameter", while "allow rules continue
 * to use each tool's own specifier syntax". So `allow: ["Bash(command:*)"]` is
 * not a parameter rule at all — it is a Bash prefix rule with the documented
 * `:*` trailing wildcard, and it works. Three real configurations write exactly
 * that, and reporting them would be inventing a defect.
 */
function primaryContentFieldRule(rule: PermissionRule): Diagnostic[] {
  if (rule.effect === "allow") return [];

  const { tool, specifier } = parsePermissionRule(rule.rule);
  if (specifier === undefined) return [];

  // Whitespace around the colon is ignored, per the documentation.
  const parameter = specifier.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([\s\S]*)$/);
  if (!parameter) return [];

  const [, field, value] = parameter;
  const entry = PRIMARY_CONTENT_FIELDS.find((candidate) => candidate.field === field);
  if (!entry?.tools.includes(tool)) return [];

  const replacement = field === "url" ? `${tool}(domain:<host>)` : `${tool}(${value})`;

  return [
    diagnostic({
      code: "AGF506",
      severity: "error",
      message: `Permission rule ${rule.rule} is ignored: \`${field}\` is ${tool}'s primary content field`,
      explanation: [
        `Parameter matching works on a tool's other input fields, but not on the one`,
        `that carries what the tool does. A rule naming \`${field}\` on ${tool} would be`,
        "bypassable by a compound command, so Claude Code ignores it and warns at",
        "startup.",
        "",
        rule.effect === "deny"
          ? "Nothing is denied. The rule reads as a restriction and is not one."
          : `Nothing is ${rule.effect === "ask" ? "gated" : "approved"} by this rule.`,
        "",
        "The fields this applies to are `command` on Bash and PowerShell, `file_path` on",
        "Read, Edit and Write, `path` on Grep and Glob, `notebook_path` on NotebookEdit,",
        "and `url` on WebFetch.",
        `\nPermission syntax:\n  ${PERMISSIONS_DOC}`,
      ].join("\n"),
      suggestion:
        field === "url"
          ? `Match the hostname instead: ${replacement}. WebFetch rules use a \`domain:\` prefix.`
          : `Drop the field name and write the value as the specifier: ${replacement}.`,
      location: locationOf(rule),
      data: { rule: rule.rule, effect: rule.effect, field, tool, problem: "primary-content-field" },
    }),
  ];
}

/**
 * AGF506 for an allow rule whose wildcard sits directly after an environment runner.
 *
 * Documented: these runners "are not in the list" of stripped wrappers, and
 * "because these tools execute their arguments as a command, a rule like
 * `Bash(devbox run *)` matches whatever comes after `run`, including
 * `devbox run rm -rf .`".
 *
 * It is the mirror image of `unapprovableWrapper`. That one reports a rule that
 * approves less than it looks like it does, which is an annoyance. This one
 * reports a rule that approves more, which is an unbounded grant written in a
 * form that does not read as one.
 *
 * Only the wildcard immediately after the runner is reported. `Bash(devbox run
 * npm *)` constrains the inner command and is the shape the documentation
 * recommends; the danger is specifically that the inner command is unconstrained.
 */
function unstrippedRunner(rule: PermissionRule): Diagnostic[] {
  if (rule.effect !== "allow") return [];

  const { tool, specifier } = parsePermissionRule(rule.rule);
  if (tool !== "Bash" || !specifier) return [];

  const command = specifier.trim();
  const runner = ENVIRONMENT_RUNNERS.find((candidate) =>
    new RegExp(`^${candidate.replace(/ /g, "\\s+")}\\s+\\*`).test(command),
  );
  if (!runner) return [];

  return [
    diagnostic({
      code: "AGF506",
      severity: "error",
      message: `Allow rule ${rule.rule} approves any command, because ${runner} runs its arguments`,
      explanation: [
        `Claude Code strips a fixed set of wrappers before matching a Bash rule, and`,
        `${runner} is not one of them. It is matched as written, and everything after it`,
        `is the wildcard — so this rule approves \`${runner} rm -rf .\` exactly as readily`,
        `as it approves the command it was written for.`,
        "",
        "The grant is unbounded. It is written in a form that reads as a narrow one,",
        "which is why it is worth reporting rather than leaving to review.",
        "",
        "The runners the documentation names are direnv exec, devbox run, mise exec,",
        "npx, and docker exec.",
        `\nPermission syntax:\n  ${PERMISSIONS_DOC}#process-wrappers`,
      ].join("\n"),
      suggestion: `Name the inner command too, one rule per command you want approved: "Bash(${runner} npm test)".`,
      location: locationOf(rule),
      data: { rule: rule.rule, effect: rule.effect, runner, problem: "unstripped-runner" },
    }),
  ];
}

/**
 * AGF506 for a rule that spans a command separator.
 *
 * Documented: a command is split on `&&`, `||`, `;`, `|`, `|&`, `&` and
 * newlines, and "a rule must match each subcommand independently". The split
 * happens before matching, so no subcommand ever contains the separator — and a
 * rule whose text spans one is compared against fragments it cannot equal.
 *
 * The shape is common and it looks right. `Bash(cd src && go build:*)` reads as
 * approval for that exact sequence. `Bash(curl * | sh)` in a deny list reads as
 * a block on the oldest trick there is. Neither matches anything: in a 344-file
 * sample, 62 allow rules and 67 deny rules are written this way.
 */
function separatorSpanningRule(rule: PermissionRule): Diagnostic[] {
  const { tool, specifier } = parsePermissionRule(rule.rule);
  if (tool !== "Bash" || !specifier) return [];

  const separator = commandSeparatorIn(specifier);
  if (!separator) return [];

  const [first] = specifier.split(/\s*(?:\|\||\||;|&&|&)\s*/);

  return [
    diagnostic({
      code: "AGF506",
      severity: "error",
      message: `Permission rule ${rule.rule} matches nothing: ${separator} splits a command before rules are matched`,
      explanation: [
        `Claude Code splits a command on \`&&\`, \`||\`, \`;\`, \`|\`, \`|&\`, \`&\` and newlines,`,
        "then matches each subcommand on its own. No subcommand contains the separator,",
        "so a rule whose text spans one is compared against fragments it cannot equal.",
        "",
        rule.effect === "deny"
          ? "Nothing is denied by this rule. A deny rule written across a pipe is a common\nway to try to block `curl … | sh`, and it does not block it — each half is\nmatched separately, and neither half is this rule."
          : `Nothing is ${rule.effect === "ask" ? "gated" : "approved"} by this rule. The command it was written for still prompts.`,
        `\nPermission syntax:\n  ${PERMISSIONS_DOC}#compound-commands`,
      ].join("\n"),
      suggestion:
        rule.effect === "deny"
          ? `Write one rule per subcommand you want to stop, such as "Bash(${first.trim() || "curl *"})" — a deny on any subcommand stops the whole command.`
          : `Write one rule per subcommand. Claude Code needs a rule matching every part before it runs the whole thing.`,
      location: locationOf(rule),
      data: { rule: rule.rule, effect: rule.effect, separator, problem: "separator-spanning-rule" },
    }),
  ];
}

/**
 * AGF506 for an allow rule whose wildcard stands where the subcommand goes.
 *
 * Documented: "Claude Code matches everything before the first `*` as written,
 * so those words are what limit the rule", with a startup warning "about an
 * allow rule with a `*` before the subcommand, such as `Bash(git * main)`".
 *
 * The text after the wildcard still narrows what matches, so this is not an
 * unbounded grant — it is a rule whose limit is one word long when it reads as
 * though it were three. In `Bash(git * main)` only `git` limits it, so
 * `git push --force main` is approved.
 */
function wildcardBeforeSubcommand(rule: PermissionRule): Diagnostic[] {
  if (rule.effect !== "allow") return [];

  const { tool, specifier } = parsePermissionRule(rule.rule);
  if (tool !== "Bash" || !specifier) return [];

  const words = specifier.trim().split(/\s+/);
  if (words.length < 3 || words[1] !== "*" || words[0].includes("*")) return [];

  return [
    diagnostic({
      code: "AGF506",
      message: `Allow rule ${rule.rule} is limited only by "${words[0]}"`,
      explanation: [
        "Claude Code matches everything before the first `*` as written, and those words",
        `are what limit the rule. Here that is \`${words[0]}\` alone: the wildcard stands where`,
        "the subcommand goes, so every subcommand is approved as long as the rest of the",
        "command still matches.",
        "",
        `\`${rule.rule}\` approves \`${words[0]} ${words.slice(2).join(" ")}\` whatever runs in place of the`,
        "wildcard. Claude Code warns about this shape at startup.",
        `\nPermission syntax:\n  ${PERMISSIONS_DOC}#wildcard-patterns`,
      ].join("\n"),
      suggestion: `Name the subcommand and put the wildcard after it, one rule per subcommand you want approved.`,
      location: locationOf(rule),
      data: { rule: rule.rule, effect: rule.effect, program: words[0], problem: "wildcard-before-subcommand" },
    }),
  ];
}

/**
 * AGF506 for a tool name that no tool can have.
 *
 * Documented: a tool label can differ from its canonical name — "the tool
 * labeled `Stop Task` in the transcript has the canonical name `TaskStop`" —
 * and "permission rules and hook matchers match the canonical name only".
 *
 * Only names that cannot be canonical are reported, which in practice means
 * names containing whitespace. Checking against a list of known tools would
 * catch more, and would also start reporting every tool added after this
 * version shipped. A structural rule cannot drift, and it turns out to catch
 * something else worth catching: JSON has no comments, so a `// ─── Git ───`
 * line written into a permissions array is a rule, and an inert one. All 27
 * matches in a 344-file sample are exactly that.
 */
function impossibleToolName(rule: PermissionRule): Diagnostic[] {
  const { tool } = parsePermissionRule(rule.rule);
  if (!/\s/.test(tool.trim())) return [];

  const looksLikeComment = /^(?:\/\/|#|\/\*)/.test(tool.trim());

  return [
    diagnostic({
      code: "AGF506",
      severity: "error",
      message: looksLikeComment
        ? `${rule.effect} entry ${JSON.stringify(rule.rule)} is a permission rule, not a comment`
        : `Permission rule ${rule.rule} names no tool, because a tool name cannot contain a space`,
      explanation: [
        looksLikeComment
          ? "JSON has no comments, so this line is an entry in the permissions array like\nany other. Claude Code reads it as a tool name, finds no such tool, and the\nentry does nothing."
          : "A tool name is a single identifier. The label shown in the transcript can differ\nfrom it — the tool labelled `Stop Task` is canonically `TaskStop` — and rules\nmatch the canonical name only.",
        "",
        rule.effect === "allow"
          ? "Nothing is approved by this entry."
          : `Nothing is ${rule.effect === "ask" ? "gated" : "denied"} by this entry, and Claude Code warns about it at startup.`,
        `\nTool names:\n  https://code.claude.com/docs/en/tools-reference`,
      ].join("\n"),
      suggestion: looksLikeComment
        ? "Remove the entry. To label a group of rules, use a key Claude Code ignores, or keep the note outside the settings file."
        : "Use the canonical tool name, which is one word — `TaskStop` rather than `Stop Task`.",
      location: locationOf(rule),
      data: { rule: rule.rule, effect: rule.effect, problem: "impossible-tool-name" },
    }),
  ];
}

/**
 * AGF506, informational, for an allow rule trying to pin a network tool to a host.
 *
 * Documented as a caution rather than a defect: "Bash permission patterns that
 * try to constrain command arguments are fragile. For example,
 * `Bash(curl http://github.com/ *)` intends to restrict curl to GitHub URLs, but
 * won't match variations like" options before the URL, `https`, redirects,
 * variables, and extra spaces.
 *
 * Recorded, not raised. The rule does work for the commands it matches — the
 * point is that the ones it misses still prompt, and that this is not a network
 * boundary. An exact-match rule is not reported: it covers one command
 * precisely, which is the opposite of fragile.
 */
function fragileArgumentPattern(rule: PermissionRule): Diagnostic[] {
  if (rule.effect !== "allow") return [];

  const { tool, specifier } = parsePermissionRule(rule.rule);
  if (tool !== "Bash" || !specifier) return [];
  if (!/^\s*(?:curl|wget)[\s.]/.test(specifier) || !specifier.includes("*")) return [];

  const host = specifier.match(/https?:\/\/([^\s/*:"']+)/);
  if (!host) return [];
  if (/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)$/i.test(host[1])) return [];

  return [
    diagnostic({
      code: "AGF506",
      severity: "info",
      message: `Allow rule ${rule.rule} does not confine ${host[1]} to itself`,
      explanation: [
        `The rule matches the text of the command, so it covers the spelling written here`,
        "and not the others that reach the same place: options before the URL, `https` for",
        "`http`, a redirect through a shortener, the URL held in a variable, or an extra",
        "space. Those still prompt rather than being approved, so nothing is granted by",
        "accident — but this is not a network boundary, and it reads like one.",
        "",
        "Claude Code's own guidance is to deny `curl` and `wget` outright and allow",
        "`WebFetch(domain:…)` instead, which matches on the hostname after the URL is",
        "resolved, and to enforce anything stricter in a PreToolUse hook.",
        `\nPermission syntax:\n  ${PERMISSIONS_DOC}`,
      ].join("\n"),
      suggestion: `No action needed if this is a convenience. To make it a boundary, deny \`Bash(curl *)\` and \`Bash(wget *)\` and allow \`WebFetch(domain:${host[1]})\`.`,
      location: locationOf(rule),
      data: { rule: rule.rule, effect: rule.effect, host: host[1], problem: "fragile-argument-pattern" },
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

/**
 * Every finding for one rule.
 *
 * A rule that spans a command separator matches nothing, and every other check
 * here asks whether a rule matches too much or too little. Those questions do
 * not arise for a rule that matches nothing, so that finding is reported alone
 * rather than alongside three consequences of it. `Bash(curl:* | sh)` is dead
 * because of the pipe; that its colon is also misplaced is not the reader's
 * problem, and the fix for the pipe does not leave the colon behind.
 */
function findingsFor(rule: PermissionRule): Diagnostic[] {
  const named = impossibleToolName(rule);
  if (named.length) return named;

  const dead = separatorSpanningRule(rule);
  if (dead.length) return dead;

  return [
    ...missingWordBoundary(rule),
    ...misplacedColonWildcard(rule),
    ...unanchoredAllowGlob(rule),
    ...unapprovableWrapper(rule),
    ...mcpRuleWithSpecifier(rule),
    ...primaryContentFieldRule(rule),
    ...unstrippedRunner(rule),
    ...wildcardBeforeSubcommand(rule),
    ...fragileArgumentPattern(rule),
  ];
}

/** Every permission finding for a configuration. */
export function auditPermissions(configuration: AgentConfiguration): Diagnostic[] {
  return [
    ...configuration.permissions.flatMap(findingsFor),
    ...shadowedAllow(configuration),
    ...bypassMode(configuration),
  ];
}
