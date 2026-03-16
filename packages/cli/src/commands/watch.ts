/// <reference types="node" />
import { watch } from 'fs'
import { join, relative } from 'path'
import { existsSync } from 'fs'
import { logger } from '../logger.js'
import { syncCommand } from './sync.js'

const DEBOUNCE_MS = 300

export async function watchCommand() {
  const root        = process.cwd()
  const contractDir = join(root, 'ai')
  const agentsDir   = join(root, 'ai', 'agents')

  logger.title('agentfile watch')

  if (!existsSync(contractDir)) {
    logger.error('No ai/ directory found. Run `agentfile init` first.')
    process.exit(1)
  }

  // Initial sync on start
  logger.info('Running initial sync...\n')
  await syncCommand()

  logger.info('Watching ai/ for changes. Press Ctrl+C to stop.\n')

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function onChange(filename: string | null) {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      const label = filename
        ? relative(root, join(contractDir, filename))
        : 'ai/'
      console.log()
      logger.info(`Changed: ${label}`)
      await syncCommand()
    }, DEBOUNCE_MS)
  }

  // Watch ai/ recursively
  watch(contractDir, { recursive: true }, (_event, filename) => {
    onChange(filename)
  })
}
