# agentfile

> One contract. Every AI agent. Zero clutter.

Your team uses GitHub Copilot, Claude, Cursor — each expecting its own instruction file, in its own format, in its own location. `agentfile` lets you define your rules once and generate the right file for each agent automatically.

Generated files are **never committed**. Each developer only generates what they personally use.

---

## The problem

Without agentfile, you maintain the same rules in multiple places — and they drift:

```
CLAUDE.md                        ← manually written
.github/copilot-instructions.md  ← manually written, probably out of date
.cursor/rules/main.mdc           ← manually written, different format
.windsurfrules                   ← someone forgot to update this one
```

Every rule change means touching four files. Every new team member copies the wrong one. Every new agent means another file to maintain forever.

---

## The solution

You write your rules once in `ai/contract.yaml`:

```yaml
version: 1

project:
  name: My Project
  stack: [typescript, react, nextjs]

rules:
  coding:
    - Prefer small composable functions
    - Avoid unnecessary abstractions
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

Then run one command:

```bash
npx @agentfile/cli sync
```

And every agent gets the right file in the right format:

```
✔ claude     → CLAUDE.md
✔ copilot    → .github/copilot-instructions.md
✔ cursor     → .cursor/rules/main.mdc
✔ cursor:skill:create-component → .cursor/rules/skills/create-component.mdc
✔ agents-md  → AGENTS.md
```

Each agent receives its rules in its own native format — Claude gets readable markdown, Cursor gets structured `.mdc` with frontmatter, Copilot gets compact inline context. The contract is the same. The output adapts.

---

## How it works

```
ai/contract.yaml        ← your team's rules, committed once
ai/agents/              ← agent templates, committed once

CLAUDE.md               ← gitignored, generated per-developer
.cursor/rules/main.mdc  ← gitignored, generated per-developer
.github/copilot-instructions.md  ← gitignored, generated per-developer
AGENTS.md               ← gitignored, generated per-developer
```

---

## Getting started

```bash
npx @agentfile/cli init
```

The `init` command walks you through your project name, stack, and which agents your team uses — then scaffolds everything.

After init, generate your personal agent files:

```bash
npx @agentfile/cli sync
```

---

## Installation

For teams that want `agentfile` as a project dependency:

```bash
npm install --save-dev @agentfile/cli
```

Add to `package.json`:

```json
{
  "scripts": {
    "ai:sync":     "agentfile sync",
    "ai:validate": "agentfile validate"
  }
}
```

---

## Commands

### `npx @agentfile/cli init`
Interactive setup. Scaffolds `ai/contract.yaml`, agent templates, `.ai-agents.example`, and a CI workflow. Safe to run in existing projects — never overwrites existing files.

### `npx @agentfile/cli sync`
Reads your personal `.ai-agents` file and generates the corresponding instruction files.

```bash
npx @agentfile/cli sync             # generate files
npx @agentfile/cli sync --dry-run   # render without writing — used in CI
```

### `npx @agentfile/cli validate`
Validates `ai/contract.yaml` against the schema. Fast, exits 0 or 1. Designed for CI.

---

## Your rules file

`ai/contract.yaml` is your single source of truth:

```yaml
version: 1

project:
  name: My Project
  stack:
    - typescript
    - react
    - nextjs

rules:

  coding:
    - Prefer small composable functions
    - Avoid unnecessary abstractions

  architecture:
    - Follow feature-based folder structure
    - Avoid cross-feature imports

  testing:
    - Critical business logic must have unit tests

  naming:
    - Use descriptive variable names
    - Boolean variables must be prefixed with is, has, or should
```

---

## Personal agent selection

Each developer creates a `.ai-agents` file (gitignored) listing the agents they personally use:

```
# .ai-agents — yours, not the team's
claude
cursor
```

A committed `.ai-agents.example` documents the available options for new joiners.

---

## Skills

Skills define shared workflows that every agent understands. Define them once — each agent receives them in its own format.

```yaml
version: 1

project:
  name: My Project
  stack: [typescript, react]

rules:
  coding:
    - Prefer small composable functions

skills:
  - name: create-component
    description: Creates a new React component with tests
    context:
      - Components live in /src/components/{feature}/
      - Always use TypeScript, never .jsx
    steps:
      - Create /src/components/{feature}/{Name}.tsx
      - Create /src/components/{feature}/{Name}.test.tsx
      - Export from /src/components/{feature}/index.ts
    expected_output: A typed component with a matching test and barrel export
    examples:
      - input: "create a UserCard component"
        output: "src/components/users/UserCard.tsx + test + index"
```

Each agent receives skills in its native format:

| Agent | Output |
|---|---|
| Claude | Appended to `CLAUDE.md` as markdown sections |
| Cursor | One `.mdc` file per skill in `.cursor/rules/skills/` |
| Copilot | Compact inline bullets in `copilot-instructions.md` |
| AGENTS.md | Full markdown — also read natively by Codex and Windsurf |

---

## Supported agents

| Agent | Generated file |
|---|---|
| `claude` | `CLAUDE.md` |
| `copilot` | `.github/copilot-instructions.md` |
| `cursor` | `.cursor/rules/main.mdc` + one `.mdc` per skill |
| `agents-md` | `AGENTS.md` — read natively by Codex and Windsurf |

Adding a new agent requires only a new folder in `ai/agents/`. No generator changes, no config edits.

---

## Per-folder overrides (monorepos)

Create an `ai.override.yaml` in any package directory to inject additional context into generated files for that package:

```yaml
blocks:
  - section: Frontend Context
    content: |
      This package is a Next.js frontend.
      Prefer React Server Components by default.
      All API calls go through /lib/api — never call fetch directly.
```

Run `npx @agentfile/cli sync` from that directory and the override is injected automatically.

---

## Adding a new agent

Drop a new folder into `ai/agents/`:

```
ai/agents/windsurf/
  config.yaml
  template.md
```

`config.yaml` declares the agent name and output path:

```yaml
name: Windsurf
output: .windsurfrules
description: Windsurf AI rules file
```

`template.md` is your instruction template using `${token}` syntax:

```
# ${project.name} Rules

## Coding
${rules.coding}

## Architecture
${rules.architecture}

## Skills
${skills}
```

---

## Available tokens

| Token | Output |
|---|---|
| `${project.name}` | Project name |
| `${project.stack.join(', ')}` | Stack as comma-separated string |
| `${rules.coding}` | Coding rules as markdown bullets |
| `${rules.architecture}` | Architecture rules as markdown bullets |
| `${rules.testing}` | Testing rules as markdown bullets |
| `${rules.naming}` | Naming rules as markdown bullets |
| `${skills}` | Skills rendered in agent-native format |
| `${override}` | Injected override blocks (if any) |

---

## CI integration

`agentfile init` generates a GitHub Actions workflow for you. It runs two checks on every change to `ai/`:

```yaml
- name: Validate contract schema
  run: npx @agentfile/cli validate

- name: Dry-run generation
  run: npx @agentfile/cli sync --dry-run
```

The dry-run renders all templates without writing files — catching broken templates and invalid contracts before they reach developers.

---

## .gitignore

Add the following to your `.gitignore`:

```
# agentfile — personal config and generated files
.ai-agents
CLAUDE.md
.github/copilot-instructions.md
.cursor/
.windsurfrules
AGENTS.md
ai.override.yaml
```

---

## Programmatic usage

`@agentfile/core` is available as a standalone package for teams that want to integrate agentfile into their own tooling:

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

---

## Packages

| Package | Description |
|---|---|
| [`@agentfile/core`](https://www.npmjs.com/package/@agentfile/core) | Core engine — schema, loader, renderer, generator |
| [`@agentfile/cli`](https://www.npmjs.com/package/@agentfile/cli) | CLI — `init`, `sync`, `validate` commands |

---

## Contributing

agentfile is in early development. Issues and PRs welcome.

1. Clone the repo
2. `npm install` from the root
3. `npm run build` to build all packages
4. `npm test` to run all tests

---

## License

MIT
