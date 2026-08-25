/**
 * Static security analysis, assembled.
 *
 * Three commitments, all from the rework brief, and all enforced here rather
 * than promised in prose:
 *
 *   1. **Nothing untrusted is executed.** Skills, hooks, scripts, and MCP
 *      configuration are read as text. No shell is spawned, no interpreter is
 *      invoked, no network request is made.
 *   2. **Coverage is reported, not implied.** The result says which surfaces were
 *      analysed and which files could not be read. "No findings" then means
 *      something specific instead of something reassuring.
 *   3. **Risk is described; safety is never claimed.** There is no pass, no
 *      score, and no clean bill of health — only findings, each with a stated
 *      reason a reader can disagree with.
 */

import type { Diagnostic } from "../diagnostics/index.js";
import type { FileSystem } from "../fs/index.js";
import type { AgentConfiguration } from "../ir/index.js";
import { inspectSkillResources } from "../skills/index.js";
import { auditHooks } from "./hooks.js";
import { auditInstructionText } from "./injection.js";
import { auditMcpServers } from "./mcp.js";
import { auditPermissions } from "./permissions.js";

/** A surface the audit covers, and how much of it was present. */
export interface AuditSurface {
  /** Stable name, used in output and JSON. */
  name: "skills" | "hooks" | "mcp-servers" | "permissions" | "instructions";
  /** How many nodes of this kind were analysed. */
  analysed: number;
  /** What the surface covers, for a reader who needs to know what was not checked. */
  description: string;
}

export interface AuditResult {
  diagnostics: Diagnostic[];
  surfaces: AuditSurface[];
  /** Files read during inspection, so a clean result can say what it covered. */
  inspectedFiles: string[];
  /** Files not read, with the reason. Never silent. */
  skippedFiles: Array<{ file: string; reason: string }>;
}

export interface AuditOptions {
  /** Absolute project root. */
  root: string;
  fs: FileSystem;
  /** Project-relative paths of every scanned file. */
  files: readonly string[];
}

/**
 * Runs every static security check.
 *
 * Ordering is by surface so output groups sensibly; the caller sorts
 * diagnostics for display.
 */
export function auditConfiguration(configuration: AgentConfiguration, options: AuditOptions): AuditResult {
  const skills = inspectSkillResources(configuration, { root: options.root, fs: options.fs });

  const diagnostics = [
    ...skills.diagnostics,
    ...auditHooks(configuration, { files: options.files }),
    ...auditMcpServers(configuration),
    ...auditPermissions(configuration),
    ...auditInstructionText(configuration),
  ];

  const surfaces: AuditSurface[] = [
    {
      name: "skills",
      analysed: configuration.skills.length,
      description: "bundled scripts matched against documented risk patterns, never executed",
    },
    {
      name: "hooks",
      analysed: configuration.hooks.length,
      description: "commands and endpoints that run automatically when their event fires",
    },
    {
      name: "mcp-servers",
      analysed: configuration.mcpServers.length,
      description: "what each server runs or connects to, and whether it is pinned",
    },
    {
      name: "permissions",
      analysed: configuration.permissions.length + configuration.settings.length,
      description: "rules that do not grant what they appear to, and permission modes",
    },
    {
      name: "instructions",
      analysed: configuration.instructions.length + configuration.skills.length + configuration.subagents.length,
      description: "hidden characters and wording that addresses the agent's own instructions",
    },
  ];

  return {
    diagnostics,
    surfaces,
    inspectedFiles: skills.inspected,
    // Files that are simply not executable content are not a coverage gap.
    skippedFiles: skills.skipped.filter((entry) => entry.reason !== "not executable content"),
  };
}

/**
 * What a result with no findings does and does not mean.
 *
 * Kept here rather than in the command so every consumer that reports a clean
 * audit says the same thing.
 */
export const NO_FINDINGS_CAVEAT =
  "No findings means no pattern in agentfile's set matched the configuration it could read. " +
  "It is not a statement that the configuration is safe: static analysis cannot see intent, " +
  "cannot follow a variable, and cannot read a binary. Nothing was executed to produce this result.";
