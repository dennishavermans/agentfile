# @agentfile/cli

> One contract. Every AI agent. Zero clutter.

CLI for [agentfile](https://github.com/dennishavermans/agentfile) — scaffold, migrate, generate, validate, diff, clean, and rollback AI agent instruction files from a single `contract.yaml`.

## Usage

```bash
npx @agentfile/cli init
```

Walks you through setup and scaffolds everything — `ai/contract.yaml`, agent templates, `.ai-agents.example`, and a CI workflow.

```bash
npx @agentfile/cli watch
```

Watches `ai/` for changes and automatically re-runs sync. Runs an initial sync on start. No more running sync manually after every contract change.

```bash
npx @agentfile/cli sync
```

Reads your personal `.ai-agents` file and generates the correct instruction file for each agent in its native format.

```bash
npx @agentfile/cli validate
```

Validates `ai/contract.yaml` against the schema. Exits 0 or 1. Designed for CI.

```bash
npx @agentfile/cli migrate --from .github/copilot-instructions.md --from CLAUDE.md
```

Imports existing instruction files into a draft `ai/contract.yaml`.

```bash
npx @agentfile/cli migrate --from CLAUDE.md --replace-policy archive
npx @agentfile/cli migrate --from CLAUDE.md --targets claude,copilot
```

```bash
npx @agentfile/cli diff
```

Checks generated files against `.agentfile-manifest.json`; exits non-zero when drift is found.

```bash
npx @agentfile/cli clean --dry-run
npx @agentfile/cli clean
```

Removes generated files and updates manifest ownership records.

```bash
npx @agentfile/cli rollback --list
npx @agentfile/cli rollback --tag migrate-1700000000000
```

Restores files from `.agentfile-backup/`.

## What it generates

| Agent | File |
|---|---|
| `claude` | `CLAUDE.md` |
| `copilot` | `.github/copilot-instructions.md` |
| `cursor` | `.cursor/rules/main.mdc` + one `.mdc` per skill |
| `agents-md` | `AGENTS.md` — read natively by Codex and Windsurf |

Generated files are gitignored. Each developer picks which agents they use without touching the repo.

## Your contract

```yaml
version: 1

project:
  name: My Project
  stack: [typescript, react]

rules:
  coding:
    - Prefer small composable functions
  architecture:
    - Follow feature-based folder structure

skills:
  - name: create-component
    description: Creates a new React component with tests
    steps:
      - Create /src/components/{feature}/{Name}.tsx
      - Create matching test file
      - Export from index.ts
```

## Links

- [Full documentation](https://github.com/dennishavermans/agentfile)
- [Core engine](https://www.npmjs.com/package/@agentfile/core)

## License

MIT
