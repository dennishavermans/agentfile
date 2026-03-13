import { z } from 'zod';
// ─── Contract ──────────────────────────────────────────────────────────────
export const ContractSchema = z.object({
    version: z.literal(1, {
        errorMap: () => ({
            message: 'Unsupported contract version. Only version 1 is currently supported.'
        })
    }),
    project: z.object({
        name: z.string().min(1, 'project.name must not be empty'),
        stack: z.array(z.string()).min(1, 'project.stack must contain at least one entry')
    }),
    rules: z.object({
        coding: z.array(z.string()).optional().default([]),
        architecture: z.array(z.string()).optional().default([]),
        testing: z.array(z.string()).optional().default([]),
        naming: z.array(z.string()).optional().default([])
    }).default({})
});
// ─── Agent Config ──────────────────────────────────────────────────────────
export const AgentConfigSchema = z.object({
    name: z.string().min(1),
    output: z.string().min(1, 'output path must not be empty'),
    description: z.string()
});
// ─── Override ──────────────────────────────────────────────────────────────
export const OverrideSchema = z.object({
    blocks: z.array(z.object({
        section: z.string().min(1),
        content: z.string()
    })).default([])
});
//# sourceMappingURL=schema.js.map