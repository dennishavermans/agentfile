# @agentfile/agentfile

> Find what is wrong with the AI agent configuration your repository already has.

This is the convenience wrapper package. It re-exports the full CLI from [`@agentfile/cli`](https://www.npmjs.com/package/@agentfile/cli).

## Quick start

Point it at any repository. No setup, nothing written to disk:

```bash
npx @agentfile/agentfile doctor
```

Then:

```bash
npx @agentfile/agentfile check      # fast enough for a pre-commit hook
npx @agentfile/agentfile audit      # what hooks, skills and MCP servers could do
npx @agentfile/agentfile adopt      # plan a single source of truth
```

Available commands mirror `@agentfile/cli`:

- `init`
- `migrate`
- `sync`
- `validate`
- `watch`
- `diff`
- `clean`
- `rollback`
- `ui`

## Documentation

See the [main repository](https://github.com/dennishavermans/agentfile) for full documentation.

## License

MIT
