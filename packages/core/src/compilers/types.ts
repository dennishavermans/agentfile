/**
 * The compiler contract.
 *
 * A target compiler is a pure function from the normalized configuration to a
 * plan: which files would exist and what they would contain. It never touches
 * the filesystem — planning, drift detection, writing, and the manifest are the
 * host's job (`host.ts`), so every compiler stays unit-testable and every write
 * goes through one safety check instead of four.
 *
 * This is the shape multi-target generators converge on (OpenAPI Generator's
 * one-model-many-generators, GraphQL codegen's plugins-return-content): the core
 * owns normalization and I/O, the adapter owns only the mapping.
 */

import type { TargetId } from "../capabilities/index.js";
import type { Diagnostic } from "../diagnostics/index.js";
import type { AgentConfiguration } from "../ir/index.js";

/** A file a compiler wants to exist, before markers and safety checks. */
export interface PlannedFile {
  /** Project-relative output path. */
  path: string;
  /** Content without the generated-file marker; the host applies it. */
  content: string;
  /** What produced the file, recorded in the manifest, e.g. "claude". */
  source: string;
}

/**
 * Configuration the compiler could not carry, stated instead of dropped.
 *
 * This is for compiler limitations — the target could express it, agentfile
 * does not translate it (yet), or it is already in the target's native form.
 * Target limitations are diagnostics (`AGF201`–`AGF203`), not entries here.
 */
export interface NotCarried {
  /** What was left behind, e.g. "skills", "model-selected instructions". */
  kind: string;
  count: number;
  /** Why, phrased for the developer deciding whether it matters. */
  reason: string;
}

export interface CompilePlan {
  target: TargetId;
  files: PlannedFile[];
  /** Fidelity findings: what this target cannot express, per the registry. */
  diagnostics: Diagnostic[];
  notCarried: NotCarried[];
}

export interface TargetCompiler {
  id: TargetId;
  /** Pure. Reads the configuration, returns a plan, touches nothing. */
  compile(configuration: AgentConfiguration): CompilePlan;
}
