/**
 * What a compile loses, stated before it happens.
 *
 * Two different things get lost in multi-target compilation, and they must not
 * be reported as one:
 *
 *   • **The target cannot express it.** That is a capability fact, backed by a
 *     registry row with a documentation URL, and it becomes `AGF201`
 *     (unsupported), `AGF202` (degraded/emulated), or `AGF203` (unverified) via
 *     the same `diagnoseCapability` every other command uses.
 *   • **agentfile does not translate it.** The target could express it; this
 *     compiler does not carry it (yet), or it is already in the target's native
 *     form. Claiming the *target* is deficient there would be a lie, so these
 *     become `NotCarried` entries with the real reason.
 *
 * The distinction is the difference between "drop Cursor from your targets" and
 * "author the skill in Cursor's own directory" — collapsing them would point
 * developers at the wrong fix.
 */

import { capability, diagnoseCapability, type FeatureId, type TargetId } from "../capabilities/index.js";
import type { Diagnostic, Location } from "../diagnostics/index.js";
import type { AgentConfiguration, Provenance } from "../ir/index.js";
import type { SelectedSources } from "./sources.js";
import type { NotCarried } from "./types.js";

function locationOf(provenance: Provenance): Location {
  return { file: provenance.file, line: provenance.line };
}

/** The same carry-rules `selectSources` applies, for the non-instruction kinds. */
function carriable<T extends { provenance: Provenance }>(entries: readonly T[], target: TargetId): T[] {
  return entries.filter(
    (entry) =>
      entry.provenance.platform !== target &&
      entry.provenance.origin !== "generated" &&
      entry.provenance.scope !== "local",
  );
}

export interface FidelityReport {
  diagnostics: Diagnostic[];
  notCarried: NotCarried[];
}

/**
 * Fidelity findings for compiling `configuration` to `target`.
 *
 * `sources` is what the compiler actually selected, so nothing is reported for
 * content that was never a candidate — a hook that already lives in the
 * target's own settings file is not "lost".
 */
export function fidelity(
  configuration: AgentConfiguration,
  target: TargetId,
  sources: SelectedSources,
): FidelityReport {
  const diagnostics: Diagnostic[] = [];
  const notCarried: NotCarried[] = [];

  const diagnose = (feature: FeatureId, subject: string, location?: Location) => {
    const finding = diagnoseCapability(target, feature, { subject, location });
    if (finding) diagnostics.push(finding);
  };

  // ─── Instruction features the compile is actually using ───────────────────
  if (sources.byPaths.length) {
    diagnose(
      "instructions.path-scoped",
      `${sources.byPaths.length} path-scoped instruction${sources.byPaths.length === 1 ? "" : "s"}`,
      locationOf(sources.byPaths[0].provenance),
    );
  }

  if (sources.byDirectory.size) {
    const first = [...sources.byDirectory.values()][0][0];
    diagnose(
      "instructions.nested",
      `${sources.byDirectory.size} directory-scoped instruction file${sources.byDirectory.size === 1 ? "" : "s"}`,
      locationOf(first.provenance),
    );
  }

  const carried = [...sources.always, ...[...sources.byDirectory.values()].flat(), ...sources.byPaths];
  const withImports = carried.filter((entry) => entry.imports?.length);
  if (withImports.length) {
    diagnose(
      "instructions.imports",
      `@path imports in ${withImports[0].provenance.file}`,
      locationOf(withImports[0].provenance),
    );
  }

  if (sources.modelSelected.length) {
    notCarried.push({
      kind: "model-selected and manual instructions",
      count: sources.modelSelected.length,
      reason:
        "These load on the agent's judgement or on explicit invocation. An unconditional " +
        "instruction file cannot express that gate, so carrying them would change when they apply.",
    });
  }

  // ─── Kinds this compiler does not emit ─────────────────────────────────────
  const kinds: Array<{ feature: FeatureId; kind: string; count: number; native: string }> = [
    {
      feature: "skills",
      kind: "skills",
      count: carriable(configuration.skills, target).length,
      native: "skill directories",
    },
    {
      feature: "subagents",
      kind: "subagents",
      count: carriable(configuration.subagents, target).length,
      native: "subagent files",
    },
    { feature: "hooks", kind: "hooks", count: carriable(configuration.hooks, target).length, native: "settings files" },
    {
      feature: "mcp.project-config",
      kind: "MCP servers",
      count: carriable(configuration.mcpServers, target).length,
      native: "MCP configuration",
    },
    {
      feature: "permissions",
      kind: "permission rules",
      count: carriable(configuration.permissions, target).length,
      native: "settings files",
    },
  ];

  for (const entry of kinds) {
    if (!entry.count) continue;

    if (capability(target, entry.feature).level === "supported") {
      notCarried.push({
        kind: entry.kind,
        count: entry.count,
        reason:
          `agentfile does not compile ${entry.kind} yet. The target reads its own ${entry.native} natively, ` +
          "so author them there, or keep maintaining them where they are.",
      });
    } else {
      diagnose(entry.feature, `${entry.count} ${entry.kind}`);
    }
  }

  return { diagnostics, notCarried };
}
