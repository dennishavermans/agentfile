# @agentfile/core

The engine behind [agentfile](https://github.com/dennishavermans/agentfile): discovery of the agent configuration a repository already has, a platform-neutral IR with full provenance, a deterministic resolver, a stable diagnostic registry, static security analysis, and target compilers.

Use this package to build your own tooling on top. The CLI is a thin layer over it, and every command shares one implementation of what applies where — there is no second answer to a question core already answers.

Nothing discovered is ever executed: hooks, skills, commands and MCP configuration are read as text.

What is stable and what is not: [stability.md](https://github.com/dennishavermans/agentfile/blob/main/docs/stability.md).

## Usage

```typescript
import { generate, validateContract } from '@agentfile/core'

// Validate only
const contract = validateContract({ contractPath: 'ai/contract.yaml' })

// Full generation
const result = generate({
  root:   process.cwd(),
  agents: ['claude', 'cursor'],
  dryRun: false
})

for (const r of result.results) {
  if (r.status === 'ok')      console.log(`Generated ${r.output}`)
  if (r.status === 'error')   console.error(r.error.message)
  if (r.status === 'skipped') console.warn(r.reason)
}
```

Manifest and backup APIs are also available:

```typescript
import {
  readManifest,
  writeManifest,
  buildManifest,
  detectDrift,
  captureBackup,
  writeBackup,
  readBackup,
  restoreBackup,
} from '@agentfile/core'
```

## API

### `generate(options)`

Generates agent instruction files for the given agents.

```typescript
generate({
  root:    string,   // project root
  agents:  string[], // agent names to generate
  dryRun?: boolean   // render without writing files
})
// returns: { results: AgentResult[], success: boolean }
```

### `validateContract(options)`

Validates `contract.yaml` against the schema. Throws on invalid input.

```typescript
validateContract({ contractPath: string })
// returns: Contract
```

### `renderTemplate(template, context, skillsFormat?)`

Pure template rendering — no I/O.

```typescript
renderTemplate(template: string, ctx: RenderContext, skillsFormat?: SkillsFormat)
// returns: string
```

### Manifest helpers

Track generated-file ownership and detect drift:

- `readManifest(root)`
- `writeManifest(root, manifest)`
- `buildManifest(ownedFiles, previous)`
- `detectDrift(root, manifest)`
- `staleFiles(previous, current)`

Backup and restore generated files:

- `captureBackup(root, paths)`
- `writeBackup(root, entries, tag)`
- `readBackup(root, tag)`
- `restoreBackup(root, entries)`
- `listBackups(root)`

## v2 API (normalized configuration)

The v1 API above is unchanged and remains fully supported. Alongside it, core
exposes the deterministic v2 layers: a normalized representation of agent
configuration, a resolution engine, and stable diagnostics. See
[`docs/v2-architecture.md`](https://github.com/dennishavermans/agentfile/blob/main/docs/v2-architecture.md).

### Resolve what applies to a path

```typescript
import { loadConfigurationFromContract, resolveForPath, formatHuman } from '@agentfile/core'

const { configuration, diagnostics } = loadConfigurationFromContract({ root: process.cwd() })

const effective = resolveForPath(configuration, 'apps/mobile/src/Login.tsx')

for (const entry of effective.directives) {
  const { file, line } = entry.node.provenance
  console.log(`${entry.node.text}`)
  console.log(`  from ${file}:${line} — ${entry.reason.detail}`)
}

// Considered but not applied, with the reason why.
console.log(effective.excluded)

console.log(formatHuman([...diagnostics, ...effective.diagnostics]))
```

Instructions and directives come back ordered least- to most-specific, so the
last one wins an override and the whole list is the concatenation order.

### Diagnostics

Findings carry a stable `AGFxxx` code, a severity, a position, an explanation,
and a suggested fix. Match on codes, never on message text — see
[`docs/diagnostics.md`](https://github.com/dennishavermans/agentfile/blob/main/docs/diagnostics.md).

```typescript
import { formatJson, hasErrors, summarize } from '@agentfile/core'

process.stdout.write(formatJson(diagnostics))   // versioned, deterministic
console.log(summarize(diagnostics))             // { errors, warnings, infos, total }
process.exitCode = hasErrors(diagnostics) ? 1 : 0
```

### Target capabilities

Every capability claim is attributed to the target's own documentation.
Unverified combinations report as `unknown` rather than being guessed.

```typescript
import { capability, diagnoseCapability, supports } from '@agentfile/core'

supports('cursor', 'instructions.path-scoped')      // true
capability('claude', 'instructions.agents-md').level // 'emulated'
capability('agents-md', 'skills').level              // 'unsupported'

// Report what a compilation would lose, instead of dropping it silently.
const finding = diagnoseCapability('agents-md', 'skills', { subject: 'skill "deploy"' })
```

### Testing against in-memory fixtures

The layers take a `FileSystem`, so fixture repositories need no temp directories:

```typescript
import { loadConfigurationFromContract, memoryFileSystem } from '@agentfile/core'

const result = loadConfigurationFromContract({
  root: '/repo',
  fs: memoryFileSystem({ '/repo/ai/contract.yaml': contractYaml }),
})
```

## Benchmark

Use the built-in benchmark to measure template rendering and dry-run generation performance against a larger synthetic contract:

```bash
npm run bench -w packages/core
```

## Links

- [Full documentation](https://github.com/dennishavermans/agentfile)
- [CLI](https://www.npmjs.com/package/@agentfile/cli)

## License

MIT
