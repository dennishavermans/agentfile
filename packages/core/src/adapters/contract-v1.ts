/**
 * Contract v1 to IR adapter.
 *
 * `ai/contract.yaml` is not deprecated by v2 — it becomes *one source* feeding
 * the normalized representation, exactly like AGENTS.md or SKILL.md will. That
 * is what keeps the existing format, its tests, and its users intact while the
 * layers above it stop depending on its shape.
 *
 * Nothing in here mutates or rewrites the contract. It reads, maps, and reports.
 */

import { join } from "node:path";
import { type Diagnostic, diagnostic } from "../diagnostics/index.js";
import { type FileSystem, nodeFileSystem } from "../fs/index.js";
import {
  type AgentConfiguration,
  ALWAYS,
  type ArtifactEntry,
  appliesToDirectory,
  appliesToPaths,
  type Directive,
  type DocEntry,
  emptyConfiguration,
  type Instruction,
  MODEL_SELECTED,
  nodeId,
  type Provenance,
  type SkillEntry,
  type SourceFile,
  slugify,
} from "../ir/index.js";
import { normalizePath, ROOT_PATH } from "../paths/index.js";
import { renderSkillMarkdown } from "../renderer.js";
import { type Contract, ContractSchema, type Override, OverrideSchema } from "../schema.js";
import { loadYamlSource, schemaIssuesToDiagnostics, type YamlSource } from "../yaml/index.js";

/** Default location of the v1 contract, relative to the project root. */
export const CONTRACT_PATH = "ai/contract.yaml";
/** Default location of the v1 per-folder override file. */
export const OVERRIDE_PATH = "ai.override.yaml";

export interface ContractAdapterOptions {
  /** Absolute project root. */
  root: string;
  /** Project-relative contract path. Defaults to `ai/contract.yaml`. */
  contractPath?: string;
  /** Project-relative override path. Defaults to `ai.override.yaml`. */
  overridePath?: string;
  /** Directory this configuration governs. Defaults to the project root. */
  directory?: string;
  /** Injected for testing. Defaults to the real filesystem. */
  fs?: FileSystem;
}

function provenanceFor(file: string, line: number | undefined, directory: string): Provenance {
  return {
    file,
    line,
    platform: "agentfile",
    // The contract is committed, team-shared configuration for the repository,
    // or for a directory inside it when a subdirectory contract is loaded.
    scope: directory === ROOT_PATH ? "project" : "directory",
    origin: "declared",
  };
}

// ─── Mapping ───────────────────────────────────────────────────────────────

function mapDirectives(contract: Contract, file: string, directory: string, source?: YamlSource): Directive[] {
  const directives: Directive[] = [];
  const applies = directory === ROOT_PATH ? ALWAYS : appliesToDirectory(directory);

  for (const [category, entries] of Object.entries(contract.rules)) {
    for (let index = 0; index < entries.length; index++) {
      const text = entries[index];
      const location = source?.locate(["rules", category, index]);
      const provenance = provenanceFor(file, location?.line, directory);

      directives.push({
        id: nodeId("directive", provenance, `${category}-${index}`),
        text,
        category,
        applies,
        provenance,
      });
    }
  }

  return directives;
}

function mapSkills(contract: Contract, file: string, directory: string, source?: YamlSource): SkillEntry[] {
  // A root contract offers its skills everywhere and lets the agent choose from
  // the description. A contract inside a subdirectory offers them only while
  // working in that subtree, which is how the platforms treat nested skill
  // directories — see docs/v2-architecture.md §5.3 and §5.4.
  const applies = directory === ROOT_PATH ? MODEL_SELECTED : appliesToPaths([`${directory}/**`]);

  return contract.skills.map((skill, index) => {
    const location = source?.locate(["skills", index]);
    const provenance = provenanceFor(file, location?.line, directory);

    return {
      name: skill.name,
      description: skill.description,
      // The v1 contract expresses a skill as structured steps. Rendering it with
      // the existing renderer keeps one definition of what a v1 skill reads like,
      // rather than introducing a second, drifting one here.
      body: renderSkillMarkdown(skill),
      resources: [],
      applies,
      provenance,
      extensions: {
        context: skill.context,
        steps: skill.steps,
        expected_output: skill.expected_output,
        examples: skill.examples,
      },
    };
  });
}

function mapArtifacts(contract: Contract, file: string, directory: string, source?: YamlSource): ArtifactEntry[] {
  return contract.artifacts.map((artifact, index) => {
    const location = source?.locate(["artifacts", index]);
    return {
      name: artifact.name,
      type: artifact.type,
      description: artifact.description,
      contentFile: artifact.content_file ? normalizePath(artifact.content_file) : undefined,
      metadata: artifact.metadata,
      provenance: provenanceFor(file, location?.line, directory),
    };
  });
}

function mapDocs(contract: Contract, file: string, directory: string, source?: YamlSource): DocEntry[] {
  return contract.docs.map((doc, index) => {
    const location = source?.locate(["docs", index]);
    return {
      name: doc.name,
      file: normalizePath(doc.file),
      token: doc.token ?? doc.name,
      provenance: provenanceFor(file, location?.line, directory),
    };
  });
}

/** Maps a validated contract onto the IR. Pure: no filesystem access. */
export function contractToConfiguration(
  contract: Contract,
  options: ContractAdapterOptions,
  source?: YamlSource,
): AgentConfiguration {
  const file = normalizePath(options.contractPath ?? CONTRACT_PATH);
  const directory = normalizePath(options.directory ?? ROOT_PATH);
  const configuration = emptyConfiguration(options.root);

  configuration.project = { name: contract.project.name, stack: [...contract.project.stack] };
  configuration.directives = mapDirectives(contract, file, directory, source);
  configuration.skills = mapSkills(contract, file, directory, source);
  configuration.artifacts = mapArtifacts(contract, file, directory, source);
  configuration.docs = mapDocs(contract, file, directory, source);

  const sourceFile: SourceFile = {
    path: file,
    platform: "agentfile",
    scope: directory === ROOT_PATH ? "project" : "directory",
    kind: "contract",
    bytes: source?.text.length,
  };
  configuration.sources = [sourceFile];

  return configuration;
}

/**
 * Maps a per-folder override onto the IR.
 *
 * Override blocks are authored prose, so they become instructions rather than
 * directives. A later analysis pass may derive directives from their bullets;
 * that would carry `origin: "derived"`, never `"declared"`.
 */
export function overrideToInstructions(
  override: Override,
  file: string,
  directory: string,
  source?: YamlSource,
): Instruction[] {
  const normalizedFile = normalizePath(file);
  const normalizedDirectory = normalizePath(directory);

  return override.blocks.map((block, index) => {
    const location = source?.locate(["blocks", index]);
    const provenance: Provenance = {
      file: normalizedFile,
      line: location?.line,
      platform: "agentfile",
      // An override file is a personal, untracked, directory-local addition.
      scope: "local",
      origin: "declared",
    };

    return {
      id: nodeId("instruction", provenance, slugify(block.section) || String(index)),
      title: block.section,
      body: block.content,
      applies: normalizedDirectory === ROOT_PATH ? ALWAYS : appliesToDirectory(normalizedDirectory),
      provenance,
    };
  });
}

// ─── Reference checks ──────────────────────────────────────────────────────

/**
 * Verifies that every file the configuration points at actually exists.
 *
 * The v1 generator silently substitutes empty content for a missing
 * `content_file`, so a typo ships to every developer's generated output with no
 * warning. This turns that into a located error.
 */
export function checkFileReferences(configuration: AgentConfiguration, fs: FileSystem = nodeFileSystem): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const check = (relativePath: string, provenance: Provenance, label: string, field: string): void => {
    if (fs.exists(join(configuration.root, relativePath))) return;

    diagnostics.push(
      diagnostic({
        code: "AGF004",
        message: `${label} references ${relativePath}, which does not exist`,
        explanation:
          `\`${field}\` must point at a file in the repository. ` +
          "A missing file is not skipped with a warning at generation time — it silently becomes empty content.",
        suggestion: `Create ${relativePath}, or correct the \`${field}\` value.`,
        location: { file: provenance.file, line: provenance.line },
        data: { reference: relativePath, field },
      }),
    );
  };

  for (const artifact of configuration.artifacts) {
    if (artifact.contentFile) {
      check(artifact.contentFile, artifact.provenance, `Artifact "${artifact.name}"`, "content_file");
    }
  }

  for (const doc of configuration.docs) {
    check(doc.file, doc.provenance, `Doc "${doc.name}"`, "file");
  }

  return diagnostics;
}

// ─── Loading ───────────────────────────────────────────────────────────────

export interface LoadResult {
  /** Always present. Empty when loading failed, so callers need no null checks. */
  configuration: AgentConfiguration;
  diagnostics: Diagnostic[];
  /** False when the contract could not be read or did not validate. */
  ok: boolean;
}

/**
 * Reads and validates the v1 contract, returning diagnostics instead of
 * throwing.
 *
 * Returning diagnostics is the point: one malformed field should not abort the
 * whole report, and a caller in an editor needs every problem at once, each with
 * a position.
 */
export function loadConfigurationFromContract(options: ContractAdapterOptions): LoadResult {
  const fs = options.fs ?? nodeFileSystem;
  const contractPath = normalizePath(options.contractPath ?? CONTRACT_PATH);
  const overridePath = normalizePath(options.overridePath ?? OVERRIDE_PATH);
  const directory = normalizePath(options.directory ?? ROOT_PATH);
  const absoluteContract = join(options.root, contractPath);

  if (!fs.exists(absoluteContract)) {
    return {
      configuration: emptyConfiguration(options.root),
      ok: false,
      diagnostics: [
        diagnostic({
          code: "AGF002",
          message: `No contract found at ${contractPath}`,
          explanation: "Agentfile could not find a contract to read for this project.",
          suggestion: "Run `agentfile init` to scaffold one.",
          location: { file: contractPath },
          data: { path: contractPath },
        }),
      ],
    };
  }

  const source = loadYamlSource(contractPath, fs.readFile(absoluteContract));
  if (source.diagnostics.length) {
    return { configuration: emptyConfiguration(options.root), diagnostics: source.diagnostics, ok: false };
  }

  const parsed = ContractSchema.safeParse(source.value);
  if (!parsed.success) {
    return {
      configuration: emptyConfiguration(options.root),
      diagnostics: schemaIssuesToDiagnostics(source, parsed.error),
      ok: false,
    };
  }

  const configuration = contractToConfiguration(parsed.data, { ...options, contractPath, directory }, source);
  const diagnostics = checkFileReferences(configuration, fs);

  // The v1 override file is optional and, by design, personal and untracked.
  const absoluteOverride = join(options.root, overridePath);
  if (fs.exists(absoluteOverride)) {
    const overrideSource = loadYamlSource(overridePath, fs.readFile(absoluteOverride));

    if (overrideSource.diagnostics.length) {
      diagnostics.push(...overrideSource.diagnostics);
    } else {
      const parsedOverride = OverrideSchema.safeParse(overrideSource.value);
      if (parsedOverride.success) {
        configuration.instructions.push(
          ...overrideToInstructions(parsedOverride.data, overridePath, directory, overrideSource),
        );
        configuration.sources.push({
          path: overridePath,
          platform: "agentfile",
          scope: "local",
          kind: "override",
          bytes: overrideSource.text.length,
        });
      } else {
        diagnostics.push(...schemaIssuesToDiagnostics(overrideSource, parsedOverride.error));
      }
    }
  }

  return { configuration, diagnostics, ok: true };
}
