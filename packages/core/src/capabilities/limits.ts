/**
 * Documented size limits on instruction files.
 *
 * A feature a target does not support is `AGF201`–`AGF203`: the target reads the
 * file and cannot act on part of it. This is a different failure and deserves
 * its own code. The target reads the file, supports everything in it, and stops
 * partway through because the file is longer than it will accept — so the rules
 * past the cut are not unsupported, they are unread, and nothing says so.
 *
 * Only limits a platform actually documents belong here. A guess would produce
 * a warning a developer cannot verify and cannot act on with confidence.
 */

import { type Diagnostic, diagnostic } from "../diagnostics/index.js";
import type { AgentConfiguration } from "../ir/index.js";
import { withoutAliases } from "../ir/index.js";
import type { TargetId } from "./registry.js";

export interface InstructionSizeLimit {
  target: TargetId;
  /** Filename the limit applies to. */
  file: string;
  /** Maximum bytes the target reads. */
  bytes: number;
  /** What happens past the limit, in the platform's own terms. */
  behaviour: string;
  /** Where the limit is documented. */
  source: string;
}

/**
 * Limits agentfile knows about.
 *
 * Codex truncates `AGENTS.md` at 32 KiB. It is the only instruction-file size
 * limit currently documented by a platform agentfile targets; the others accept
 * a file of any size and simply spend the context on it, which is `AGF401`.
 */
export const INSTRUCTION_SIZE_LIMITS: readonly InstructionSizeLimit[] = [
  {
    target: "codex",
    file: "AGENTS.md",
    bytes: 32 * 1024,
    behaviour: "the file is truncated at 32 KiB and the rest is never read",
    source: "https://github.com/openai/codex",
  },
];

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
}

/**
 * AGF206 for an instruction file larger than a named target will read.
 *
 * Measured in bytes rather than characters, because the limit is a byte limit
 * and a repository whose rules contain non-ASCII would otherwise be told it is
 * under a limit it is over.
 */
export function instructionSizeDiagnostics(
  configuration: AgentConfiguration,
  targets: readonly TargetId[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const limit of INSTRUCTION_SIZE_LIMITS) {
    if (!targets.includes(limit.target)) continue;

    for (const instruction of withoutAliases(configuration.instructions)) {
      const path = instruction.provenance.file;
      if (path !== limit.file && !path.endsWith(`/${limit.file}`)) continue;

      const size = Buffer.byteLength(instruction.body, "utf8");
      if (size <= limit.bytes) continue;

      const excess = size - limit.bytes;
      diagnostics.push(
        diagnostic({
          code: "AGF206",
          message: `${path} is ${formatBytes(size)}, past the ${formatBytes(limit.bytes)} ${limit.target} reads`,
          explanation: [
            `On ${limit.target}, ${limit.behaviour}.`,
            "",
            `That is ${formatBytes(excess)} of instructions the agent never sees, with no error and`,
            "no indication in the session that anything was dropped. Rules near the end of",
            "the file are the ones that silently stop applying.",
            "",
            `Documented at:\n  ${limit.source}`,
          ].join("\n"),
          suggestion:
            "Move the detail into skills or path-scoped files, which load only when they are relevant, and keep the root file to what must apply everywhere.",
          location: { file: path },
          data: {
            target: String(limit.target),
            bytes: size,
            limit: limit.bytes,
            excess,
          },
        }),
      );
    }
  }

  return diagnostics;
}
