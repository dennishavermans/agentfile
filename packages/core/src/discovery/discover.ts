/**
 * Discovery orchestration.
 *
 * Reads whatever agent configuration a repository already has and normalises it
 * into the IR. This is what lets agentfile be useful in a repository that has
 * never heard of agentfile — the adoption path that matters most.
 *
 * The v1 contract is one source among the rest, not a precondition.
 */

import { join, relative } from "node:path";
import { CONTRACT_PATH, loadConfigurationFromContract, OVERRIDE_PATH } from "../adapters/contract-v1.js";
import { deriveAllDirectives } from "../analysis/derive.js";
import { type Diagnostic, diagnostic } from "../diagnostics/index.js";
import { type FileSystem, nodeFileSystem } from "../fs/index.js";
import { type AgentConfiguration, emptyConfiguration, type PlatformId, withoutAliases } from "../ir/index.js";
import { normalizePath } from "../paths/index.js";
import { discoverMcpServers, discoverSubagents } from "./agents-mcp.js";
import {
  checkInstructionImports,
  type DiscoveredInstructions,
  discoverAgentsMd,
  discoverClaudeMd,
  discoverClaudeRules,
  discoverCopilotInstructions,
  discoverCursorRules,
  discoverLegacyCursorRules,
} from "./instructions.js";
import { type RepositoryScan, type ScanOptions, scanRepository } from "./scan.js";
import { discoverSettings } from "./settings.js";
import { discoverSkills } from "./skills.js";

export interface DiscoverOptions extends ScanOptions {
  /** Absolute project root. */
  root: string;
  fs?: FileSystem;
  /** Reuse an existing scan instead of walking the tree again. */
  scan?: RepositoryScan;
  /** Read `ai/contract.yaml` as one of the sources. Default true. */
  includeContract?: boolean;
  /** Verify that instruction-file imports resolve. Default true. */
  checkImports?: boolean;
  /**
   * Derive atomic directives from the bullets in discovered prose. Default true.
   *
   * Without this, a repository whose configuration is all markdown has no
   * statements to compare, so duplicated rules across files cannot be found —
   * which is the main thing `doctor` exists to report. Derived directives carry
   * `origin: "derived"` so they are never mistaken for declared configuration.
   */
  deriveDirectives?: boolean;
}

export interface DiscoveryResult {
  configuration: AgentConfiguration;
  diagnostics: Diagnostic[];
  scan: RepositoryScan;
  /** Platforms that contributed at least one source file. */
  platforms: PlatformId[];
  /** True when an agentfile contract was found and read. */
  hasContract: boolean;
}

/** Discovers every supported configuration source in a repository. */
export function discover(options: DiscoverOptions): DiscoveryResult {
  const fs = options.fs ?? nodeFileSystem;
  const root = options.root;
  const scan = options.scan ?? scanRepository(root, fs, options);

  const configuration = emptyConfiguration(root);
  const diagnostics: Diagnostic[] = [];

  if (scan.truncated) {
    diagnostics.push(
      diagnostic({
        code: "AGF002",
        severity: "warning",
        message: "Repository scan was truncated, so the report may be incomplete",
        explanation: scan.truncationReason ?? "A scan limit was reached.",
        suggestion: "Raise the scan limits, or exclude large generated directories.",
        data: { reason: scan.truncationReason ?? "" },
      }),
    );
  }

  const instructionSources: DiscoveredInstructions[] = [
    discoverAgentsMd(root, scan, fs),
    discoverClaudeMd(root, scan, fs),
    discoverClaudeRules(root, scan, fs),
    discoverCursorRules(root, scan, fs),
    discoverLegacyCursorRules(root, scan, fs),
    discoverCopilotInstructions(root, scan, fs),
  ];

  for (const found of instructionSources) {
    configuration.instructions.push(...found.instructions);
    configuration.sources.push(...found.sources);
    diagnostics.push(...found.diagnostics);
  }

  const skills = discoverSkills(root, scan, fs);
  configuration.skills.push(...skills.skills);
  configuration.sources.push(...skills.sources);
  diagnostics.push(...skills.diagnostics);

  const subagents = discoverSubagents(root, scan, fs);
  configuration.subagents.push(...subagents.subagents);
  configuration.sources.push(...subagents.sources);
  diagnostics.push(...subagents.diagnostics);

  const mcp = discoverMcpServers(root, scan, fs);
  configuration.mcpServers.push(...mcp.mcpServers);
  configuration.sources.push(...mcp.sources);
  diagnostics.push(...mcp.diagnostics);

  // Hooks and permission rules: the two surfaces where configuration stops
  // describing what an agent should do and starts deciding what it may do.
  const settings = discoverSettings(root, scan, fs);
  configuration.hooks.push(...settings.hooks);
  configuration.permissions.push(...settings.permissions);
  configuration.settings.push(...settings.settings);
  configuration.sources.push(...settings.sources);
  diagnostics.push(...settings.diagnostics);

  // The agentfile contract, when there is one. Its absence is not a finding
  // here: discovery is expected to run on repositories that have never used
  // agentfile, which is the whole point of `doctor`.
  let hasContract = false;
  if (options.includeContract !== false) {
    const contractFile = scan.files.find((path) => path === CONTRACT_PATH);
    if (contractFile) {
      const loaded = loadConfigurationFromContract({
        root,
        fs,
        contractPath: CONTRACT_PATH,
        overridePath: OVERRIDE_PATH,
      });

      hasContract = loaded.ok;
      diagnostics.push(...loaded.diagnostics);

      configuration.project = loaded.configuration.project;
      configuration.directives.push(...loaded.configuration.directives);
      configuration.instructions.push(...loaded.configuration.instructions);
      configuration.skills.push(...loaded.configuration.skills);
      configuration.artifacts.push(...loaded.configuration.artifacts);
      configuration.docs.push(...loaded.configuration.docs);
      configuration.sources.push(...loaded.configuration.sources);
    }
  }

  if (options.checkImports !== false) {
    diagnostics.push(...checkInstructionImports(root, configuration.instructions, fs));
  }

  // A file that symlinks to another discovered instruction file is the same
  // text under a second name (CLAUDE.md → AGENTS.md is the documented pattern).
  // Marked before directives are derived, so the derived copies inherit it.
  markAliasedInstructions(configuration, root, fs);

  // Derived last, so it sees every discovered instruction including the
  // contract's override blocks. Alias twins are excluded: deriving the same
  // bullet twice would double every rule count downstream.
  if (options.deriveDirectives !== false) {
    configuration.directives.push(...deriveAllDirectives(withoutAliases(configuration.instructions)));
  }

  const platforms = [...new Set(configuration.sources.map((source) => source.platform))].sort();

  return { configuration, diagnostics, scan, platforms, hasContract };
}

/**
 * Sets `provenance.realFile` on instructions whose file is a symlink to another
 * discovered instruction file, so downstream analysis can treat the pair as one
 * text. A symlink to a file agentfile did not discover is left alone — there is
 * no twin to double-count.
 */
function markAliasedInstructions(configuration: AgentConfiguration, root: string, fs: FileSystem): void {
  const authored = new Set(configuration.instructions.map((instruction) => instruction.provenance.file));
  const resolved = new Map<string, string>();

  for (const instruction of configuration.instructions) {
    const file = instruction.provenance.file;

    let real = resolved.get(file);
    if (real === undefined) {
      const relativePath = normalizePath(relative(root, fs.realPath(join(root, file))));
      real = relativePath.startsWith("..") ? file : relativePath;
      resolved.set(file, real);
    }

    if (real !== file && authored.has(real)) {
      instruction.provenance.realFile = real;
      instruction.provenance.note ??= `symlink to ${real}`;
    }
  }
}
