/**
 * `agentfile.yaml` — the tool's own configuration.
 *
 * Everything here can also be a command-line flag, and a repository that never
 * writes this file loses nothing. What the file buys is agreement: a pre-commit
 * hook, a CI job and an editor cannot share a `--budget 2000 --similarity 0.75`
 * they each spell out separately, and a tool whose whole argument is "keep one
 * source of truth" should not need its own settings repeated in three places.
 *
 * Three rules shape the schema:
 *
 *   • **Optional, and strict.** No file is fine. A file with a key nobody
 *     recognises is an error, not a shrug — a silently ignored `sevrity:` block
 *     is a setting the team believes is applied and is not, which is the exact
 *     failure agentfile exists to report.
 *   • **Data, never behaviour.** No globs that execute, no paths that get run,
 *     no extends-from-a-URL. The file is read with the same parser used for
 *     every other YAML in the repository, and nothing in it is executed.
 *   • **Flags win.** Configuration is the default; an argument typed at the
 *     prompt is a deliberate override of it.
 */

import { z } from "zod";
import { allDiagnosticCodes } from "../diagnostics/index.js";

/** The filename, at the repository root. */
export const CONFIG_FILE = "agentfile.yaml";

/** Schema version. Bumped only for a breaking change to the file's shape. */
export const CONFIG_VERSION = 1;

const SEVERITIES = ["error", "warning", "info", "off"] as const;

/** Severity a code can be given, plus `off` to silence it repository-wide. */
export type ConfiguredSeverity = (typeof SEVERITIES)[number];

const diagnosticCode = z.string().refine((value) => (allDiagnosticCodes() as string[]).includes(value), {
  message: "is not a diagnostic code agentfile knows about",
});

export const AgentfileConfigSchema = z
  .object({
    version: z.literal(CONFIG_VERSION).optional(),

    /**
     * Directory names the scan skips, added to the built-in list.
     *
     * Names, not globs. The scan matches directory names as it walks, which is
     * what keeps it linear; accepting globs here would promise a filter the
     * scanner cannot apply.
     */
    ignore: z.array(z.string().min(1)).optional(),

    /**
     * Per-code severity, including `off`.
     *
     * `off` is a repository-wide decision recorded in a committed file, which
     * is a different thing from an `agentfile-disable` comment: the comment
     * silences one finding at one line and is reported when it goes stale.
     */
    severity: z.record(diagnosticCode, z.enum(SEVERITIES)).optional(),

    /** Always-loaded context budget, in estimated tokens. */
    budget: z.number().positive().optional(),

    /** Near-duplicate similarity threshold, 0–1. */
    similarity: z.number().gt(0).lte(1).optional(),

    /** Compile targets used when `--target` is not given. */
    targets: z.array(z.string().min(1)).optional(),

    /** Fail the run when the warning count exceeds this. */
    maxWarnings: z.number().int().min(0).optional(),

    /** Honour `agentfile-disable` directives. Defaults to true. */
    suppressions: z.boolean().optional(),
  })
  // Unknown keys are rejected rather than ignored: a typo in a settings file is
  // indistinguishable from a setting that does nothing.
  .strict();

export type AgentfileConfig = z.infer<typeof AgentfileConfigSchema>;

/** The configuration used when the repository has no file. */
export const EMPTY_CONFIG: AgentfileConfig = {};
