/**
 * Diagnostic code registry.
 *
 * The taxonomy is organised in bands. Band boundaries and the codes named in the
 * v2 rework brief are FROZEN — consumers (CI, editors, other tooling) match on
 * these strings, so this registry is APPEND-ONLY:
 *
 *   • never change the meaning of an existing code
 *   • never renumber
 *   • never remove a code; if it becomes obsolete, mark it `status: "retired"`
 *
 *   AGF0xx  configuration & structure
 *   AGF1xx  skills
 *   AGF2xx  targets & compatibility
 *   AGF3xx  instructions & resolution
 *   AGF4xx  context budget
 *   AGF5xx  security
 *   AGF6xx  behavioral evaluation
 *
 * `status` records whether anything emits the code yet. Reserved codes exist so
 * the taxonomy is stable before the subsystem that needs them lands; they are
 * documented, testable, and never emitted.
 */

export type Severity = "error" | "warning" | "info";

export type DiagnosticBand =
  | "configuration"
  | "skills"
  | "targets"
  | "resolution"
  | "context"
  | "security"
  | "evaluation";

export type CodeStatus = "active" | "reserved" | "retired";

export interface DiagnosticCodeMeta {
  /** Stable slug, used in docs URLs and machine output. Kebab-case. */
  readonly name: string;
  /** One-line summary of the problem class. Not the rendered message. */
  readonly title: string;
  readonly band: DiagnosticBand;
  /** Severity used when the emitter does not override it. */
  readonly defaultSeverity: Severity;
  readonly status: CodeStatus;
}

export const DIAGNOSTIC_CODES = {
  // ─── AGF0xx — configuration & structure ──────────────────────────────────
  AGF001: {
    name: "invalid-configuration",
    title: "Invalid configuration",
    band: "configuration",
    defaultSeverity: "error",
    status: "active",
  },
  AGF002: {
    name: "missing-configuration-file",
    title: "Configuration file not found",
    band: "configuration",
    defaultSeverity: "error",
    status: "active",
  },
  AGF003: {
    name: "unparsable-file",
    title: "File could not be parsed",
    band: "configuration",
    defaultSeverity: "error",
    status: "active",
  },
  AGF004: {
    name: "broken-file-reference",
    title: "Referenced file does not exist",
    band: "configuration",
    defaultSeverity: "error",
    status: "active",
  },
  AGF005: {
    name: "unused-suppression",
    title: "Suppression directive silences nothing",
    band: "configuration",
    // A warning, not an error: a stale suppression is untidy, not broken, and
    // failing a build over one would push people towards blanket directives.
    defaultSeverity: "warning",
    status: "active",
  },
  AGF006: {
    name: "scan-truncated",
    title: "Repository scan stopped early, so the report is incomplete",
    band: "configuration",
    // A warning about the report rather than about the repository. Nothing in
    // the configuration is wrong; agentfile simply did not read all of it, and
    // every "nothing matches" and "does not exist" below it is weaker as a
    // result.
    defaultSeverity: "warning",
    status: "active",
  },

  // ─── AGF1xx — skills ────────────────────────────────────────────────────
  AGF101: {
    name: "invalid-skill",
    title: "Invalid skill",
    band: "skills",
    defaultSeverity: "error",
    status: "active",
  },
  AGF102: {
    name: "missing-skill-metadata",
    title: "Missing skill metadata",
    band: "skills",
    // Measured on Claude Code 2.1.238: a SKILL.md with no frontmatter at all
    // still loads, is listed with its first heading standing in for the
    // missing description, and resolves when invoked by name. Missing metadata
    // degrades discovery; it does not break the skill.
    defaultSeverity: "warning",
    status: "active",
  },
  AGF103: {
    name: "skill-routing-quality",
    title: "Skill cannot be routed on reliably",
    band: "skills",
    defaultSeverity: "warning",
    status: "active",
  },
  AGF104: {
    name: "skill-context-bloat",
    title: "Skill is larger than the specification recommends",
    band: "skills",
    defaultSeverity: "warning",
    status: "active",
  },
  AGF105: {
    name: "skill-resource-layout",
    title: "Skill resources are not laid out as the specification expects",
    band: "skills",
    defaultSeverity: "info",
    status: "active",
  },
  AGF106: {
    name: "skill-portability",
    title: "Skill uses features that do not travel between platforms",
    band: "skills",
    defaultSeverity: "warning",
    status: "active",
  },

  // ─── AGF2xx — targets & compatibility ───────────────────────────────────
  AGF201: {
    name: "unsupported-target-feature",
    title: "Feature is not supported by this target",
    band: "targets",
    defaultSeverity: "error",
    status: "active",
  },
  AGF202: {
    name: "degraded-target-feature",
    title: "Feature is degraded or emulated on this target",
    band: "targets",
    defaultSeverity: "warning",
    status: "active",
  },
  AGF203: {
    name: "unknown-target-feature",
    title: "Target support for this feature is unknown",
    band: "targets",
    defaultSeverity: "info",
    status: "active",
  },
  AGF204: {
    name: "compile-would-overwrite",
    title: "Compilation output would overwrite a file agentfile does not own",
    band: "targets",
    defaultSeverity: "error",
    status: "active",
  },
  AGF205: {
    name: "mutual-compile-sources",
    title: "Two targets would compile from each other",
    band: "targets",
    defaultSeverity: "warning",
    status: "active",
  },
  AGF206: {
    name: "instruction-file-too-large",
    title: "Instruction file exceeds a target's documented size limit",
    band: "targets",
    defaultSeverity: "warning",
    status: "active",
  },

  // ─── AGF3xx — instructions & resolution ─────────────────────────────────
  AGF301: {
    name: "conflicting-instructions",
    title: "Conflicting instructions",
    band: "resolution",
    defaultSeverity: "error",
    status: "reserved",
  },
  AGF302: {
    name: "duplicate-instruction",
    title: "Duplicate instruction",
    band: "resolution",
    defaultSeverity: "warning",
    status: "active",
  },
  AGF303: {
    name: "unreachable-configuration",
    title: "Configuration never applies",
    band: "resolution",
    defaultSeverity: "warning",
    status: "active",
  },
  AGF304: {
    name: "inconsistent-scope",
    title: "Same instruction, different scope per platform",
    band: "resolution",
    defaultSeverity: "warning",
    status: "active",
  },
  AGF305: {
    name: "near-duplicate-instruction",
    title: "Near-duplicate instruction",
    band: "resolution",
    defaultSeverity: "warning",
    status: "active",
  },

  AGF306: {
    name: "unmatchable-glob-syntax",
    title: "Glob is written in a form the platform will not match",
    band: "resolution",
    // A warning, not an error: the file is well-formed and the intent is
    // obvious. What is wrong is that the platform reading it will not match
    // the pattern, so the rule silently never attaches.
    defaultSeverity: "warning",
    status: "active",
  },

  // ─── AGF4xx — context budget ────────────────────────────────────────────
  AGF401: {
    name: "context-overload",
    title: "Context budget exceeded",
    band: "context",
    defaultSeverity: "warning",
    status: "active",
  },

  // ─── AGF5xx — security ──────────────────────────────────────────────────
  AGF501: {
    name: "security-issue",
    title: "Security issue",
    band: "security",
    defaultSeverity: "error",
    status: "active",
  },

  AGF502: {
    name: "dangerous-hook",
    title: "Hook runs automatically and carries risk",
    band: "security",
    defaultSeverity: "warning",
    status: "active",
  },
  AGF503: {
    name: "untrusted-mcp-server",
    title: "MCP server is not pinned or not encrypted",
    band: "security",
    defaultSeverity: "warning",
    status: "active",
  },
  AGF504: {
    name: "secret-in-configuration",
    title: "Committed configuration contains a credential",
    band: "security",
    defaultSeverity: "error",
    status: "active",
  },
  AGF505: {
    name: "prompt-injection-indicator",
    title: "Instruction text contains hidden or overriding content",
    band: "security",
    defaultSeverity: "warning",
    status: "active",
  },
  AGF506: {
    name: "permission-rule-problem",
    title: "Permission rule does not grant what it appears to",
    band: "security",
    defaultSeverity: "warning",
    status: "active",
  },

  // ─── AGF6xx — behavioral evaluation ─────────────────────────────────────
  AGF601: {
    name: "behavioral-regression",
    title: "Behavioral regression",
    band: "evaluation",
    defaultSeverity: "error",
    status: "reserved",
  },
  AGF602: {
    name: "eval-assertion-failed",
    title: "Behavioral eval assertion failed",
    band: "evaluation",
    defaultSeverity: "error",
    status: "active",
  },
} as const satisfies Record<string, DiagnosticCodeMeta>;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_CODES;

/** Metadata for a code. Throws on an unregistered code — codes are a closed set. */
export function diagnosticMeta(code: DiagnosticCode): DiagnosticCodeMeta {
  return DIAGNOSTIC_CODES[code];
}

/** All registered codes, sorted, for docs generation and tests. */
export function allDiagnosticCodes(): DiagnosticCode[] {
  return (Object.keys(DIAGNOSTIC_CODES) as DiagnosticCode[]).sort();
}
