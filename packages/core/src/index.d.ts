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
export { generate, validateContract } from './generator.js';
export type { GenerateOptions, ValidateOptions } from './generator.js';
export { renderTemplate } from './renderer.js';
export type { RenderContext } from './renderer.js';
export { loadContract, loadOverride, loadAgentConfig, loadAgentTemplate, resolveAgent, discoverAgents, resolveAgentSelection, ValidationError } from './loader.js';
export type { Contract, AgentConfig, Override, ResolvedAgent, AgentResult, GenerateResult, AgentSelection } from './schema.js';
export { ContractSchema, AgentConfigSchema, OverrideSchema } from './schema.js';
//# sourceMappingURL=index.d.ts.map