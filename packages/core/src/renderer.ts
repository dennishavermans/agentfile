import type { Contract, Override, Skill } from './schema.js'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RenderContext {
  contract: Contract
  override: Override | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function renderList(items: string[]): string {
  return items.length
    ? items.map(item => `- ${item}`).join('\n')
    : '_None defined._'
}

function renderOverrideBlocks(override: Override | null): string {
  if (!override?.blocks?.length) return ''
  return override.blocks
    .map(block => `\n## ${block.section}\n\n${block.content.trim()}`)
    .join('\n')
}

// ─── Skill Renderers ───────────────────────────────────────────────────────
// Each format is a pure function: Skill → string

export function renderSkillMarkdown(skill: Skill): string {
  const lines: string[] = []

  lines.push(`### ${skill.name}`)
  lines.push(`${skill.description}\n`)

  if (skill.context.length) {
    lines.push('**Context**')
    skill.context.forEach(c => lines.push(`- ${c}`))
    lines.push('')
  }

  lines.push('**Steps**')
  skill.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
  lines.push('')

  if (skill.expected_output) {
    lines.push('**Expected output**')
    lines.push(skill.expected_output.trim())
    lines.push('')
  }

  if (skill.examples.length) {
    lines.push('**Examples**')
    skill.examples.forEach(ex => {
      lines.push(`- Input: \`${ex.input}\``)
      lines.push(`  Output: ${ex.output.trim()}`)
    })
    lines.push('')
  }

  return lines.join('\n')
}

export function renderSkillMdc(skill: Skill): string {
  const lines: string[] = []

  lines.push('---')
  lines.push(`description: ${skill.description}`)
  lines.push('alwaysApply: false')
  lines.push('---')
  lines.push('')
  lines.push(`# ${skill.name}`)
  lines.push('')

  if (skill.context.length) {
    lines.push('## Context')
    skill.context.forEach(c => lines.push(`- ${c}`))
    lines.push('')
  }

  lines.push('## Steps')
  skill.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
  lines.push('')

  if (skill.expected_output) {
    lines.push('## Expected output')
    lines.push(skill.expected_output.trim())
    lines.push('')
  }

  if (skill.examples.length) {
    lines.push('## Examples')
    skill.examples.forEach(ex => {
      lines.push(`**Input:** ${ex.input}`)
      lines.push(`**Output:** ${ex.output.trim()}`)
      lines.push('')
    })
  }

  return lines.join('\n').trim() + '\n'
}

export function renderSkillCopilot(skill: Skill): string {
  const steps = skill.steps.join('; ')
  const context = skill.context.length ? ` Context: ${skill.context.join(', ')}.` : ''
  return `- **${skill.name}**: ${skill.description}.${context} Steps: ${steps}.`
}

// ─── Skills Block Renderers ────────────────────────────────────────────────

function renderSkillsMarkdown(skills: Skill[]): string {
  if (!skills.length) return ''
  return '\n## Skills\n\n' + skills.map(renderSkillMarkdown).join('\n')
}

function renderSkillsCopilot(skills: Skill[]): string {
  if (!skills.length) return ''
  return '\n## Available Workflows\n\n' + skills.map(renderSkillCopilot).join('\n')
}

function renderSkillsAgentsMd(skills: Skill[]): string {
  if (!skills.length) return ''
  return '\n## Skills\n\n' + skills.map(renderSkillMarkdown).join('\n')
}

// ─── Token Map ─────────────────────────────────────────────────────────────

export type SkillsFormat = 'markdown' | 'copilot' | 'agents-md'

function buildTokenMap(ctx: RenderContext, skillsFormat: SkillsFormat): Record<string, string> {
  const { project, rules, skills } = ctx.contract

  const renderSkills = () => {
    switch (skillsFormat) {
      case 'copilot':   return renderSkillsCopilot(skills)
      case 'agents-md': return renderSkillsAgentsMd(skills)
      default:          return renderSkillsMarkdown(skills)
    }
  }

  return {
    'project.name':               project.name,
    'project.stack.join(\', \')': project.stack.join(', '),
    'rules.coding':               renderList(rules.coding),
    'rules.architecture':         renderList(rules.architecture),
    'rules.testing':              renderList(rules.testing),
    'rules.naming':               renderList(rules.naming),
    'skills':                     renderSkills(),
    'override':                   renderOverrideBlocks(ctx.override)
  }
}

// ─── Renderer ─────────────────────────────────────────────────────────────

/**
 * Renders a template string using a RenderContext.
 * skillsFormat controls how skills are rendered for a given agent.
 */
export function renderTemplate(
  template: string,
  ctx: RenderContext,
  skillsFormat: SkillsFormat = 'markdown'
): string {
  const tokens = buildTokenMap(ctx, skillsFormat)

  let output = template
  for (const [token, value] of Object.entries(tokens)) {
    output = output.replaceAll(`\${${token}}`, value)
  }

  return output.trim() + '\n'
}
