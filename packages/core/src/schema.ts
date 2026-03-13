import { z } from 'zod'

// ─── Skill ─────────────────────────────────────────────────────────────────

export const SkillExampleSchema = z.object({
  input:  z.string(),
  output: z.string()
})

export const SkillSchema = z.object({
  name:            z.string().min(1),
  description:     z.string().min(1),
  context:         z.array(z.string()).optional().default([]),
  steps:           z.array(z.string()).min(1, 'A skill must have at least one step'),
  expected_output: z.string().optional().default(''),
  examples:        z.array(SkillExampleSchema).optional().default([])
})

// ─── Contract ──────────────────────────────────────────────────────────────

export const ContractSchema = z.object({
  version: z.literal(1, {
    errorMap: () => ({ message: 'Unsupported contract version. Only version 1 is supported.' })
  }),
  project: z.object({
    name:  z.string().min(1, 'project.name must not be empty'),
    stack: z.array(z.string()).min(1, 'project.stack must contain at least one entry')
  }),
  rules: z.object({
    coding:       z.array(z.string()).optional().default([]),
    architecture: z.array(z.string()).optional().default([]),
    testing:      z.array(z.string()).optional().default([]),
    naming:       z.array(z.string()).optional().default([])
  }).default({}),
  skills: z.array(SkillSchema).min(1, 'contract must define at least one skill')
})

// ─── Agent Config ──────────────────────────────────────────────────────────

export const AgentConfigSchema = z.object({
  name:        z.string().min(1),
  output:      z.string().min(1, 'output path must not be empty'),
  description: z.string()
})

// ─── Override ──────────────────────────────────────────────────────────────

export const OverrideSchema = z.object({
  blocks: z.array(
    z.object({
      section: z.string().min(1),
      content: z.string()
    })
  ).default([])
})

// ─── Exported Types ────────────────────────────────────────────────────────

export type Skill       = z.output<typeof SkillSchema>
export type Contract    = z.output<typeof ContractSchema>
export type AgentConfig = z.output<typeof AgentConfigSchema>
export type Override    = z.output<typeof OverrideSchema>

// ─── Agent Selection ───────────────────────────────────────────────────────

export interface AgentSelection {
  requested: string[]
  available: string[]
  resolved:  string[]
  unknown:   string[]
}

// ─── Agent (resolved, ready for generation) ────────────────────────────────

export interface ResolvedAgent {
  name:     string
  config:   AgentConfig
  template: string
}

// ─── Generation Result ─────────────────────────────────────────────────────

export type AgentResult =
  | { status: 'ok';      agent: string; output: string; content: string }
  | { status: 'skipped'; agent: string; reason: string }
  | { status: 'error';   agent: string; error: Error }

export interface GenerateResult {
  results:  AgentResult[]
  success:  boolean
}
