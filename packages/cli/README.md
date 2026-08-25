# @agentfile/cli

> One contract. Every AI agent. Zero clutter.

CLI for [agentfile](https://github.com/dennishavermans/agentfile) — analyse existing AI agent configuration, and scaffold, migrate, generate, validate, diff, clean, and rollback instruction files from a single `contract.yaml`.

## Usage

```bash
npx @agentfile/cli doctor
```

Analyses the AI agent configuration your repository already has — `AGENTS.md`,
`CLAUDE.md`, `.claude/rules/`, `.claude/skills/`, `.claude/agents/`,
`.cursor/rules/`, `.github/copilot-instructions.md`,
`.github/instructions/`, and `.mcp.json`.

You do not need to adopt agentfile first. `doctor` reads, reports, and changes
nothing: it runs no model, makes no network calls, and never executes a hook,
script, or MCP command it finds.

It reports what configuration exists and where, how much context loads in every
session, which rules are duplicated across platforms, skills whose description
is too thin for an agent to route on, and misconfigurations such as an MCP
server that will silently fail to load.

```bash
npx @agentfile/cli doctor --verbose        # list every file found
npx @agentfile/cli doctor --format json    # machine-readable, for CI
npx @agentfile/cli doctor --root ./apps/web
```

Exits non-zero when it finds an error, so it can gate CI.

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

```bash
npx @agentfile/cli ui
npx @agentfile/cli ui --port 3000
npx @agentfile/cli ui --root ./packages/app
```

Starts a local dashboard in your browser for inspecting your contract, previewing generated files, and monitoring drift. Defaults to port `4311`.

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
