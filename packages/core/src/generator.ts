/// <reference types="node" />
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'

import { loadContract, loadOverride, resolveAgent, resolveAgentSelection } from './loader.js'
import { renderTemplate, renderSkillMdc, type SkillsFormat } from './renderer.js'
import type { Contract, Override, GenerateResult, AgentResult } from './schema.js'

// ─── Options ───────────────────────────────────────────────────────────────

export interface GenerateOptions {
  root:    string
  agents:  string[]
  dryRun?: boolean
}

export interface ValidateOptions {
  contractPath: string
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function writeFile(path: string, content: string, dryRun: boolean): void {
  if (dryRun) return
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, content, 'utf-8')
}

// Cursor generates one .mdc file per skill in addition to its main file
function generateCursorSkillFiles(
  root:     string,
  contract: Contract,
  dryRun:   boolean
): AgentResult[] {
  if (!contract.skills.length) return []

  return contract.skills.map(skill => {
    const output  = `.cursor/rules/skills/${skill.name}.mdc`
    const content = renderSkillMdc(skill)
    try {
      writeFile(join(root, output), content, dryRun)
      return { status: 'ok' as const, agent: `cursor:skill:${skill.name}`, output, content }
    } catch (err) {
      return {
        status: 'error' as const,
        agent:  `cursor:skill:${skill.name}`,
        error:  err instanceof Error ? err : new Error(String(err))
      }
    }
  })
}

// ─── Validate ──────────────────────────────────────────────────────────────

export function validateContract(options: ValidateOptions): Contract {
  return loadContract(options.contractPath)
}

// ─── Generate ──────────────────────────────────────────────────────────────

export function generate(options: GenerateOptions): GenerateResult {
  const { root, agents: requestedAgents, dryRun = false } = options

  const contractPath = join(root, 'ai', 'contract.yaml')
  const agentsDir    = join(root, 'ai', 'agents')
  const overridePath = join(root, 'ai.override.yaml')

  const contract = loadContract(contractPath)
  const override: Override | null = loadOverride(overridePath)

  const selection = resolveAgentSelection(requestedAgents, agentsDir)
  const results: AgentResult[] = []

  // Report unknown agents as skipped
  for (const unknown of selection.unknown) {
    results.push({
      status: 'skipped',
      agent:  unknown,
      reason: `No agent folder found at ai/agents/${unknown}`
    })
  }

  // Generate each resolved agent
  for (const agentName of selection.resolved) {
    const agentDir = join(agentsDir, agentName)

    try {
      const resolved = resolveAgent(agentsDir, agentName)

      // Determine skills rendering format per agent
      const skillsFormat: SkillsFormat =
        agentName === 'copilot'   ? 'copilot'   :
        agentName === 'agents-md' ? 'agents-md' :
        'markdown'

      const content = renderTemplate(resolved.template, { contract, override }, skillsFormat)
      const output  = resolved.config.output

      writeFile(join(root, output), content, dryRun)
      results.push({ status: 'ok', agent: agentName, output, content })

      // Cursor: also generate per-skill .mdc files
      if (agentName === 'cursor') {
        const skillResults = generateCursorSkillFiles(root, contract, dryRun)
        results.push(...skillResults)
      }
    } catch (err) {
      results.push({
        status: 'error',
        agent:  agentName,
        error:  err instanceof Error ? err : new Error(String(err))
      })
    }
  }

  const success = results.every(r => r.status !== 'error')
  return { results, success }
}
