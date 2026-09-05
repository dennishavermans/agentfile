/**
 * Risk patterns, shared by every surface that carries a command.
 *
 * A bundled script, a hook command, and an MCP server's argv are the same kind
 * of text with the same failure modes, so they are matched against the same set.
 * Two copies of this list would drift, and the copy that drifted would be the
 * one that missed something.
 *
 * Every pattern carries a name and a stated reason, so a finding can be argued
 * with on its merits rather than accepted because a tool said so. Nothing in
 * this module executes anything: patterns are matched against text.
 */

import type { Severity } from "../diagnostics/index.js";

/**
 * What has to be true before a pattern describes something real.
 *
 * The same text means different things depending on who parses it. A hook in
 * shell form hands its command string to a shell, so `|`, `$` and `&&` do what
 * they look like. A hook in exec form is spawned directly, and Claude Code
 * documents the difference in as many words: "There is no shell, so each `args`
 * element is one argument exactly as written", and "special characters such as
 * apostrophes, `$`, and backticks pass through verbatim because there is no
 * shell to interpret them."
 *
 * So each pattern states what it depends on. Without that the scanner cannot
 * tell `/bin/echo "rm -rf /tmp"`, which prints twelve characters, from
 * `rm -rf /tmp`, which does not.
 */
export type RiskRequirement =
  /** A shell has to interpret the text. A pipe is only a pipe to a shell. */
  | "shell"
  /** The named program has to be the one being run, not merely mentioned. */
  | "executable"
  /** The text is the finding wherever it appears. Nothing has to interpret it. */
  | "text";

export interface RiskPattern {
  /** Stable kebab-case id, so a finding can be suppressed or tracked by name. */
  id: string;
  pattern: RegExp;
  requires: RiskRequirement;
  severity: Severity;
  /** What was found, phrased as an observation. */
  title: string;
  /** Why it is worth a human looking. Never a claim about intent. */
  why: string;
  /**
   * Lines the pattern matches that are not the thing it is looking for.
   *
   * Kept beside the pattern rather than in the scanner so that a pattern and
   * the shape it must not report stay readable together.
   */
  exempt?: (line: string) => boolean;
}

/**
 * Removes shell expansions from a value, innermost first.
 *
 * `${LINEAR_API_KEY:-${LINEAR_TOKEN:-}}` collapses to nothing, and so does
 * `$HUGGINGFACE_HUB_TOKEN`. What is left is the literal text the line would
 * still contain with every variable empty.
 */
function withoutExpansions(value: string): string {
  let previous: string;
  let text = value;

  // Innermost `${...}` first, so nesting unwinds without a recursive pattern.
  do {
    previous = text;
    text = text.replace(/\$\{[^{}]*\}/g, "");
  } while (text !== previous);

  return text.replace(/\$\([^()]*\)/g, "").replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, "");
}

/**
 * A credential assignment whose value is only variable expansion.
 *
 * `HF_TOKEN="$HUGGINGFACE_HUB_TOKEN"` in sglang and
 * `TOKEN="${LINEAR_API_KEY:-${LINEAR_TOKEN:-}}"` in langfuse were both reported
 * as literal credentials. Reading a secret from the environment is what this
 * project tells people to do everywhere else, so reporting it is worse than
 * saying nothing: the advice and the finding contradict each other.
 *
 * The quoted value still has to be short once expansions are removed, so
 * `token="prefix-$SUFFIX-0123456789"` keeps its finding.
 */
function assignsOnlyAnExpansion(line: string): boolean {
  const match = line.match(/(?:secret|token|password|passwd|api[_-]?key)\s*[:=]\s*(["'])([^"'\n]{12,})\1/i);
  if (!match) return false;

  return withoutExpansions(match[2]).replace(/[^A-Za-z0-9]/g, "").length < 12;
}

/**
 * The pattern set.
 *
 * Deliberately small and specific. A large fuzzy set produces findings a
 * developer learns to ignore, which is worse than no findings at all — so each
 * entry here describes a concrete mechanism, not a vibe.
 */
export const RISK_PATTERNS: readonly RiskPattern[] = [
  {
    id: "remote-script-execution",
    pattern: /\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z|k|da)?sh\b/,
    requires: "shell",
    severity: "error",
    title: "downloads a script and pipes it straight into a shell",
    why: "Whatever the remote host serves at that moment runs with the developer's privileges. The content is never reviewed, is not pinned to a version, and can differ between runs.",
  },
  {
    id: "obfuscated-execution",
    pattern: /base64\s+(?:-d|-D|--decode)[^|\n]*\|\s*\w*sh\b|\|\s*base64\s+(?:-d|-D|--decode)[^|\n]*\|\s*\w*sh\b/,
    requires: "shell",
    severity: "error",
    title: "decodes text and executes the result",
    why: "The command that will actually run is not readable in the file, so review of the file does not tell a reader what it does.",
  },
  {
    id: "eval-of-variable",
    pattern: /\beval\b[^\n]*\$\{?[A-Za-z_]/,
    requires: "shell",
    severity: "error",
    title: "evaluates a variable as a command",
    why: "What runs depends on the variable's value at that moment, so the file's text does not determine its behaviour.",
  },
  {
    id: "hardcoded-private-key",
    pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
    requires: "text",
    severity: "error",
    title: "contains a private key",
    why: "A key committed to a repository is readable by everyone with access to it and by anything that mirrors it. It should be treated as already disclosed.",
  },
  {
    id: "hardcoded-credential",
    pattern: /\bAKIA[0-9A-Z]{16}\b|(?:secret|token|password|passwd|api[_-]?key)\s*[:=]\s*["'][^"'\n]{12,}["']/i,
    requires: "text",
    severity: "error",
    title: "contains what looks like a credential",
    why: "A literal credential in a committed file is disclosed to everyone with repository access. This pattern also matches placeholders, so confirm before rotating anything.",
    exempt: assignsOnlyAnExpansion,
  },
  {
    id: "recursive-force-delete",
    pattern: /\brm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*[rR]|-r\s+-f|-f\s+-r)\b/,
    requires: "executable",
    severity: "warning",
    title: "deletes recursively without prompting",
    why: "If the path is empty or unset at runtime, the deletion starts somewhere other than where the author intended, and there is no confirmation step to stop it.",
  },
  {
    id: "privilege-escalation",
    pattern: /(?:^|\s|\|)sudo\s/,
    requires: "executable",
    severity: "warning",
    title: "requests elevated privileges",
    why: "An agent running this cannot judge whether elevation is warranted, and the effects reach outside the repository.",
  },
  {
    id: "credential-path-access",
    pattern: /(?:~|\$HOME|\$\{HOME\})\/\.(?:ssh|aws|gnupg|kube|docker|npmrc)\b|(?:^|\s)\.env(?:\.\w+)?\b/,
    requires: "text",
    severity: "warning",
    title: "reads or writes a credential location",
    why: "These paths hold secrets for systems beyond this repository. Legitimate uses exist; each is worth confirming.",
  },
  {
    id: "insecure-transport",
    pattern: /\bcurl\b[^\n]*\s(?:-k|--insecure)\b|\bwget\b[^\n]*\s--no-check-certificate\b/,
    requires: "executable",
    severity: "warning",
    title: "disables certificate verification",
    why: "The connection can be intercepted and its content replaced without the script noticing.",
  },
  {
    id: "world-writable",
    pattern: /\bchmod\s+(?:-R\s+)?0?777\b/,
    requires: "executable",
    severity: "warning",
    title: "makes files writable by every user on the machine",
    why: "Any process on the machine can then modify them, including whatever runs next.",
  },
  {
    id: "outbound-network",
    pattern: /\b(?:curl|wget|nc|ncat|scp|rsync|ssh)\b/,
    requires: "executable",
    severity: "info",
    title: "makes network calls",
    why: "Not a problem in itself. Recorded so that what a skill reaches out to is visible without reading every script.",
  },
];

/** A line that matched a pattern, with where it was. */
export interface RiskMatch {
  pattern: RiskPattern;
  /** 1-based line number in the scanned text. */
  line: number;
  /** The matching line, trimmed. */
  text: string;
}

/**
 * Matches text against every pattern, line by line.
 *
 * Comment lines are skipped: a shell comment is documentation, not an
 * instruction, and flagging `# never do: curl x | sh` teaches developers to
 * ignore the tool.
 */
export function scanText(text: string): RiskMatch[] {
  const lines = text.split("\n");
  const matches: RiskMatch[] = [];

  for (let offset = 0; offset < lines.length; offset++) {
    const line = lines[offset];
    if (/^\s*#(?!!)/.test(line) || /^\s*\/\//.test(line)) continue;

    for (const pattern of RISK_PATTERNS) {
      if (!pattern.pattern.test(line)) continue;
      if (pattern.exempt?.(line)) continue;
      matches.push({ pattern, line: offset + 1, text: line.trim() });
    }
  }

  return matches;
}

/** Matches in a single expression that a shell will interpret, such as a hook command. */
export function scanExpression(expression: string): RiskPattern[] {
  return RISK_PATTERNS.filter((pattern) => pattern.pattern.test(expression) && !pattern.exempt?.(expression));
}

/**
 * Programs that are themselves a shell, with the flag that introduces a script.
 *
 * Exec form removes the shell — unless the executable *is* one. A hook of
 * `{"command": "bash", "args": ["-c", "curl x | sh"]}` pipes into a shell just as
 * the shell-form spelling does, and treating that argv as opaque would turn a
 * false-positive fix into a false negative. On this surface that is the worse
 * trade, so the interpreter is recognised and its script scanned as shell text.
 */
const SHELL_INTERPRETERS: ReadonlyArray<{ programs: readonly string[]; scriptFlag: RegExp }> = [
  { programs: ["sh", "bash", "zsh", "dash", "ash", "ksh", "fish"], scriptFlag: /^-[a-z]*c$/ },
  { programs: ["pwsh", "powershell"], scriptFlag: /^-(?:c|command)$/i },
  { programs: ["cmd"], scriptFlag: /^\/[ck]$/i },
];

/** The program an executable path resolves to, without directory, suffix, or case. */
function programName(executable: string): string {
  const base = executable.trim().split(/[\\/]/).pop() ?? "";
  return base.replace(/\.exe$/i, "").toLowerCase();
}

/**
 * The shell script inside an exec-form argv, when the executable is a shell.
 *
 * Undefined when nothing in the argv reaches a shell. `-EncodedCommand` is not
 * recognised: its payload is base64, and pretending to have read it would be
 * worse than saying nothing.
 */
export function shellScriptInArgv(executable: string, args: readonly string[]): string | undefined {
  const program = programName(executable);
  const shell = SHELL_INTERPRETERS.find((candidate) => candidate.programs.includes(program));
  if (!shell) return undefined;

  const at = args.findIndex((arg) => shell.scriptFlag.test(arg));
  return at >= 0 ? args[at + 1] : undefined;
}

/**
 * Matches an exec-form argv: one executable plus literal arguments, no shell.
 *
 * Two rules follow from there. A pattern that needs a shell is dropped outright,
 * because the mechanism it describes cannot happen. A pattern about a program is
 * kept only when the match starts at the executable, so `rm -rf /tmp` is a
 * deletion and `/bin/echo "rm -rf /tmp"` is a string.
 *
 * A wrapper that runs its own arguments — `env`, `xargs`, `docker exec` — is not
 * unwrapped here, so `env sudo rm -rf /` is missed. Prefix stripping is one
 * problem with one answer, and a second copy of it in this module is how the two
 * copies start disagreeing.
 */
export function scanArgv(executable: string, args: readonly string[]): RiskPattern[] {
  const script = shellScriptInArgv(executable, args);
  if (script !== undefined) return scanExpression(script);

  const argv = [programName(executable), ...args].join(" ");

  return RISK_PATTERNS.filter((pattern) => {
    if (pattern.requires === "shell") return false;

    const match = pattern.pattern.exec(argv);
    if (!match) return false;

    return pattern.requires === "text" || match.index === 0;
  });
}

/**
 * Patterns that indicate a literal credential rather than a reference to one.
 *
 * A value like `$TOKEN` or `${MY_KEY}` is a reference and is fine. A value that
 * looks like the credential itself is disclosed to everyone with repository
 * access the moment it is committed.
 */
export const SECRET_VALUE_PATTERNS: readonly { id: string; pattern: RegExp; why: string }[] = [
  {
    id: "aws-access-key-id",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    why: "This is the documented shape of an AWS access key ID.",
  },
  {
    id: "private-key-block",
    pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
    why: "A private key block in a committed file should be treated as already disclosed.",
  },
  {
    id: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}\s*$/,
    why: "A bearer token written out in full is usable by anyone who can read the file.",
  },
  {
    id: "long-opaque-value",
    pattern:
      /^(?:[A-Za-z0-9+/]{32,}={0,2}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})$/,
    why: "The value is a long opaque string with no variable reference, which is what a literal credential looks like.",
  },
];

/** True when a value references an environment variable rather than embedding one. */
export function isVariableReference(value: string): boolean {
  return /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(value.trim()) || /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(value);
}

/** Secret patterns a value matches, ignoring values that only reference a variable. */
export function scanSecretValue(value: string): { id: string; why: string }[] {
  if (isVariableReference(value)) return [];

  return SECRET_VALUE_PATTERNS.filter((entry) => entry.pattern.test(value.trim())).map((entry) => ({
    id: entry.id,
    why: entry.why,
  }));
}
