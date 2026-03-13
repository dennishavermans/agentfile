/// <reference types="node" />
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ─── Test Directory ────────────────────────────────────────────────────────

const TEST_DIR = join(process.cwd(), '__test_project__')

function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
}

function readFile(relative: string): string {
  return readFileSync(join(TEST_DIR, relative), 'utf-8')
}

function fileExists(relative: string): boolean {
  return existsSync(join(TEST_DIR, relative))
}

// ─── Mock Enquirer ─────────────────────────────────────────────────────────

vi.mock('enquirer', () => ({
  default: class MockEnquirer {
    async prompt() {
      return {
        name:   'Test App',
        stack:  ['typescript', 'react'],
        agents: ['claude', 'cursor']
      }
    }
  }
}))

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('init command', () => {
  beforeEach(() => {
    cleanup()
    // Run init inside the test directory by temporarily changing cwd
    vi.spyOn(process, 'cwd').mockReturnValue(TEST_DIR)
    require('fs').mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('creates ai/contract.yaml with correct project name and stack', async () => {
    const { initCommand } = await import('../src/commands/init.js')
    await initCommand()

    expect(fileExists('ai/contract.yaml')).toBe(true)
    const contract = readFile('ai/contract.yaml')
    expect(contract).toContain('name: Test App')
    expect(contract).toContain('- typescript')
    expect(contract).toContain('- react')
  })

  it('creates agent config and template for each default agent', async () => {
    const { initCommand } = await import('../src/commands/init.js')
    await initCommand()

    for (const agent of ['claude', 'copilot', 'cursor']) {
      expect(fileExists(`ai/agents/${agent}/config.yaml`)).toBe(true)
      expect(fileExists(`ai/agents/${agent}/template.md`)).toBe(true)
    }
  })

  it('creates .ai-agents with the selected agents', async () => {
    const { initCommand } = await import('../src/commands/init.js')
    await initCommand()

    expect(fileExists('.ai-agents')).toBe(true)
    const agents = readFile('.ai-agents')
    expect(agents).toContain('claude')
    expect(agents).toContain('cursor')
  })

  it('creates .ai-agents.example', async () => {
    const { initCommand } = await import('../src/commands/init.js')
    await initCommand()

    expect(fileExists('.ai-agents.example')).toBe(true)
  })

  it('creates CI workflow file', async () => {
    const { initCommand } = await import('../src/commands/init.js')
    await initCommand()

    expect(fileExists('.github/workflows/ai-contract.yml')).toBe(true)
    const workflow = readFile('.github/workflows/ai-contract.yml')
    expect(workflow).toContain('npx agentfile validate')
    expect(workflow).toContain('npx agentfile sync --dry-run')
  })

  it('does not overwrite existing files on re-run', async () => {
    const { initCommand } = await import('../src/commands/init.js')
    await initCommand()

    // Mutate the contract file
    const contractPath = join(TEST_DIR, 'ai/contract.yaml')
    require('fs').writeFileSync(contractPath, 'version: 1\n# custom content', 'utf-8')

    // Run init again
    await initCommand()

    // Should not have been overwritten
    expect(readFile('ai/contract.yaml')).toContain('# custom content')
  })

  it('generated contract.yaml passes core schema validation', async () => {
    const { initCommand } = await import('../src/commands/init.js')
    await initCommand()

    const { validateContract } = await import('@agentfile/core')
    const contractPath = join(TEST_DIR, 'ai', 'contract.yaml')

    expect(() => validateContract({ contractPath })).not.toThrow()
  })
})
