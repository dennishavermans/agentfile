# @agentfile/cli

> Find what is wrong with the AI agent configuration your repository already has.

The CLI for [agentfile](https://github.com/dennishavermans/agentfile). It reads `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.cursor/` and `.github/` as they are — no setup, no adoption step, nothing written to disk — and reports the rules that contradict each other, the context they cost every session, and what a hook, skill, command or MCP server could do.

Nothing found in a repository is ever executed.

The v1 contract workflow (`init`, `migrate`, `sync`, `watch`) is unchanged and still supported; see [migration-v2.md](https://github.com/dennishavermans/agentfile/blob/main/docs/migration-v2.md).

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
npx @agentfile/cli context src/api/handler.ts
```

What configuration actually applies to a file, in load order, with the reason for
each entry. Every instruction with its platform and why it matched, the rules and
skills available there, repository-wide configuration, and the context cost at
that path — separating what loads in every session from what is specific to the
path.

```bash
npx @agentfile/cli context src/api/handler.ts --excluded   # and why the rest did not
npx @agentfile/cli context src/api/handler.ts --format json
```

`--excluded` is usually the interesting half: it lists everything that did *not*
apply and the reason, which is what you want when a rule you wrote is not
reaching the agent.

```bash
npx @agentfile/cli explain <target>
```

The inverse question. A target can be a file path, a skill or subagent name, or
part of a rule's text.

```bash
npx @agentfile/cli explain .cursor/rules/api.mdc
npx @agentfile/cli explain deploy
npx @agentfile/cli explain "use pnpm" --at src/api/handler.ts
npx @agentfile/cli explain "use pnpm" --kind rule
```

It reports where the configuration was declared, which platform it belongs to,
when it applies, and where else the same thing is declared. With `--at`, it also
answers whether it applies to that specific file, why or why not, and what
outranks it there.

Both commands read from the same resolver every other command uses, so neither
can claim one thing while validation does another.

```bash
npx @agentfile/cli check
```

Fast deterministic validation, for pre-commit hooks and editors. Around 140 ms
including Node startup: structural and resolution checks only, over the file
listing a single filesystem walk already produced.

It reports files that will not parse, references that point at nothing, the same
rule maintained in several places, glob-scoped rules that match no file in the
repository, and rules whose scope differs between platforms.

```bash
npx @agentfile/cli check --strict        # warnings fail the run
npx @agentfile/cli check --format json
npx @agentfile/cli check --root ./apps/web
```

```bash
npx @agentfile/cli lint
```

Quality analysis: copies of a rule that have **drifted apart**, and always-loaded
context measured against a budget with the largest contributors named. Exact
comparison goes quiet at exactly the moment someone edits one copy and not the
others, which is when the configuration starts disagreeing with itself.

Similarity is measured on words, not meaning — two rules that share wording are
reported, and two that mean the same thing in different words are not. The
output says so rather than implying more than it can deliver.

```bash
npx @agentfile/cli lint --budget 2000       # tighten the context budget
npx @agentfile/cli lint --similarity 0.75   # loosen near-duplicate detection
```

```bash
npx @agentfile/cli validate
```

Strict validation across every layer. Exits 0 or 1. Designed for CI.

`ai/contract.yaml` is validated first and reported exactly as it always was, and
a schema failure is still an immediate exit 1.

```bash
npx @agentfile/cli validate --target claude   # what would compiling to Claude Code lose?
npx @agentfile/cli validate --target all
npx @agentfile/cli validate --strict          # warnings fail the run
npx @agentfile/cli validate --list-rules      # print the rule set
```

With `--target`, agentfile checks the features your configuration actually uses
against what that platform supports, and every finding cites the platform's own
documentation. Without `--target` it reports that compatibility was not checked
rather than assuming a target and failing your build over it.

`--strict` promotes warnings to errors. Info-level findings stay informational:
they report gaps in agentfile's own capability registry, and an unverified
combination should not fail your CI.

### Skills

Every `SKILL.md` is validated against the
[Agent Skills specification](https://agentskills.io/specification) — agentfile
validates against that standard rather than inventing a replacement. `check`
reports the specification breaches: a name outside the allowed characters, a name
that does not match its directory (platforms locate skills by directory, so the
skill loads under a name its own frontmatter disagrees with), and links to files
that do not exist. `lint` reports the rest: descriptions too thin to route on,
two skills an agent has no basis to choose between, bodies past the recommended
size, resources the body never mentions, and frontmatter that will not survive
being shared through claude.ai or the Skills API.

`validate` additionally inspects the scripts a skill bundles against a documented
set of risk patterns — piping a download into a shell, evaluating a variable as a
command, hardcoded credentials, `sudo`, credential-path access, and others.

**Nothing found in the repository is ever executed.** Files are read as text and
matched against patterns, even when the whole point of the file is to be run. A
clean result means "no pattern in this list matched", which is a much weaker
statement than "this is safe" — and files that could not be inspected are
reported rather than passed over.

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
