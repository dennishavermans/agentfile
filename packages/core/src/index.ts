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
export { generate, validateContract }         from './generator.js'
export type { GenerateOptions, ValidateOptions } from './generator.js'

// ─── Rendering API ─────────────────────────────────────────────────────────
export { renderTemplate, renderSkillMarkdown, renderSkillMdc, renderSkillCopilot } from './renderer.js'
export type { RenderContext, SkillsFormat }   from './renderer.js'

// ─── Loading API ───────────────────────────────────────────────────────────
export {
  loadContract,
  loadOverride,
  loadAgentConfig,
  loadAgentTemplate,
  resolveAgent,
  discoverAgents,
  resolveAgentSelection,
  ValidationError
}                                             from './loader.js'

// ─── Types ─────────────────────────────────────────────────────────────────
export type {
  Skill,
  Contract,
  AgentConfig,
  Override,
  ResolvedAgent,
  AgentResult,
  GenerateResult,
  AgentSelection
}                                             from './schema.js'

// ─── Schemas (for consumers that want to validate custom inputs) ────────────
export {
  ContractSchema,
  AgentConfigSchema,
  OverrideSchema,
  SkillSchema
}                                             from './schema.js'
