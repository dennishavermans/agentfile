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

// ═══════════════════════════════════════════════════════════════════════════
// v2 layers
//
// Everything above is the v1 API and stays byte-compatible. Everything below is
// additive: the normalized representation and the deterministic layers built on
// it. See docs/v2-architecture.md.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Adapters ──────────────────────────────────────────────────────────────
export type { ContractAdapterOptions, LoadResult } from "./adapters/index.js";
export {
  CONTRACT_PATH,
  checkFileReferences,
  contractToConfiguration,
  loadConfigurationFromContract,
  OVERRIDE_PATH,
  overrideToInstructions,
} from "./adapters/index.js";
// ─── Analysis ──────────────────────────────────────────────────────────────
export type {
  AlwaysLoadedContext,
  ContextBudgetOptions,
  ContextEstimate,
  DeriveOptions,
  InstructionLine,
  InstructionOverlap,
  LineOptions,
  NearDuplicateOptions,
  NearDuplicatePair,
  NearDuplicateResult,
  OverlapOptions,
  ScopeMismatch,
  ScopeOptions,
  SkillRoutingSignal,
} from "./analysis/index.js";
export {
  alwaysLoadedContext,
  analyzeSkillRouting,
  CHARACTERS_PER_TOKEN,
  contextBudgetDiagnostics,
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  deriveAllDirectives,
  deriveDirectives,
  describeScope,
  estimateContext,
  findInstructionOverlap,
  findNearDuplicateInstructions,
  findScopeMismatches,
  hasNegation,
  instructionLines,
  isAlwaysLoaded,
  isIgnorableLine,
  jaccardSimilarity,
  MAX_DESCRIPTION_LENGTH,
  MAX_SKILL_NAME_LENGTH,
  MAXIMUM_COMPARISONS,
  MINIMUM_CONTENT_TOKENS,
  MINIMUM_OVERLAP_LINE_LENGTH,
  MINIMUM_SHARED_TOKENS,
  NEAR_DUPLICATE_THRESHOLD,
  nearDuplicateDiagnostics,
  normalizeInstructionLine,
  overlapDiagnostics,
  scopeMismatchDiagnostics,
  scopeSignature,
  tokenize,
  WEAK_DESCRIPTION_LENGTH,
} from "./analysis/index.js";
// ─── Target capabilities ───────────────────────────────────────────────────
export type {
  CapabilityCheckContext,
  CapabilityLevel,
  CapabilityRow,
  FeatureId,
  FeatureMeta,
  FeatureUsage,
  TargetId,
} from "./capabilities/index.js";
export {
  CAPABILITIES,
  capability,
  compatibilityDiagnostics,
  diagnoseCapability,
  FEATURES,
  featureMeta,
  featuresUsed,
  groupFeatureUsage,
  KNOWN_TARGETS,
  supports,
  targetCapabilities,
} from "./capabilities/index.js";
// ─── Diagnostics ───────────────────────────────────────────────────────────
export type {
  CodeStatus,
  Diagnostic,
  DiagnosticBand,
  DiagnosticCode,
  DiagnosticCodeMeta,
  DiagnosticInput,
  DiagnosticReport,
  DiagnosticSummary,
  HumanFormatOptions,
  Location,
  RelatedLocation,
  Severity,
} from "./diagnostics/index.js";
export {
  allDiagnosticCodes,
  buildReport,
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_REPORT_VERSION,
  diagnostic,
  diagnosticMeta,
  formatHuman,
  formatJson,
  hasErrors,
  sortDiagnostics,
  summarize,
} from "./diagnostics/index.js";
// ─── Discovery ─────────────────────────────────────────────────────────────
export type {
  DiscoveredInstructions,
  DiscoveredMcpServers,
  DiscoveredSkills,
  DiscoveredSubagents,
  DiscoverOptions,
  DiscoveryResult,
  RepositoryScan,
  ScanOptions,
} from "./discovery/index.js";
export {
  checkInstructionImports,
  DEFAULT_IGNORED_DIRECTORIES,
  discover,
  discoverAgentsMd,
  discoverClaudeMd,
  discoverClaudeRules,
  discoverCopilotInstructions,
  discoverCursorRules,
  discoverLegacyCursorRules,
  discoverMcpServers,
  discoverSkills,
  discoverSubagents,
  filesNamed,
  filesUnder,
  findImports,
  governedDirectory,
  SKILL_DIRECTORIES,
  SKILL_SPEC_FIELDS,
  scanRepository,
} from "./discovery/index.js";
// ─── Filesystem port ───────────────────────────────────────────────────────
export type { DirectoryEntry, FileSystem } from "./fs/index.js";
export { memoryFileSystem, nodeFileSystem } from "./fs/index.js";
// ─── Intermediate representation ───────────────────────────────────────────
export type {
  AgentConfiguration,
  Applicability,
  ArtifactEntry,
  ConfigOrigin,
  ConfigScope,
  Directive,
  DocEntry,
  HookEntry,
  Instruction,
  McpServerEntry,
  McpTransport,
  PermissionRule,
  PlatformId,
  ProjectMetadata,
  Provenance,
  SkillEntry,
  SkillResource,
  SkillResourceKind,
  SourceFile,
  SubagentEntry,
} from "./ir/index.js";
export {
  ALWAYS,
  appliesToDirectory,
  appliesToPaths,
  countNodes,
  emptyConfiguration,
  IR_VERSION,
  MANUAL,
  MODEL_SELECTED,
  mergeConfigurations,
  nodeId,
  slugify,
} from "./ir/index.js";
// ─── Frontmatter parsing ───────────────────────────────────────────────────
export type { ParsedFrontmatter } from "./parsers/index.js";
export {
  booleanField,
  extraFields,
  globListField,
  listField,
  mapField,
  parseFrontmatter,
  stringField,
} from "./parsers/index.js";
// ─── Path matching ─────────────────────────────────────────────────────────
export type { GlobSpecificity } from "./paths/index.js";
export {
  ancestorDirectories,
  compareGlobSpecificity,
  dirnameOf,
  expandDirectoryPattern,
  globSpecificity,
  isWithin,
  matchesAnyPattern,
  matchesPattern,
  matchingPatterns,
  normalizePath,
  pathDepth,
  ROOT_PATH,
  sortByGlobSpecificity,
  splitGlobList,
} from "./paths/index.js";
// ─── Resolution ────────────────────────────────────────────────────────────
export type {
  Applied,
  EffectiveConfiguration,
  Excluded,
  ExclusionReason,
  ExplainKind,
  ExplainOptions,
  ExplainTarget,
  Explanation,
  FindOptions,
  MatchedBy,
  MatchReason,
  NodeExplanation,
  PathVerdict,
  ReachabilityOptions,
  ResolutionRank,
  ResolveOptions,
} from "./resolver/index.js";
export {
  configuredDirectories,
  deadPatterns,
  describeApplicability,
  explainInstruction,
  explainTarget,
  findExplainTargets,
  normalizeDirectiveText,
  probePaths,
  repositoryResolutionDiagnostics,
  resolveForPath,
  SCOPE_RANK,
  unreachableDiagnostics,
  verdictAt,
} from "./resolver/index.js";
// ─── Validation ────────────────────────────────────────────────────────────
export type {
  Rule,
  RuleContext,
  RuleResult,
  RuleSkip,
  ValidationLayer,
  ValidationOptions,
  ValidationResult,
} from "./validation/index.js";
export {
  CHECK_LAYERS,
  findRule,
  IMPLEMENTED_LAYERS,
  LINT_LAYERS,
  RULES,
  runValidation,
  selectRules,
} from "./validation/index.js";
// ─── YAML source handling ──────────────────────────────────────────────────
export type { YamlSource } from "./yaml/index.js";
export { formatIssuePath, loadYamlSource, schemaIssuesToDiagnostics } from "./yaml/index.js";
