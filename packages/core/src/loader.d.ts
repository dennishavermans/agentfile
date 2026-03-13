import { z } from 'zod';
import { type Contract, type AgentConfig, type Override, type ResolvedAgent, type AgentSelection } from './schema.js';
export declare class ValidationError extends Error {
    readonly file: string;
    readonly issues: string[];
    constructor(file: string, issues: string[]);
}
export declare function parseYaml<S extends z.ZodTypeAny>(path: string, schema: S): z.output<S>;
export declare function loadContract(contractPath: string): Contract;
export declare function loadAgentConfig(agentDir: string): AgentConfig;
export declare function loadAgentTemplate(agentDir: string): string;
export declare function resolveAgent(agentsDir: string, agentName: string): ResolvedAgent;
export declare function discoverAgents(agentsDir: string): string[];
export declare function loadOverride(overridePath: string): Override | null;
export declare function resolveAgentSelection(requested: string[], agentsDir: string): AgentSelection;
//# sourceMappingURL=loader.d.ts.map