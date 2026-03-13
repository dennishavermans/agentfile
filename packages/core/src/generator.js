/// <reference types="node" />
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { loadContract, loadOverride, resolveAgent, resolveAgentSelection } from './loader.js';
import { renderTemplate } from './renderer.js';
// ─── Validate ──────────────────────────────────────────────────────────────
/**
 * Validates contract.yaml only. Does not load agents or render templates.
 * Throws on invalid schema.
 */
export function validateContract(options) {
    return loadContract(options.contractPath);
}
// ─── Generate ──────────────────────────────────────────────────────────────
/**
 * Full generation pass. Loads contract, resolves agents, renders templates,
 * and optionally writes output files.
 *
 * Returns a GenerateResult — never throws. Errors are captured per-agent.
 */
export function generate(options) {
    const { root, agents: requestedAgents, dryRun = false } = options;
    const contractPath = join(root, 'ai', 'contract.yaml');
    const agentsDir = join(root, 'ai', 'agents');
    const overridePath = join(root, 'ai.override.yaml');
    // Load contract — this can throw, let it propagate so callers handle it
    const contract = loadContract(contractPath);
    const override = loadOverride(overridePath);
    // Resolve which agents are available vs requested
    const selection = resolveAgentSelection(requestedAgents, agentsDir);
    const results = [];
    // Report unknown agents as skipped
    for (const unknown of selection.unknown) {
        results.push({
            status: 'skipped',
            agent: unknown,
            reason: `No agent folder found at ai/agents/${unknown}`
        });
    }
    // Generate each resolved agent
    for (const agentName of selection.resolved) {
        try {
            const resolved = resolveAgent(agentsDir, agentName);
            const content = renderTemplate(resolved.template, { contract, override });
            const output = resolved.config.output;
            if (!dryRun) {
                const fullPath = join(root, output);
                const dir = dirname(fullPath);
                if (!existsSync(dir))
                    mkdirSync(dir, { recursive: true });
                writeFileSync(fullPath, content, 'utf-8');
            }
            results.push({ status: 'ok', agent: agentName, output, content });
        }
        catch (err) {
            results.push({
                status: 'error',
                agent: agentName,
                error: err instanceof Error ? err : new Error(String(err))
            });
        }
    }
    const success = results.every(r => r.status !== 'error');
    return { results, success };
}
//# sourceMappingURL=generator.js.map