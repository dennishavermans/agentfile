# @agentfile/core

Core engine for [agentfile](https://github.com/dennishavermans/agentfile) — schema validation, YAML loading, template rendering, and file generation.

Use this package if you want to integrate agentfile into your own tooling or build scripts.

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

## Links

- [Full documentation](https://github.com/dennishavermans/agentfile)
- [CLI](https://www.npmjs.com/package/@agentfile/cli)

## License

MIT
