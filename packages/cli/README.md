# @agentfile/cli

> One contract. Every AI agent. Zero clutter.

CLI for [agentfile](https://github.com/dennishavermans/agentfile) — scaffold, generate and validate AI agent instruction files from a single `contract.yaml`.

## Usage

```bash
npx @agentfile/cli init
```

Walks you through setup and scaffolds everything — `ai/contract.yaml`, agent templates, `.ai-agents.example`, and a CI workflow.

```bash
npx @agentfile/cli sync
```

Reads your personal `.ai-agents` file and generates the correct instruction file for each agent in its native format.

```bash
npx @agentfile/cli validate
```

Validates `ai/contract.yaml` against the schema. Exits 0 or 1. Designed for CI.

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
