import type { Contract, GenerateResult } from './schema.js';
export interface GenerateOptions {
    /** Absolute path to the project root */
    root: string;
    /** Agents to generate — resolved names, e.g. ['claude', 'cursor'] */
    agents: string[];
    /** If true, render templates but do not write any files */
    dryRun?: boolean;
}
export interface ValidateOptions {
    /** Absolute path to contract.yaml */
    contractPath: string;
}
/**
 * Validates contract.yaml only. Does not load agents or render templates.
 * Throws on invalid schema.
 */
export declare function validateContract(options: ValidateOptions): Contract;
/**
 * Full generation pass. Loads contract, resolves agents, renders templates,
 * and optionally writes output files.
 *
 * Returns a GenerateResult — never throws. Errors are captured per-agent.
 */
export declare function generate(options: GenerateOptions): GenerateResult;
//# sourceMappingURL=generator.d.ts.map