# Changelog

All notable changes to agentfile will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added — v2 foundation (`@agentfile/core`)

The first phase of the v2 rework. Everything here is **additive**: the v1 API,
CLI commands, generated output, and manifest format are unchanged, and the
existing 144 tests pass untouched. See `docs/v2-architecture.md`.

- **Diagnostics** — stable `AGFxxx` code registry with severities, positions,
  explanations, and suggested fixes. Two formatters: human-readable, and a
  versioned deterministic JSON envelope for CI and editors. Documented in
  `docs/diagnostics.md`, kept in sync by a test.
- **Normalized IR** — a platform-neutral representation of instructions,
  directives, skills, subagents, hooks, MCP servers, permissions, artifacts, and
  docs. Every node carries provenance (file, line, platform, scope, origin).
- **Resolver** — one deterministic implementation answering what configuration
  applies to a path, why it applies, what outranks it, and what was excluded and
  for what reason. Ordering is scope, then directory depth, then specificity
  tier, then pattern specificity, then declaration order.
- **Path matching** — normalisation, ancestor chains, and glob matching with a
  documented specificity order, built on Node's `path.matchesGlob` so no
  third-party matcher is required.
- **Capability registry** — 41 rows across Claude Code, Copilot, Cursor, plain
  AGENTS.md, and Codex, each attributed to a documentation URL. Unverified
  combinations report as `unknown` rather than being guessed.
- **Position-aware YAML loading** — schema violations become located diagnostics
  instead of pre-formatted strings, so consumers no longer re-parse messages to
  find a line number.
- **Filesystem port** — `FileSystem` with real and in-memory implementations,
  making fixture-repository tests possible without temp directories.
- **Contract v1 adapter** — the existing `ai/contract.yaml` becomes a source
  feeding the IR, so nothing about the v1 format is deprecated or rewritten.

### Added — discovery and `agentfile doctor`

- **`agentfile doctor`** — analyses the AI agent configuration a repository
  already has, with no setup and no adoption required. Reports what
  configuration exists per platform, how much context loads in every session,
  rules duplicated across platforms, skills whose description is too thin to
  route on, and misconfigurations that would otherwise fail silently. Supports
  `--verbose`, `--format json`, and `--root`. Exits non-zero on errors.
  Runs no model, makes no network calls, and never executes a hook, script, or
  MCP command it finds.
- **Discovery** — reads `AGENTS.md` (root and nested), `CLAUDE.md`,
  `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/`, `.claude/skills/`,
  `.claude/agents/`, `.cursor/rules/`, `.cursorrules`, `.cursor/skills/`,
  `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`,
  `.github/skills/`, `.agents/skills/`, and `.mcp.json`. Every format is mapped
  from its own published documentation; unverified behaviour is reported as
  unknown rather than assumed.
- **Repository scanning** — one bounded walk shared by every adapter, which
  skips generated and vendored directories, does not follow symlinked
  directories, and reports truncation instead of hanging on a pathological tree.
- **Frontmatter parsing** — a single parser for every markdown agent format,
  with brace-aware splitting of `paths`, `globs`, and `applyTo` glob lists.
- **Context budget analysis** — always-loaded context measured exactly in
  characters and lines, with a token figure explicitly labelled as an estimate
  and its method named.
- **Skill routing signals** — flags descriptions that are missing, too short to
  distinguish, over the 1024-character specification limit, or that never say
  when to use the skill. This measures metadata quality, not model behaviour.

### Added — validation: `check`, `lint`, and a hardened `validate`

The three commands are three selections over one rule set, not three
implementations, which is what stops them from disagreeing about whether
something is a problem. `agentfile validate --list-rules` prints the set.

- **`agentfile check`** — fast deterministic validation for pre-commit hooks and
  editors. Runs the structural and resolution layers, which are set operations
  over data the single filesystem walk already produced: a full run takes around
  140 ms including Node startup. No network, no model, nothing executed.
  Supports `--root`, `--format json`, and `--strict`.
- **`agentfile lint`** — quality analysis: copies of a rule that have drifted
  apart, and always-loaded context measured against a budget. Deterministic and
  local, with no embeddings and no model. Supports `--budget` and `--similarity`
  to move the thresholds, plus `--root`, `--format json`, and `--strict`.
- **`agentfile validate`** — now runs every implemented layer. Gains `--target`
  (repeatable, or `all`) to check what compilation to a specific agent platform
  would lose, `--strict`, `--format json`, `--root`, and `--list-rules`.
- **`--strict`** promotes warnings to errors so a warning fails the build.
  Info-level findings are deliberately left alone: they report gaps in
  agentfile's own capability registry, and an unverified combination should not
  fail someone's CI.
- **Compatibility validation** — the features a repository actually uses are read
  off the IR and checked against the capability registry, so a finding always
  names both the feature and the target's own documentation URL. One finding per
  target and feature, not one per node.
- **New diagnostics** — `AGF303` unreachable configuration, `AGF304`
  inconsistent scope, `AGF305` near-duplicate instruction. `AGF401` context
  overload is now emitted. All documented in `docs/diagnostics.md`.

### Added — observability: `context` and `explain`

Source-map information for agent configuration. When an agent behaves
unexpectedly the question is never "what does the configuration say" — it is
"which of these nine files reached this request, and which one won". Both
commands answer that from the resolver, so neither can claim one thing while
resolution does another.

- **`agentfile context <path>`** — what applies at a path, in load order, with
  the reason for each entry, where it came from, and which platform it belongs
  to. Reports rules, available skills, repository-wide configuration, and the
  context cost at that path — separating what loads in every session from what
  is specific to the path. `--excluded` lists everything that did *not* apply
  and why, which is usually the question being asked.
- **`agentfile explain <target>`** — where one piece of configuration comes from,
  when it applies, and where else the same thing is declared. A target can be a
  file path, a skill or subagent name, or part of a rule's text; `--at <path>`
  answers whether it applies to a specific file, why or why not, and what
  outranks it there. `--kind` narrows an ambiguous query. A query that matches
  too much lists the candidates instead of printing forty explanations.

### Changed

- `SkillEntry` now carries a stable `id`, like every other IR node. This is what
  lets `explain` match a node exactly rather than by label — two nested
  `AGENTS.md` files share a label but are different configuration.
- **`agentfile validate` can now fail on findings from outside the contract.**
  The v1 behaviour is otherwise preserved exactly: when `ai/contract.yaml` is
  present it is validated first and reported in the same words, and a schema
  failure is still an immediate exit 1. What is new is that error-severity
  findings elsewhere — a `.mcp.json` server that will silently fail to load, an
  import pointing at a file that does not exist — now also fail the run. Each is
  a real defect that generation does not skip; it silently produces empty content
  instead. A repository whose CI passed before will only start failing if it has
  one of them.
- **`agentfile validate` no longer requires a contract.** A repository with an
  `AGENTS.md` and no `ai/` directory is validated on what it has instead of
  failing with "contract not found". A repository with an `ai/` directory still
  requires a valid contract there, so existing contract-based CI is unaffected.

### Fixed

- `agentfile doctor` and the validation commands now share one definition of
  repository-wide duplication, instead of `doctor` carrying its own copy that
  could drift from the rule the other commands run.
- Duplicated instructions are now found in prose, not just in structured rules:
  text shared between instruction files is compared line by line, so the same
  rule maintained separately for Claude, Copilot, and Cursor is reported as
  `AGF302` with each file's own line number.
- Broken `content_file` and `docs[].file` references are now reported as
  `AGF004` errors. Previously a typo silently produced empty content in every
  developer's generated output.
- Instruction-file imports that point at a missing path are reported as
  `AGF004`. A missing import target silently drops the instructions the file
  promises, with no error from the agent.

---

## [0.4.0] — 2026-04-08

### Added
- `ui` command (`npx @agentfile/cli ui`) — starts a local dashboard in your browser for inspecting the contract, previewing generated files, and monitoring drift
- `@agentfile/ui@0.1.0-beta.0` — Express + React application backing the `ui` command (beta, install with `npm install @agentfile/ui@beta`)
- VS Code extension `agentfile.agentfile@0.1.0` — sidebar overview, contract validation, sync/migrate/init/diff/clean/rollback commands, stale-file diagnostics (beta, marked Preview on the Marketplace)
- Biome for consistent linting and formatting across all packages (`npm run lint`, `npm run lint:fix`, `npm run format`)

### Changed
- Minimum Node.js version raised to **24.0.0** across all packages
- TypeScript upgraded to **6.x** across all packages
- Express upgraded to **5.x** in `@agentfile/ui` (breaking: wildcard routes use `/{*splat}` syntax)
- Vite upgraded to **8.x** in `@agentfile/ui`
- `diff` upgraded to **8.x** in `@agentfile/ui` (package now ships its own TypeScript declarations; `@types/diff` removed)
- All other dependencies updated to their latest releases
- **Version bumps:** `@agentfile/core` `0.4.0`, `@agentfile/cli` `0.4.0`, `@agentfile/agentfile` `0.4.0`

### Fixed
- Consistent double-quote and semicolon style applied across `@agentfile/core` source files
- `migrate` and `filter` commands use `path.relative()` instead of string replace for cross-platform path handling
- Unused imports and variables removed throughout the codebase

## [0.3.0] — 2026-03-23

### Added
- `migrate` command to import existing instruction files into `ai/contract.yaml`
- Migration source filtering with `--targets` and `--exclude`
- Migration replace policies with `--replace-policy keep|archive|delete`
- Migration backups before write and source replacement
- `clean` command for generated-file cleanup workflows
- `diff` command for manifest drift detection (CI-friendly non-zero exit on drift)
- `rollback` command to restore from `.agentfile-backup/`
- Manifest system (`.agentfile-manifest.json`) for ownership and drift tracking
- Generated-file marker support in renderer output
- Core manifest APIs in `@agentfile/core` (`readManifest`, `buildManifest`, `detectDrift`, backup helpers)

### Changed
- `migrate` internals refactored into modular files (`parser`, `merge`, `yaml`, `filter`, `types`) for maintainability
- `sync` now writes/updates manifest data and reports stale generated files
- Version bumps:
- `@agentfile/core` `0.3.0`
- `@agentfile/cli` `0.3.0`
- `@agentfile/agentfile` `0.3.0`

## [0.2.0] — 2026-03-23

### Added
- `@agentfile/core` — schema validation, YAML loading, template rendering, and generation engine
- `@agentfile/cli` — `init`, `sync`, `validate`, and `watch` commands
- `contract.yaml` spec (version 1) with `coding`, `architecture`, `testing`, and `naming` rule categories
- `skills` — define shared workflows with `context`, `steps`, `expected_output`, and `examples`
- Per-agent skill rendering — full markdown for Claude, `.mdc` per skill for Cursor, inline for Copilot
- `agents-md` agent — generates `AGENTS.md` as a universal fallback
- Per-developer agent selection via `.ai-agents` file
- Per-folder override blocks via `ai.override.yaml`
- Dynamic agent discovery — adding a new agent requires only a new folder in `ai/agents/`
- CI dry-run mode — renders all templates without writing files
- GitHub Actions workflow template generated by `agentfile init`

### Changed
- Minimum supported Node.js version is now 24
- Published wrapper package now builds from TypeScript and ships `dist/` output
- Core source is TypeScript-only; checked-in generated JavaScript and declaration files were removed from `src/`
- Core schema validation was updated for Zod 4 compatibility
