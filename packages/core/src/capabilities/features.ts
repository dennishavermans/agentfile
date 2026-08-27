/**
 * Which capabilities a repository's configuration actually uses.
 *
 * Compatibility validation is only answerable once both halves are known: what
 * the configuration does, and what a target supports. The second half is the
 * capability registry. This is the first half, read straight off the IR — so a
 * new platform adapter contributes usages without this file changing.
 */

import type { Diagnostic, Location } from "../diagnostics/index.js";
import type { AgentConfiguration } from "../ir/index.js";
import { ROOT_PATH } from "../paths/index.js";
import { diagnoseCapability } from "./diagnose.js";
import { type FeatureId, featureMeta, type TargetId } from "./registry.js";

export interface FeatureUsage {
  feature: FeatureId;
  /** What uses it, phrased to drop into a diagnostic message. */
  subject: string;
  location?: Location;
}

function locationOf(provenance: { file: string; line?: number }): Location {
  return { file: provenance.file, line: provenance.line };
}

/** Every capability the configuration relies on, with somewhere to point. */
export function featuresUsed(configuration: AgentConfiguration): FeatureUsage[] {
  const usages: FeatureUsage[] = [];

  for (const instruction of configuration.instructions) {
    const location = locationOf(instruction.provenance);
    const label = instruction.title
      ? `instructions "${instruction.title}"`
      : `instructions in ${instruction.provenance.file}`;

    if (instruction.applies.kind === "always") {
      usages.push({ feature: "instructions.root", subject: label, location });
    } else if (instruction.applies.kind === "directory") {
      const feature = instruction.applies.directory === ROOT_PATH ? "instructions.root" : "instructions.nested";
      usages.push({ feature, subject: label, location });
    } else if (instruction.applies.kind === "paths") {
      usages.push({ feature: "instructions.path-scoped", subject: label, location });
    }

    if (instruction.imports?.length) {
      usages.push({ feature: "instructions.imports", subject: label, location });
    }
  }

  // Path-scoped directives count too: a declared rule list scoped by globs asks
  // the same thing of a target as a path-scoped instruction file.
  for (const directive of configuration.directives) {
    if (directive.applies.kind !== "paths") continue;
    if (directive.provenance.origin !== "declared") continue;
    usages.push({
      feature: "instructions.path-scoped",
      subject: `rule "${directive.text}"`,
      location: locationOf(directive.provenance),
    });
  }

  for (const source of configuration.sources) {
    if (source.platform === "agents-md") {
      usages.push({ feature: "instructions.agents-md", subject: source.path, location: { file: source.path } });
    }
  }

  for (const skill of configuration.skills) {
    const location = locationOf(skill.provenance);
    usages.push({ feature: "skills", subject: `skill "${skill.name}"`, location });

    if (skill.resources.length) {
      usages.push({ feature: "skills.resources", subject: `skill "${skill.name}"`, location });
    }
    if (skill.allowedTools?.length) {
      usages.push({ feature: "skills.allowed-tools", subject: `skill "${skill.name}"`, location });
    }
  }

  for (const subagent of configuration.subagents) {
    usages.push({
      feature: "subagents",
      subject: `subagent "${subagent.name}"`,
      location: locationOf(subagent.provenance),
    });
  }

  for (const hook of configuration.hooks) {
    usages.push({ feature: "hooks", subject: `${hook.event} hook`, location: locationOf(hook.provenance) });
  }

  for (const server of configuration.mcpServers) {
    usages.push({
      feature: "mcp.project-config",
      subject: `MCP server "${server.name}"`,
      location: locationOf(server.provenance),
    });
  }

  for (const permission of configuration.permissions) {
    usages.push({
      feature: "permissions",
      subject: `permission rule "${permission.rule}"`,
      location: locationOf(permission.provenance),
    });
  }

  return usages;
}

/** Usages grouped by feature, features in registry order. */
export function groupFeatureUsage(usages: readonly FeatureUsage[]): Map<FeatureId, FeatureUsage[]> {
  const grouped = new Map<FeatureId, FeatureUsage[]>();

  for (const usage of usages) {
    const list = grouped.get(usage.feature);
    if (list) list.push(usage);
    else grouped.set(usage.feature, [usage]);
  }

  return new Map([...grouped].sort((a, b) => a[0].localeCompare(b[0])));
}

/** How many other usages a compatibility diagnostic points at beyond the first. */
const RELATED_LIMIT = 4;

/**
 * Compatibility findings for a set of targets.
 *
 * One diagnostic per target and feature, not one per node: a repository with
 * thirty skills compiled for a target that has none needs one clear error, not
 * thirty identical ones.
 */
export function compatibilityDiagnostics(
  configuration: AgentConfiguration,
  targets: readonly TargetId[],
): Diagnostic[] {
  const grouped = groupFeatureUsage(featuresUsed(configuration));
  const diagnostics: Diagnostic[] = [];

  for (const target of [...targets].sort()) {
    for (const [feature, usages] of grouped) {
      const first = usages[0];
      const others = usages.slice(1, 1 + RELATED_LIMIT);

      const subject = usages.length === 1 ? first.subject : `${first.subject} (and ${usages.length - 1} more)`;

      const found = diagnoseCapability(target, feature, { subject, location: first.location });
      if (!found) continue;

      diagnostics.push({
        ...found,
        related: others
          .filter((usage) => usage.location)
          .map((usage) => ({
            location: usage.location as Location,
            message: `also uses ${featureMeta(feature)?.title ?? feature}`,
          })),
        data: { ...found.data, usages: usages.length },
      });
    }
  }

  return diagnostics;
}
