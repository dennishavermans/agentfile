/**
 * Which capabilities a repository's configuration actually uses.
 *
 * Compatibility validation is only answerable once both halves are known: what
 * the configuration does, and what a target supports. The second half is the
 * capability registry. This is the first half, read straight off the IR — so a
 * new platform adapter contributes usages without this file changing.
 */

import { type Diagnostic, diagnostic, type Location } from "../diagnostics/index.js";
import type { AgentConfiguration, Instruction } from "../ir/index.js";
import { dirnameOf, ROOT_PATH } from "../paths/index.js";
import { diagnoseCapability } from "./diagnose.js";
import { capability, type FeatureId, featureMeta, type TargetId } from "./registry.js";

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

    if (target === "claude") diagnostics.push(...claudeShadowedAgentsMd(configuration));
  }

  return diagnostics;
}

// ─── Claude Code: AGENTS.md or CLAUDE.md, not both ──────────────────────────

/** Root files any one of which makes Claude Code skip a root AGENTS.md. */
const CLAUDE_MEMORY_FILES: readonly string[] = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];

/** The AGENTS.md files Claude Code reads natively from the repository root. */
const CLAUDE_AGENTS_FILES: readonly string[] = ["AGENTS.md", ".claude/AGENTS.md"];

/**
 * Resolves a CLAUDE.md `@path` import against the importing file, the way
 * Claude Code does: relative to the file, never to the working directory.
 * Home-relative and absolute imports cannot point at a repository file by a
 * project-relative path, so they resolve to nothing here.
 */
function resolveImport(from: string, target: string): string | undefined {
  if (target.startsWith("/") || target.startsWith("~")) return undefined;

  const segments: string[] = [];
  for (const segment of `${dirnameOf(from)}/${target}`.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return undefined;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

/** True when a CLAUDE.md-family file carries `file` into Claude Code's context. */
function bridges(memory: Instruction, file: string): boolean {
  if (memory.provenance.realFile === file) return true;
  return memory.imports?.some((target) => resolveImport(memory.provenance.file, target) === file) ?? false;
}

/**
 * AGF202 for a root AGENTS.md that Claude Code does not read because a
 * CLAUDE.md takes its place.
 *
 * Claude Code reads AGENTS.md natively, but only when no `CLAUDE.md`,
 * `.claude/CLAUDE.md` or `CLAUDE.local.md` exists; with one present it reads
 * that instead, and AGENTS.md reaches it only through an `@AGENTS.md` import or
 * a symlink. Measured on Claude Code 2.1.322 with a codeword in each file and
 * only the Write tool available, so a codeword could come from loaded context
 * and nowhere else: each of the three files suppressed a root `AGENTS.md`,
 * `CLAUDE.md` suppressed `.claude/AGENTS.md`, and an import or a symlink
 * brought it back.
 *
 * Generated memory files are left alone: `compile` writes the same rules into
 * CLAUDE.md, so Claude Code skipping AGENTS.md there loses nothing. Nested
 * AGENTS.md files are not judged, because their loading was not measured.
 */
export function claudeShadowedAgentsMd(configuration: AgentConfiguration): Diagnostic[] {
  const memories = configuration.instructions.filter(
    (instruction) =>
      instruction.provenance.platform === "claude" && CLAUDE_MEMORY_FILES.includes(instruction.provenance.file),
  );
  if (!memories.length) return [];

  const row = capability("claude", "instructions.agents-md");
  const sourceLine = row.source ? `\n\nTarget documentation:\n  ${row.source}` : "";
  const diagnostics: Diagnostic[] = [];

  const agentsFiles = configuration.instructions.filter(
    (instruction) =>
      instruction.provenance.platform === "agents-md" && CLAUDE_AGENTS_FILES.includes(instruction.provenance.file),
  );

  for (const agents of agentsFiles) {
    const file = agents.provenance.file;
    if (memories.some((memory) => bridges(memory, file))) continue;

    const authored = memories.filter((memory) => memory.provenance.origin !== "generated");
    if (!authored.length) continue;

    const names = authored.map((memory) => memory.provenance.file);
    const shadowedBy = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

    diagnostics.push(
      diagnostic({
        code: "AGF202",
        message: `${file} is not read by Claude Code here: ${shadowedBy} ${names.length === 1 ? "takes" : "take"} its place`,
        explanation: [
          "Claude Code reads AGENTS.md natively only when no CLAUDE.md, .claude/CLAUDE.md or",
          `CLAUDE.local.md exists. Here ${shadowedBy} ${names.length === 1 ? "does" : "do"}, and nothing imports ${file}`,
          "or links to it, so a Claude Code session sees the CLAUDE.md side and none of",
          `${file}. Every other agent that reads AGENTS.md still sees it, which is how the`,
          "two drift apart without anyone noticing.",
          "",
          "Claude Code documents a per-user setting that reads both files; a repository",
          `cannot set it.${sourceLine}`,
        ].join("\n"),
        suggestion: `Add \`@${file}\` to ${names[0]} so Claude Code reads both, or replace ${names[0]} with a symlink to ${file} if they should be one text.`,
        location: { file },
        related: authored.map((memory) => ({
          location: { file: memory.provenance.file },
          message: "read by Claude Code in place of AGENTS.md",
        })),
        data: { target: "claude", feature: "instructions.agents-md", level: "shadowed", subject: file },
      }),
    );
  }

  return diagnostics;
}
