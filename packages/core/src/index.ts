/**
 * @agentfile/core
 *
 * Core engine for agentfile — schema validation, loading, rendering, and generation.
 * This package is framework-agnostic and has no CLI concerns.
 *
 * Primary entry points:
 *   generate()         — full generation pass
 *   validateContract() — schema validation only
 *   renderTemplate()   — pure template rendering
 */

// ─── Generation API ────────────────────────────────────────────────────────
export { generate, validateContract } from "./generator.js";
export type { GenerateOptions, ValidateOptions } from "./generator.js";

// ─── Rendering API ─────────────────────────────────────────────────────────
export {
  renderTemplate,
  renderSkillMarkdown,
  renderSkillMdc,
  renderSkillCopilot,
  extractPreservedZones,
  buildArtifactTokens,
  buildAggregateArtifactTokens,
  renderArtifactTemplate,
  buildDocsTokens,
} from "./renderer.js";
export type { RenderContext, SkillsFormat } from "./renderer.js";

// ─── Loading API ───────────────────────────────────────────────────────────
export {
  loadContract,
  loadOverride,
  loadAgentConfig,
  loadAgentTemplate,
  resolveAgent,
  discoverAgents,
  resolveAgentSelection,
  ValidationError,
} from "./loader.js";

// ─── Types ─────────────────────────────────────────────────────────────────
export type {
  Skill,
  Artifact,
  ArtifactTemplate,
  DocReference,
  Contract,
  AgentConfig,
  Override,
  ResolvedAgent,
  AgentResult,
  GenerateResult,
  AgentSelection,
} from "./schema.js";

// ─── Schemas (for consumers that want to validate custom inputs) ────────────
export {
  ContractSchema,
  AgentConfigSchema,
  OverrideSchema,
  SkillSchema,
  ArtifactSchema,
  ArtifactTemplateSchema,
  DocReferenceSchema,
} from "./schema.js";

// ─── Manifest API ──────────────────────────────────────────────────────────
export {
  readManifest,
  writeManifest,
  buildManifest,
  hashContent,
  generatedMarker,
  hasGeneratedMarker,
  addMarker,
  ownedPaths,
  preservedPaths,
  detectDrift,
  staleFiles,
  captureBackup,
  writeBackup,
  readBackup,
  restoreBackup,
  listBackups,
  MANIFEST_FILE,
  BACKUP_DIR,
} from "./manifest.js";
export type {
  Manifest,
  ManifestEntry,
  FileOwnership,
  BackupEntry,
} from "./manifest.js";
