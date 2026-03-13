/// <reference types="node" />
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { parse } from 'yaml'
import { z } from 'zod'

import {
  ContractSchema,
  AgentConfigSchema,
  OverrideSchema,
  type Contract,
  type AgentConfig,
  type Override,
  type ResolvedAgent,
  type AgentSelection
} from './schema.js'

// ─── YAML Loader ───────────────────────────────────────────────────────────

export class ValidationError extends Error {
  constructor(public readonly file: string, public readonly issues: string[]) {
    super(`Validation failed in ${file}:\n${issues.map(i => `  • ${i}`).join('\n')}`)
    this.name = 'ValidationError'
  }
}

export function parseYaml<S extends z.ZodTypeAny>(path: string, schema: S): z.output<S> {
  if (!existsSync(path)) {
    throw new Error(`Required file not found: ${path}`)
  }

  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch {
    throw new Error(`Could not read file: ${path}`)
  }

  const parsed = parse(raw)
  const result = schema.safeParse(parsed)

  if (!result.success) {
    const issues = result.error.issues.map(i => {
      const path = i.path.length ? `${i.path.join('.')}: ` : ''
      return `${path}${i.message}`
    })
    throw new ValidationError(path, issues)
  }

  return result.data
}

// ─── Contract Loader ───────────────────────────────────────────────────────

export function loadContract(contractPath: string): Contract {
  return parseYaml(contractPath, ContractSchema)
}

// ─── Agent Loaders ─────────────────────────────────────────────────────────

export function loadAgentConfig(agentDir: string): AgentConfig {
  return parseYaml(join(agentDir, 'config.yaml'), AgentConfigSchema)
}

export function loadAgentTemplate(agentDir: string): string {
  const templatePath = join(agentDir, 'template.md')
  if (!existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`)
  }
  return readFileSync(templatePath, 'utf-8')
}

export function resolveAgent(agentsDir: string, agentName: string): ResolvedAgent {
  const agentDir = join(agentsDir, agentName)
  const config   = loadAgentConfig(agentDir)
  const template = loadAgentTemplate(agentDir)
  return { name: agentName, config, template }
}

// ─── Agent Discovery ───────────────────────────────────────────────────────

export function discoverAgents(agentsDir: string): string[] {
  if (!existsSync(agentsDir)) return []
  return readdirSync(agentsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
}

// ─── Override Loader ───────────────────────────────────────────────────────

export function loadOverride(overridePath: string): Override | null {
  if (!existsSync(overridePath)) return null
  return parseYaml(overridePath, OverrideSchema)
}

// ─── Agent Selection ───────────────────────────────────────────────────────

export function resolveAgentSelection(
  requested: string[],
  agentsDir:  string
): AgentSelection {
  const available = discoverAgents(agentsDir)
  const unknown   = requested.filter(a => !available.includes(a))
  const resolved  = requested.filter(a => available.includes(a))
  return { requested, available, resolved, unknown }
}
