import { z } from 'zod';
export declare const ContractSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    project: z.ZodObject<{
        name: z.ZodString;
        stack: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        name: string;
        stack: string[];
    }, {
        name: string;
        stack: string[];
    }>;
    rules: z.ZodDefault<z.ZodObject<{
        coding: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        architecture: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        testing: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        naming: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    }, "strip", z.ZodTypeAny, {
        coding: string[];
        architecture: string[];
        testing: string[];
        naming: string[];
    }, {
        coding?: string[] | undefined;
        architecture?: string[] | undefined;
        testing?: string[] | undefined;
        naming?: string[] | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    version: 1;
    project: {
        name: string;
        stack: string[];
    };
    rules: {
        coding: string[];
        architecture: string[];
        testing: string[];
        naming: string[];
    };
}, {
    version: 1;
    project: {
        name: string;
        stack: string[];
    };
    rules?: {
        coding?: string[] | undefined;
        architecture?: string[] | undefined;
        testing?: string[] | undefined;
        naming?: string[] | undefined;
    } | undefined;
}>;
export declare const AgentConfigSchema: z.ZodObject<{
    name: z.ZodString;
    output: z.ZodString;
    description: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    output: string;
    description: string;
}, {
    name: string;
    output: string;
    description: string;
}>;
export declare const OverrideSchema: z.ZodObject<{
    blocks: z.ZodDefault<z.ZodArray<z.ZodObject<{
        section: z.ZodString;
        content: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        section: string;
        content: string;
    }, {
        section: string;
        content: string;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    blocks: {
        section: string;
        content: string;
    }[];
}, {
    blocks?: {
        section: string;
        content: string;
    }[] | undefined;
}>;
export type Contract = z.output<typeof ContractSchema>;
export type AgentConfig = z.output<typeof AgentConfigSchema>;
export type Override = z.output<typeof OverrideSchema>;
export interface AgentSelection {
    requested: string[];
    available: string[];
    resolved: string[];
    unknown: string[];
}
export interface ResolvedAgent {
    name: string;
    config: AgentConfig;
    template: string;
}
export type AgentResult = {
    status: 'ok';
    agent: string;
    output: string;
    content: string;
} | {
    status: 'skipped';
    agent: string;
    reason: string;
} | {
    status: 'error';
    agent: string;
    error: Error;
};
export interface GenerateResult {
    results: AgentResult[];
    success: boolean;
}
//# sourceMappingURL=schema.d.ts.map