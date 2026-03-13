/// <reference types="node" />
import { join } from 'path'
import { validateContract } from '@agentfile/core'
import { logger } from '../logger.js'

export async function validateCommand() {
  const root         = process.cwd()
  const contractPath = join(root, 'ai', 'contract.yaml')

  logger.title('agentfile validate')

  try {
    const contract = validateContract({ contractPath })
    logger.success(`contract.yaml is valid (version ${contract.version})`)
    logger.success(`Project: ${contract.project.name}`)
    logger.success(`Stack:   ${contract.project.stack.join(', ')}`)

    const ruleCount = (Object.values(contract.rules) as string[][])
      .reduce((sum, rules) => sum + rules.length, 0)

    logger.success(`Rules:   ${ruleCount} total across ${Object.keys(contract.rules).length} categories`)
    console.log()
  } catch (err) {
    logger.error((err as Error).message)
    console.log()
    process.exit(1)
  }
}
