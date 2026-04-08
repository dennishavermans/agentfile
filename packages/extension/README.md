# Agentfile — VS Code Extension

> **Beta** — this extension is in early development. Expect rough edges and frequent updates. Feedback and bug reports are welcome via [GitHub Issues](https://github.com/dennishavermans/agentfile/issues).

Manage, validate, and sync [agentfile](https://github.com/dennishavermans/agentfile) contracts directly in VS Code — without leaving the editor.

---

## What is agentfile?

Your team uses GitHub Copilot, Claude, Cursor — each expecting its own instruction file, in its own format, in its own location. `agentfile` lets you define your rules **once** in `ai/contract.yaml` and generate the correct file for every agent automatically.

```
ai/contract.yaml                 ← your team's rules, committed once

CLAUDE.md                        ← generated, gitignored
.github/copilot-instructions.md  ← generated, gitignored
.cursor/rules/main.mdc           ← generated, gitignored
AGENTS.md                        ← generated, gitignored
```

This extension brings the full agentfile workflow into VS Code.

---

## Getting started

### New project

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run:

```
agentfile: Initialize Project
```

This walks you through setup and scaffolds `ai/contract.yaml`, agent templates, and a `.ai-agents.example` file.

### Existing project with instruction files

If you already have `CLAUDE.md`, `AGENTS.md`, or similar files, migrate them:

```
agentfile: Migrate Project
```

The command detects existing instruction files in your workspace, imports them into a draft `ai/contract.yaml`, and optionally archives the originals.

### Already have a contract?

Open the sidebar panel (click the agentfile icon in the Activity Bar or run `agentfile: Focus Sidebar`), then hit **Sync** to generate agent files for every agent in your `.ai-agents` file.

---

## Features

### Sidebar overview
The Activity Bar panel shows the live state of your project at a glance:
- **Agents** — each configured agent, its output file, and status (`synced`, `stale`, or `disabled`). Click an agent row to open its generated file; click a disabled agent to enable it and sync.
- **Rules** — each rule category from your contract (`coding`, `architecture`, `testing`, `naming`). Click a rule to jump to that line in `contract.yaml`.
- **Skills** — all skills defined in your contract with their descriptions.
- **Sync / Validate buttons** — run the most common actions without touching the Command Palette.

### Status bar badge
The bottom status bar shows `$(sync) agentfile (N agents)` when everything is up to date, or `$(warning) N stale` when generated files have drifted from the contract. Clicking the badge runs Sync.

### Inline diagnostics
When you save `ai/contract.yaml`, the extension validates it against the schema and reports any errors as inline squiggles and Problems panel entries — without running a terminal command.

### Auto-sync prompt
When `ai/contract.yaml` changes, a toast offers to re-sync immediately so generated files are never stale.

### Stale-file detection
If you open a file that is governed by agentfile and its generated outputs are out of date, the extension shows a warning toast with a **Sync now** shortcut.

---

## Commands

Open the Command Palette (`Cmd+Shift+P`) and search for `agentfile`:

| Command | Description |
|---|---|
| `agentfile: Focus Sidebar` | Open and focus the agentfile Activity Bar panel |
| `agentfile: Initialize Project` | Scaffold `ai/contract.yaml`, agent templates, and CI workflow |
| `agentfile: Migrate Project` | Import existing instruction files into a draft contract |
| `agentfile: Sync` | Generate agent files from the contract for your selected agents |
| `agentfile: Validate Contract` | Validate `ai/contract.yaml` schema; errors shown as inline diagnostics |
| `agentfile: Diff` | Check generated files against the manifest; reports drift in the terminal |
| `agentfile: Clean` | Remove orphaned generated files — offers dry-run preview first |
| `agentfile: Rollback` | Restore files from a previous backup — list backups or restore by tag |
| `agentfile: Open Contract` | Open `ai/contract.yaml` in the editor |
| `agentfile: Refresh` | Manually refresh the sidebar state |

---

## Your contract file

`ai/contract.yaml` is your single source of truth. A minimal example:

```yaml
version: 1

project:
  name: My Project
  stack: [typescript, react]

rules:
  coding:
    - Prefer small composable functions
    - Avoid unnecessary abstractions
  architecture:
    - Follow feature-based folder structure
  testing:
    - Critical business logic must have unit tests
  naming:
    - Boolean variables must be prefixed with is, has, or should
```

Add skills to define shared workflows that every agent understands:

```yaml
skills:
  - name: create-component
    description: Creates a new React component with tests
    steps:
      - Create /src/components/{feature}/{Name}.tsx
      - Create /src/components/{feature}/{Name}.test.tsx
      - Export from /src/components/{feature}/index.ts
    expected_output: A typed component with a matching test and barrel export
```

---

## Selecting your agents

Create a `.ai-agents` file in your project root listing the agents you personally use (one per line). This file is gitignored — teammates pick their own without touching the repo.

```
# .ai-agents — yours, not the team's
claude
copilot
```

Run `agentfile: Sync` and each agent gets its file in its native format:

| Agent | Generated file |
|---|---|
| `claude` | `CLAUDE.md` |
| `copilot` | `.github/copilot-instructions.md` |
| `cursor` | `.cursor/rules/main.mdc` + one `.mdc` per skill |
| `agents-md` | `AGENTS.md` — also read natively by Codex and Windsurf |

---

## Requirements

- VS Code `>=1.90.0`
- Node.js `>=24.0.0` on your `PATH` (used to run CLI commands in the integrated terminal)

---

## Links

- [Full documentation](https://github.com/dennishavermans/agentfile)
- [CLI on npm](https://www.npmjs.com/package/@agentfile/cli)
- [Report an issue](https://github.com/dennishavermans/agentfile/issues)

## License

MIT
