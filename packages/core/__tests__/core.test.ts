import { describe, it, expect } from 'vitest'
import { renderTemplate, renderSkillMarkdown, renderSkillMdc, renderSkillCopilot } from '../src/renderer.ts'
import { ContractSchema, SkillSchema, OverrideSchema } from '../src/schema.ts'
import type { Contract, Skill, Override, RenderContext } from '../src/index.ts'

// ─── Fixtures ──────────────────────────────────────────────────────────────

const baseContract: Contract = ContractSchema.parse({
  version: 1,
  project: { name: 'Test Project', stack: ['typescript', 'react'] },
  rules: {
    coding:       ['Prefer small functions'],
    architecture: ['Feature-based folder structure'],
    testing:      ['Unit test business logic'],
    naming:       ['Use descriptive names']
  },
  skills: [{
    name:        'create-component',
    description: 'Creates a React component',
    steps:       ['Create file', 'Create test', 'Export']
  }]
})

const baseSkill: Skill = SkillSchema.parse({
  name:            'create-component',
  description:     'Creates a React component with tests',
  context:         ['Components live in /src/components/'],
  steps:           ['Create component file', 'Create test file', 'Export from index'],
  expected_output: 'A typed component with tests',
  examples:        [{ input: 'create UserCard', output: 'UserCard.tsx, UserCard.test.tsx' }]
})

const ctx: RenderContext = { contract: baseContract, override: null }

// ─── renderTemplate ────────────────────────────────────────────────────────

describe('renderTemplate', () => {
  it('replaces project.name token', () => {
    expect(renderTemplate('Project: ${project.name}', ctx)).toBe('Project: Test Project\n')
  })

  it('replaces project.stack token', () => {
    expect(renderTemplate('Stack: ${project.stack.join(\', \')}', ctx)).toBe('Stack: typescript, react\n')
  })

  it('renders a rule list as markdown bullets', () => {
    expect(renderTemplate('${rules.coding}', ctx)).toBe('- Prefer small functions\n')
  })

  it('renders empty rule category as placeholder', () => {
    const emptyCtx: RenderContext = {
      contract: { ...baseContract, rules: { coding: [], architecture: [], testing: [], naming: [] } },
      override: null
    }
    expect(renderTemplate('${rules.coding}', emptyCtx)).toBe('_None defined._\n')
  })

  it('renders skills section in markdown format', () => {
    const result = renderTemplate('${skills}', ctx)
    expect(result).toContain('## Skills')
    expect(result).toContain('### create-component')
  })

  it('renders skills in copilot format', () => {
    const result = renderTemplate('${skills}', ctx, 'copilot')
    expect(result).toContain('## Available Workflows')
    expect(result).toContain('**create-component**')
  })

  it('renders nothing for override when null', () => {
    expect(renderTemplate('Rules\n${override}', ctx).trim()).toBe('Rules')
  })

  it('injects override blocks when present', () => {
    const override: Override = OverrideSchema.parse({
      blocks: [{ section: 'Frontend Context', content: 'Use RSC by default.' }]
    })
    const result = renderTemplate('${override}', { contract: baseContract, override })
    expect(result).toContain('## Frontend Context')
    expect(result).toContain('Use RSC by default.')
  })

  it('trims and adds single trailing newline', () => {
    expect(renderTemplate('  hello  ', ctx)).toBe('hello\n')
  })
})

// ─── renderSkillMarkdown ───────────────────────────────────────────────────

describe('renderSkillMarkdown', () => {
  it('renders skill name as h3', () => {
    expect(renderSkillMarkdown(baseSkill)).toContain('### create-component')
  })

  it('renders description', () => {
    expect(renderSkillMarkdown(baseSkill)).toContain('Creates a React component with tests')
  })

  it('renders context as bullets', () => {
    expect(renderSkillMarkdown(baseSkill)).toContain('- Components live in /src/components/')
  })

  it('renders steps as numbered list', () => {
    const result = renderSkillMarkdown(baseSkill)
    expect(result).toContain('1. Create component file')
    expect(result).toContain('2. Create test file')
  })

  it('renders expected output', () => {
    expect(renderSkillMarkdown(baseSkill)).toContain('A typed component with tests')
  })

  it('renders examples', () => {
    const result = renderSkillMarkdown(baseSkill)
    expect(result).toContain('create UserCard')
    expect(result).toContain('UserCard.tsx')
  })
})

// ─── renderSkillMdc ────────────────────────────────────────────────────────

describe('renderSkillMdc', () => {
  it('includes frontmatter', () => {
    const result = renderSkillMdc(baseSkill)
    expect(result).toContain('---')
    expect(result).toContain('alwaysApply: false')
  })

  it('includes description in frontmatter', () => {
    expect(renderSkillMdc(baseSkill)).toContain('description: Creates a React component with tests')
  })

  it('renders steps as numbered list', () => {
    expect(renderSkillMdc(baseSkill)).toContain('1. Create component file')
  })
})

// ─── renderSkillCopilot ────────────────────────────────────────────────────

describe('renderSkillCopilot', () => {
  it('renders as a single compact bullet', () => {
    const result = renderSkillCopilot(baseSkill)
    expect(result).toContain('**create-component**')
    expect(result.startsWith('-')).toBe(true)
  })

  it('includes steps inline', () => {
    expect(renderSkillCopilot(baseSkill)).toContain('Create component file')
  })
})

// ─── ContractSchema ────────────────────────────────────────────────────────

describe('ContractSchema', () => {
  it('accepts a valid contract with skills', () => {
    expect(() => ContractSchema.parse({
      version: 1,
      project: { name: 'Test', stack: ['node'] },
      skills:  [{ name: 'my-skill', description: 'Does something', steps: ['Step one'] }]
    })).not.toThrow()
  })

  it('rejects a contract without skills', () => {
    expect(() => ContractSchema.parse({
      version: 1,
      project: { name: 'Test', stack: ['node'] },
      skills:  []
    })).toThrow()
  })

  it('rejects missing skills field entirely', () => {
    expect(() => ContractSchema.parse({
      version: 1,
      project: { name: 'Test', stack: ['node'] }
    })).toThrow()
  })

  it('rejects unsupported version', () => {
    expect(() => ContractSchema.parse({
      version: 2,
      project: { name: 'Test', stack: ['node'] },
      skills:  [{ name: 'x', description: 'y', steps: ['z'] }]
    })).toThrow()
  })

  it('rejects empty project name', () => {
    expect(() => ContractSchema.parse({
      version: 1,
      project: { name: '', stack: ['node'] },
      skills:  [{ name: 'x', description: 'y', steps: ['z'] }]
    })).toThrow()
  })

  it('rejects empty stack', () => {
    expect(() => ContractSchema.parse({
      version: 1,
      project: { name: 'Test', stack: [] },
      skills:  [{ name: 'x', description: 'y', steps: ['z'] }]
    })).toThrow()
  })

  it('defaults missing rule categories to empty arrays', () => {
    const result = ContractSchema.parse({
      version: 1,
      project: { name: 'Test', stack: ['node'] },
      skills:  [{ name: 'x', description: 'y', steps: ['z'] }]
    })
    expect(result.rules.coding).toEqual([])
    expect(result.rules.architecture).toEqual([])
  })
})
