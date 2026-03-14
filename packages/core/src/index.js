/**
 * @unifai/core
 *
 * Core engine for unifai — schema validation, loading, rendering, and generation.
 * This package is framework-agnostic and has no CLI concerns.
 *
 * Primary entry points:
 *   generate()         — full generation pass
 *   validateContract() — schema validation only
 *   renderTemplate()   — pure template rendering
 */
// ─── Generation API ────────────────────────────────────────────────────────
export { generate, validateContract } from './generator.js';
// ─── Rendering API ─────────────────────────────────────────────────────────
export { renderTemplate } from './renderer.js';
// ─── Loading API ───────────────────────────────────────────────────────────
export { loadContract, loadOverride, loadAgentConfig, loadAgentTemplate, resolveAgent, discoverAgents, resolveAgentSelection, ValidationError } from './loader.js';
// ─── Schemas (for consumers that want to validate custom inputs) ────────────
export { ContractSchema, AgentConfigSchema, OverrideSchema } from './schema.js';
//# sourceMappingURL=index.js.map