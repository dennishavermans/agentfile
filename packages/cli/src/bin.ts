#!/usr/bin/env node
/// <reference types="node" />
import { Command } from 'commander'
import { initCommand }     from './commands/init.js'
import { syncCommand }     from './commands/sync.js'
import { validateCommand } from './commands/validate.js'
import { watchCommand }    from './commands/watch.js'

const program = new Command()

program
  .name('agentfile')
  .description('Unified AI agent contract manager')
  .version('0.1.0')

program
  .command('init')
  .description('Scaffold a new agentfile setup in the current project')
  .action(initCommand)

program
  .command('sync')
  .description('Generate agent instruction files from ai/contract.yaml')
  .option('--dry-run', 'Render templates without writing files')
  .action((options) => syncCommand({ dryRun: options.dryRun }))

program
  .command('validate')
  .description('Validate ai/contract.yaml schema (used in CI)')
  .action(validateCommand)

program
  .command('watch')
  .description('Watch ai/ for changes and sync automatically')
  .action(watchCommand)

program.parse()
