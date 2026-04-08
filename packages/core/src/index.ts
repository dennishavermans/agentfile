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

export type { GenerateOptions, ValidateOptions } from "./generator.js";
// ─── Generation API ────────────────────────────────────────────────────────
export { generate, validateContract } from "./generator.js";
// ─── Loading API ───────────────────────────────────────────────────────────
export {
  discoverAgents,
  loadAgentConfig,
  loadAgentTemplate,
  loadContract,
  loadOverride,
  resolveAgent,
  resolveAgentSelection,
  ValidationError,
} from "./loader.js";
export type {
  BackupEntry,
  FileOwnership,
  Manifest,
  ManifestEntry,
} from "./manifest.js";
// ─── Manifest API ──────────────────────────────────────────────────────────
export {
  addMarker,
  BACKUP_DIR,
  buildManifest,
  captureBackup,
  detectDrift,
  generatedMarker,
  hasGeneratedMarker,
  hashContent,
  listBackups,
  MANIFEST_FILE,
  ownedPaths,
  preservedPaths,
  readBackup,
  readManifest,
  restoreBackup,
  staleFiles,
  writeBackup,
  writeManifest,
} from "./manifest.js";
export type { RenderContext, SkillsFormat } from "./renderer.js";
// ─── Rendering API ─────────────────────────────────────────────────────────
export {
  buildAggregateArtifactTokens,
  buildArtifactTokens,
  buildDocsTokens,
  extractPreservedZones,
  renderArtifactTemplate,
  renderSkillCopilot,
  renderSkillMarkdown,
  renderSkillMdc,
  renderTemplate,
} from "./renderer.js";
// ─── Types ─────────────────────────────────────────────────────────────────
export type {
  AgentConfig,
  AgentResult,
  AgentSelection,
  Artifact,
  ArtifactTemplate,
  Contract,
  DocReference,
  GenerateResult,
  Override,
  ResolvedAgent,
  Skill,
} from "./schema.js";
// ─── Schemas (for consumers that want to validate custom inputs) ────────────
export {
  AgentConfigSchema,
  ArtifactSchema,
  ArtifactTemplateSchema,
  ContractSchema,
  DocReferenceSchema,
  OverrideSchema,
  SkillSchema,
} from "./schema.js";
