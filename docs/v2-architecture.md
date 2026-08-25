# Agentfile v2 — Architecture Audit and Direction

> **Status:** Phase 0 deliverable (architecture audit).
> **Scope:** describes the repository as it actually exists at `0.4.0`, the architectural
> problems found, the proposed v2 direction, and the incremental migration strategy.
> **Source of truth for intent:** `REWORK.md`. This document is the source of truth for
> *what the code currently is* and *what we will change*.

---

## 1. Baseline verification

Everything below was verified against a clean checkout before any v2 work started.

| Check | Command | Result |
|---|---|---|
| Tests | `npm test` | 144 passing (core 106, cli 38) |
| Build | `npm run build` | all 5 packages build |
| Typecheck | `npm run typecheck` | clean |
| Lint | `npm run lint` | 3 warnings, 47 infos, 0 errors |
| Node | `engines` | `>=24.0.0` (verified on v26.4.0) |

The baseline is green. Every phase below must keep it green.

---

## 2. Current architecture

### 2.1 Workspace layout

```text
agentfile/  (npm workspaces, private root)
├── packages/core        @agentfile/core        0.4.0      1,228 LOC src
├── packages/cli         @agentfile/cli         0.4.0      1,670 LOC src
├── packages/agentfile   @agentfile/agentfile   0.4.0          1 file (bin re-export)
├── packages/ui          @agentfile/ui          0.1.0-beta.0   380 LOC server + React app
└── packages/extension   agentfile (vsix)       0.1.0      1,224 LOC src
```

Dependency graph today:

```text
                    ┌──────────────────┐
                    │ @agentfile/core  │  zod, yaml
                    └────────┬─────────┘
            ┌────────────────┼────────────────┬──────────────────┐
            │                │                │                  │
   ┌────────▼───────┐ ┌──────▼──────┐  ┌──────▼───────┐  ┌───────▼────────┐
   │ @agentfile/cli │ │ @agentfile/ │  │  extension   │  │ (external      │
   │  commander     │ │ ui  express │  │  vscode api  │  │  consumers)    │
   └────────┬───────┘ └─────────────┘  └──────┬───────┘  └────────────────┘
            │                ▲                │
            │ depends on ────┘                │ shells out to CLI binary
            │                                 │ (extension.ts buildCliCommand)
   ┌────────▼──────────────┐                  │
   │ @agentfile/agentfile  │◄─────────────────┘
   │ (published wrapper)   │
   └───────────────────────┘
```

Note the cycle-ish shape: `cli` depends on `ui` (for the `ui` command), `ui` depends on
`core`, and `extension` depends on `core` *and* invokes the `cli` binary as a subprocess.

### 2.2 Core modules

| File | LOC | Responsibility |
|---|---|---|
| `packages/core/src/schema.ts` | 185 | Zod schemas for `contract.yaml`, agent `config.yaml`, `ai.override.yaml` |
| `packages/core/src/loader.ts` | 107 | fs read + YAML parse + Zod validate; agent folder discovery |
| `packages/core/src/renderer.ts` | 312 | `${token}` substitution, skill renderers, preserve-zones |
| `packages/core/src/generator.ts` | 257 | orchestration, artifact expansion, file writes |
| `packages/core/src/manifest.ts` | 277 | content hashing, ownership, drift detection, backups |
| `packages/core/src/index.ts` | 90 | public barrel |

### 2.3 Data flow today

```text
.ai-agents  (personal agent selection, one name per line)
ai/contract.yaml            ─┐
ai/agents/<name>/config.yaml ├─► loader.ts ──► Zod-validated objects
ai/agents/<name>/template.md ┤
ai.override.yaml (CWD only) ─┘
                                     │
                                     ▼
                           renderer.ts  buildTokenMap()
                           (closed token map, regex replace)
                                     │
                                     ▼
                           generator.ts  writeOutput()
                           + addMarker()  + preserve zones
                                     │
                                     ▼
                    CLAUDE.md / AGENTS.md / .cursor/rules/*.mdc /
                    .github/copilot-instructions.md / artifact files
                                     │
                                     ▼
                    .agentfile-manifest.json  (hash + ownership)
```

The contract *format* and the internal *model* are the same object. There is no
intermediate representation: `Contract` (a Zod output type) is passed straight into the
renderer and the generator.

### 2.4 CLI surface (must not regress)

`init`, `migrate`, `sync`, `validate`, `watch`, `clean`, `diff`, `rollback`, `ui` —
wired in `packages/cli/src/bin.ts`.

---

## 3. What is genuinely good and must be preserved

1. **`manifest.ts` is the strongest module in the repo.** SHA-256 content hashing,
   ownership classification (`owned` / `preserved` / `unmanaged`), drift detection,
   stale-file detection, and backup/restore. This is exactly the "provenance and
   traceability" primitive REWORK §23 asks for, already built. Reuse as-is.
2. **Preserve zones** (`renderer.ts:248-284`) — `<!-- agentfile:preserve id="x" -->`
   round-trips hand-written content through regeneration. A real, non-obvious feature.
3. **Template-driven artifacts** (`schema.ts:102-133`, `generator.ts:79-175`) — the
   `artifact_templates` map keyed by an open-ended `type` string is already an adapter
   seam. New output kinds need no engine change.
4. **Dynamic agent discovery** (`loader.ts:85-91`) — a new target is a new folder.
5. **Migration parser** (`packages/cli/src/commands/migrate/parser.ts`, 260 LOC) — a
   working heuristic markdown-section parser. This is the seed of Phase 2 discovery.
6. **Test discipline** — 144 tests, fast, no network. Keep the bar.
7. **Packaging** — five packages with clean publish scripts, correct `exports`, LICENSE.

---

## 4. Architectural problems

Ranked by how much they block the v2 mission.

### P1 — Platform knowledge is hardcoded inside the engine

REWORK §7 requires platforms to be adapters. Today the generator special-cases them:

```ts
// packages/core/src/generator.ts:216-217
const skillsFormat: SkillsFormat =
  agentName === "copilot" ? "copilot" : agentName === "agents-md" ? "agents-md" : "markdown";

// packages/core/src/generator.ts:229-233
if (agentName === "cursor") {
  const skillResults = generateCursorSkillFiles(root, contract, dryRun, markers);
  ...
}
```

The engine matches on agent *folder names*. Renaming `ai/agents/cursor/` to
`ai/agents/cursor-ide/` silently stops generating per-skill `.mdc` files. Adding a
platform that needs per-entity fan-out requires editing core.

### P2 — There is no resolution engine

REWORK §9 calls resolution a core primitive. Today:

```ts
// packages/core/src/generator.ts:189-191
const contractPath  = join(root, "ai", "contract.yaml");
const agentsDir     = join(root, "ai", "agents");
const overridePath  = join(root, "ai.override.yaml");
```

`root` is always `process.cwd()`. Monorepo support is "cd into the package and re-run
sync". There is no hierarchy walk, no path matching, no precedence, no inheritance, and
no way to answer *"what applies to `apps/mobile/src/Login.tsx`?"*. `agentfile context`
and `agentfile explain` have nothing to be built on.

### P3 — No diagnostics model

Errors are thrown `Error` objects with pre-formatted human strings:

```ts
// packages/core/src/loader.ts:20-28
export class ValidationError extends Error {
  constructor(public readonly file: string, public readonly issues: string[]) {
    super(`Validation failed in ${file}:\n${issues.map((i) => `  • ${i}`).join("\n")}`);
```

Consequences: no stable codes, no severities, no line/column (Zod's `issue.path` is
flattened to a string at `loader.ts:46-50`), no `--format json`, no way for the VS Code
extension to place squiggles reliably, and no way for CI to filter by severity. The
extension already has to re-derive positions itself (`extension/src/yaml-helpers.ts`).

### P4 — Validation is schema-only, and silently tolerates broken references

`agentfile validate` is one call to `loadContract` (`cli/src/commands/validate.ts:14`).
Nothing checks that referenced files exist. Worse, the generator *silently* substitutes
empty content for missing files:

```ts
// packages/core/src/generator.ts:147-152
if (artifact.content_file) {
  const bodyPath = join(root, artifact.content_file);
  if (existsSync(bodyPath)) { body = readFileSync(bodyPath, "utf-8"); }
}   // ← no else: a typo'd content_file produces an empty ${body}, no warning
```

`docs[].file` (`renderer.ts:185-192`) is likewise never checked for existence.

### P5 — No target capability model

Because every target's output is a user-authored template, agentfile cannot know that,
say, Copilot path-specific instructions only apply to a subset of surfaces, or that a
given target has no concept of a subagent. REWORK §12 ("compatibility validation") and
§22 ("do not invent capabilities") need an explicit registry. There is none.

### P6 — Agentfile is useless in repositories that have not adopted it

`generate()` hard-requires `ai/contract.yaml`. REWORK §8/§35 make "works on an arbitrary
messy repo" the primary adoption wedge (`agentfile doctor`). The only code that reads
foreign formats is the CLI-local migrate parser, which is not reachable from `core`,
`ui`, or the extension.

### P7 — Three independent implementations of "is it in sync"

| Location | Method |
|---|---|
| `packages/core/src/manifest.ts:163-178` | SHA-256 content hash vs manifest (correct) |
| `packages/ui/server.ts:52-88` | `contract.mtimeMs > output.mtimeMs` |
| `packages/extension/src/project-state.ts:39-63` | `contract.mtimeMs > output.mtimeMs` |

The two mtime versions report drift after a no-op `touch` and miss drift when a file is
edited and back-dated. REWORK §10 explicitly forbids this duplication.

### P8 — Closed rule vocabulary leaks across five packages

`rules` is fixed to exactly `coding | architecture | testing | naming`
(`schema.ts:75-88`) and that list is re-hardcoded in `renderer.ts:233-243`,
`cli/commands/migrate/parser.ts:6-11`, `cli/commands/migrate/yaml.ts`,
`ui/server.ts`, `extension/src/project-state.ts:70-79`, and the UI React app. Any new
category is a six-package change.

### P9 — The `skills` schema is an invented format

`SkillSchema` (`schema.ts:10-17`) defines `steps`, `expected_output`, `examples`.
REWORK §15 is explicit: *"Do not invent a replacement for `SKILL.md`."* The Agent Skills
standard (see §8 below) is a real, widely-adopted external spec that agentfile should
consume as a first-class input, not shadow.

### P10 — I/O is interleaved with logic

`loader.ts`, `generator.ts`, and `manifest.ts` all call `fs` directly. There is no
filesystem port, so there is no in-memory testing, no caching, and no way to make
`agentfile check` fast on a large repo (REWORK §30).

### P11 — Unknown tokens fail silently

`renderTemplate` builds its regex from the *known* token keys
(`renderer.ts:303-305`), so `${rules.codin}` is left verbatim in the output with no
diagnostic. A typo ships to every developer's `CLAUDE.md`.

### P12 — `clean` documents its own incompleteness

`cli/src/commands/clean.ts:29-33` contains a comment explaining that a proper stale
check requires re-running generation in dry-run mode, which it does not do. This is a
symptom of P2/P3: without shared primitives, each command reimplements a partial view.

---

## 5. Verified platform facts (research inputs)

REWORK §8 and §22 forbid inventing platform behavior. These facts were read from the
vendors' own documentation and are the authority for the discovery and capability layers.
Re-verify before extending any adapter — these formats move.

### 5.1 `AGENTS.md` — <https://agents.md/>
- Plain Markdown, **no frontmatter, no required structure**.
- Placed at repo root; **nested `AGENTS.md` in subdirectories is supported**, and agents
  read the *nearest* file in the directory tree — the closest one takes precedence.
- Explicit user prompts override file instructions; subproject files supersede root.
- Read by a broad set of tools; some require opt-in configuration.

### 5.2 Claude Code `CLAUDE.md` — <https://code.claude.com/docs/en/memory>
- Scopes, broadest → most specific: **managed policy** (OS-specific system path) →
  **user** `~/.claude/CLAUDE.md` → **project** `./CLAUDE.md` *or* `./.claude/CLAUDE.md` →
  **local** `./CLAUDE.local.md`.
- Files in the CWD **and every ancestor directory** load at launch. Subdirectory files
  load **on demand** when Claude reads files there.
- **Discovered files are concatenated, not overridden.** Order is filesystem-root → CWD;
  within a directory, `CLAUDE.local.md` is appended after `CLAUDE.md`.
- `@path/to/file` imports: relative to the *importing file*, recursive, **max depth 4**,
  skipped inside code spans/fences.
- Claude Code reads `CLAUDE.md`, **not** `AGENTS.md`; the documented bridge is a
  `@AGENTS.md` import or a symlink.
- Guidance: **target under 200 lines** per file; files over 4 MiB are skipped.
- `.claude/rules/*.md` — recursive discovery; optional `paths:` frontmatter (glob list)
  scopes a rule to matching files; rules without `paths` load unconditionally.
  Brace expansion is bounded (documented budget of 1,000 expanded patterns / 4 MiB).
- `claudeMdExcludes` (glob list, merged across settings layers) suppresses files.

### 5.3 Agent Skills / `SKILL.md` — <https://agentskills.io/specification>
Directory: `skill-name/SKILL.md` (required) plus optional `scripts/`, `references/`,
`assets/`. Frontmatter, with exact constraints:

| Field | Required | Constraint |
|---|---|---|
| `name` | yes | 1–64 chars, lowercase `a-z0-9` + `-`, no leading/trailing hyphen, **no `--`**, **must match the parent directory name** |
| `description` | yes | 1–1024 chars, non-empty; should state *what* and *when* |
| `license` | no | license name or bundled file reference |
| `compatibility` | no | 1–500 chars |
| `metadata` | no | map of string → string |
| `allowed-tools` | no | space-separated tool list (experimental) |

Progressive disclosure: metadata (~100 tokens) at startup → body on activation
(**< 5000 tokens recommended, keep `SKILL.md` under 500 lines**) → resources on demand.
References should be relative paths, **one level deep**.

Claude Code accepts the six spec fields plus its own extensions (`when_to_use`, `paths`,
`allowed-tools`, `disallowed-tools`, `model`, `effort`, `disable-model-invocation`, …).
Claude Code truncates `description` + `when_to_use` at **1,536 characters** in the skill
listing. Non-spec keys are rejected by claude.ai uploads / the Skills API — a real
portability constraint agentfile should report.

### 5.4 Cursor — <https://cursor.com/docs/context/rules>
`.cursor/rules/*.mdc`, version-controlled. Frontmatter: `description`, `globs`,
`alwaysApply`. Four application modes: always / apply-intelligently (by description) /
auto-attach (by glob) / manual (`@`-mention). Nested `.cursor/rules` supported;
`AGENTS.md` supported as a metadata-free alternative, root and nested.

### 5.5 GitHub Copilot — <https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions>
Three kinds: repo-wide `.github/copilot-instructions.md`; path-specific
`.github/instructions/NAME.instructions.md` with **`applyTo`** frontmatter (comma-separated
globs, optional `excludeAgent`); and `AGENTS.md` anywhere (nearest wins), with
`CLAUDE.md`/`GEMINI.md` accepted at the root. Precedence: personal > repository >
organization, but all applicable instructions are supplied together. **Path-specific
instructions currently apply only to the Copilot cloud agent and Copilot code review** —
a concrete `degraded`/`unsupported` capability fact.

### 5.6 MCP configuration — <https://code.claude.com/docs/en/mcp>
Project scope is `.mcp.json` at the repo root, `{ "mcpServers": { "<name>": { … } } }`.
Entry shape: `command` + `args` + `env` for stdio; `type` (`http` / `streamable-http`
alias / `sse` / `ws`) + `url` + `headers` for remote; optional `timeout` (ms).
**An entry with `url` but no `type` is a configuration error** — a deterministic,
checkable rule. Other scopes (`local`, `user`) live in `~/.claude.json`, not the repo.

### 5.7 Claude Code subagents — <https://code.claude.com/docs/en/sub-agents>
`.claude/agents/**/*.md` (project, discovered by walking up; nearest wins) and
`~/.claude/agents/`. Required frontmatter `name` (lowercase + hyphens, **cannot contain
`:`**) and `description`. Optional: `tools`, `disallowedTools`, `model`,
`permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`,
`effort`, `isolation`, `color`, `initialPrompt`.

---

## 6. Industry patterns adopted

Researched so v2 follows established tooling conventions rather than inventing them.

### 6.1 ESLint flat config — per-file resolution
<https://eslint.org/docs/latest/use/configure/configuration-files>

- Configuration is an **ordered array of objects**; for a given file, *every* matching
  object applies and they are **merged in declaration order, later wins**.
- `files` / `ignores` are glob-based; `ignores` alone = global, `ignores` alongside other
  keys = scoped to that object.
- `--inspect-config` exists specifically so a developer can ask *"which config objects
  apply to this file?"*.

**Adopted:** the resolver is an ordered list of scoped nodes, merged deterministically,
and `agentfile context <path>` is our `--inspect-config`. This also matches the
`CLAUDE.md` concatenation semantics in §5.2 — the same mental model works for both.

### 6.2 ESLint rule metadata — diagnostics design
<https://eslint.org/docs/latest/extend/custom-rules>

- `meta.type` (`problem` / `suggestion` / `layout`), `meta.docs` (incl. a URL),
  `meta.messages` keyed by **`messageId`** so the message text can change without
  breaking consumers, `meta.fixable`, `meta.hasSuggestions`.
- Reports carry a location, a `messageId`, and interpolation `data` — not a
  pre-formatted string.

**Adopted:** `Diagnostic` carries a stable `code`, a `messageId`-style separation of
identity from prose, a location, structured `data`, and an optional `suggestion`.
Formatting is a separate concern (human formatter vs JSON formatter), exactly as ESLint
separates rules from formatters.

### 6.3 Other conventions taken as given
- **Severity + non-zero exit** for CI (ESLint, tsc, Biome).
- **Codes in bands** with a documented, frozen taxonomy (TypeScript `TSxxxx`,
  Rust `Exxxx`, Ruff `E501`-style prefixes).
- **A fast local check vs a strict CI validate** (`tsc --noEmit` vs full build;
  `eslint --cache`).
- **Stable machine output** as a first-class format, not a debug afterthought.

---

## 7. Proposed v2 architecture

### 7.1 Principle: additive layers inside the existing packages

We do **not** create new packages and do **not** move `loader.ts` / `renderer.ts` /
`generator.ts` / `manifest.ts`. Their exported API stays byte-compatible. v2 adds new
directories under `packages/core/src/` and new commands under `packages/cli/src/`.

```text
packages/core/src/
├── schema.ts            (unchanged — contract v1 format schema)
├── loader.ts            (unchanged)
├── renderer.ts          (unchanged — becomes a compiler building block)
├── generator.ts         (unchanged in Phase 1; refactored in Phase 7)
├── manifest.ts          (unchanged)
├── index.ts             (additive exports only)
│
├── diagnostics/         NEW  codes, Diagnostic type, builder, human + JSON formatters
├── paths/               NEW  glob matching, specificity ordering, path normalization
├── ir/                  NEW  platform-neutral intermediate representation + provenance
├── capabilities/        NEW  target capability registry (facts from §5)
├── resolver/            NEW  path → effective configuration, with explanation
├── adapters/            NEW  contract v1 → IR  (Phase 1)
├── discovery/           Phase 2  foreign-format discovery (AGENTS.md, CLAUDE.md, …)
├── analysis/            Phase 3/5  lint + skill quality + context budget
├── security/            Phase 6  static risk analysis
└── compilers/           Phase 7  target adapters over the IR
```

Target pipeline (REWORK §6):

```text
discovery ─► parsers ─► IR ─► resolver ─► effective config ─► validation/analysis
                                                                      │
                                                        optional evaluation
                                                                      │
                                                                  compiler ─► native output
```

### 7.2 The IR

Designed from what the repo already models plus the verified platform facts. Every node
carries provenance, because provenance is what makes `context`, `explain`, diagnostics,
and lossy-compilation reporting possible from one primitive.

```text
Provenance { file, line?, column?, platform, scope, origin }
   platform : "agentfile" | "claude" | "copilot" | "cursor" | "agents-md" | "codex" | …
   scope    : "managed" | "user" | "project" | "directory" | "local"
   origin   : "declared" | "derived" | "imported" | "generated"

AgentConfiguration
├── instructions  Instruction[]   markdown body + applies-to (paths|always) + provenance
├── skills        SkillEntry[]    Agent Skills shape (§5.3) + resources + provenance
├── subagents     SubagentEntry[] name/description/tools/model + provenance
├── hooks         HookEntry[]     event + matcher + command (never executed)
├── mcpServers    McpServerEntry[] stdio | http | sse | ws
├── permissions   PermissionRule[] allow/deny/ask
├── artifacts     ArtifactEntry[]  carried over from contract v1 (open `type`)
├── docs          DocEntry[]
└── metadata      { project, stack, … }
```

Constraints: the IR imports nothing platform-specific; platform identity lives only in
`Provenance.platform` and in the capability registry. A new platform = a discovery
adapter + a compiler adapter + capability rows. No IR change.

### 7.3 Diagnostics

Code bands follow the taxonomy illustrated in REWORK §13 exactly, so the codes named
there keep their meaning:

| Band | Domain | Anchored by REWORK §13 |
|---|---|---|
| `AGF0xx` | configuration & structure | `AGF001 invalid configuration` |
| `AGF1xx` | skills | `AGF101 invalid skill`, `AGF102 missing skill metadata` |
| `AGF2xx` | targets & compatibility | `AGF201 unsupported target feature` |
| `AGF3xx` | instructions & resolution | `AGF301 conflicting instructions`, `AGF302 duplicate instruction` |
| `AGF4xx` | context budget | `AGF401 context overload` |
| `AGF5xx` | security | `AGF501 security issue` |
| `AGF6xx` | behavioral evaluation | `AGF601 behavioral regression` |

A `Diagnostic` carries: `code`, `severity`, `message`, optional `explanation`,
`suggestion`, `location` (file + line/col + range), `related` locations, and structured
`data`. Two formatters ship: a human formatter that produces the REWORK §13
"Conflict: package manager" shape, and a versioned JSON formatter for
`--format json`.

### 7.4 Resolution

Deterministic, and explainable by construction. For a target path:

1. normalize the path, compute its ancestor chain;
2. select every configuration node whose scope matches (always-on, ancestor-directory,
   or `paths`/`globs`/`applyTo` glob match);
3. order by **scope rank, then directory depth, then declaration order** — matching both
   ESLint's later-wins array semantics (§6.1) and Claude Code's root→leaf concatenation
   (§5.2);
4. return the ordered list *plus* the reason each node was selected.

Merge strategy is per-kind and explicit: instructions **concatenate** (that is what the
platforms actually do — §5.2), while single-valued settings **override** and record the
overridden node so `explain` and `AGF301` can name both sides.

### 7.5 Capabilities

A registry of `(target, feature) → supported | unsupported | emulated | degraded | unknown`
with a note and a doc URL. Seeded only from §5 facts; anything unresearched is
`unknown`, never assumed. This is what lets `compile` report what is lost instead of
silently dropping it.

### 7.6 Filesystem port

A narrow `FileSystem` interface (`readFile`, `exists`, `readDir`, `stat`) with a real
implementation and an in-memory one. New subsystems take it as a parameter; existing
modules keep their direct `fs` calls until Phase 7. This unlocks fixture-repo tests and
future caching without a big-bang refactor.

---

## 8. Migration strategy and backward compatibility

| Concern | Guarantee |
|---|---|
| `contract.yaml` version | stays `1`. No v2 schema is introduced until a migration path exists and is tested (REWORK §26). |
| Existing core exports | unchanged; `index.ts` only gains exports. |
| CLI commands | all nine keep their flags, output shape, and exit codes. New commands are added, none repurposed. |
| Generated output | byte-identical for unchanged inputs; snapshot tests enforce it. |
| Manifest format | `version: 1` unchanged. |
| UI / extension | keep working against the current core API; they migrate to shared primitives incrementally (fixes P7). |
| Node / TS | no floor changes. |

The v1 contract is not deprecated — it becomes *one* discovery source feeding the IR via
`adapters/contract-v1`, exactly like `AGENTS.md` or `SKILL.md` will be.

---

## 9. Implementation plan

Mapped onto REWORK §28. Each phase ends with: tests green, build green, docs updated,
backward compatibility verified.

| Phase | Deliverable | Status |
|---|---|---|
| **0** | this document | **done** |
| **1** | `diagnostics/`, `paths/`, `ir/`, `capabilities/`, `resolver/`, `adapters/contract-v1`, tests | **done** — see §11 |
| 2 | `discovery/` + `agentfile doctor` | **done** — see §12 |
| 3 | `agentfile check` / hardened `validate` / `lint` on shared primitives | **done** — see §13 |
| 4 | `agentfile context <path>` / `agentfile explain` | **done** — see §14 |
| 5 | `SKILL.md` parsing, validation, linting, analysis | **done** — see §15 |
| 6 | `agentfile audit` (static only) | **done** — see §16 |
| 7 | compilers over the IR + `agentfile compile` | **done** — see §17 |
| 8 | `agentfile eval` with deterministic assertions in a sandbox | **done** — see §18 |
| 9 | optional AI judge | not started |

Deliberately **not** built yet (REWORK §11 "do not implement commands prematurely"):
`adopt`, `eval`, `skill *`, registry/marketplace, embeddings.

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Platform formats change under us | every fact in §5 is dated, attributed, and re-verified before an adapter ships; unresearched features are `unknown`, never guessed |
| R2 | Scope creep into a rewrite | new code is additive; the four legacy core modules are untouched until Phase 7 |
| R3 | Diagnostic codes churn | taxonomy frozen in §7.3 and anchored to REWORK §13; codes are append-only |
| R4 | Glob semantics diverge between platforms (minimatch vs picomatch vs brace budgets) | one matcher behind `paths/` — Node's built-in `path.matchesGlob`, zero dependencies (see §11.2); dot-directory behaviour pinned by test; divergences recorded as capability rows |
| R5 | `check` becomes slow | filesystem port + explicit no-network/no-LLM rule; benchmarks in `packages/core/benchmarks` |
| R6 | Two models coexisting (contract vs IR) confuses contributors | contract v1 is explicitly *a discovery source*, documented here and in code comments |
| R7 | Security analysis over-promises | diagnostics phrase risk, never safety; nothing untrusted is ever executed during static analysis (REWORK §21/§33) |
| R8 | UI/extension drift while core moves | P7 duplication is retired by pointing both at the shared resolver/manifest primitives |

---

## 11. Phase 1 as built

Delivered, with the full suite green: **300 tests** (262 core, 38 CLI), build,
typecheck, and lint all clean, and the pre-existing 144 tests untouched and
passing.

### 11.1 What shipped

| Module | Purpose |
|---|---|
| `core/src/diagnostics/` | frozen `AGFxxx` registry, `Diagnostic` type, human + JSON formatters, summary/exit-code helpers |
| `core/src/paths/` | path normalisation, ancestor chains, glob matching, documented specificity ordering |
| `core/src/ir/` | platform-neutral IR with provenance on every node, plus merge/id helpers |
| `core/src/capabilities/` | 41 sourced capability rows over 12 features and 5 targets, and capability→diagnostic mapping |
| `core/src/resolver/` | the single resolution implementation, with per-node match reasons, exclusion reasons, and rank exposure |
| `core/src/fs/` | two-method filesystem port with real and in-memory implementations |
| `core/src/yaml/` | position-aware YAML loading; Zod issues → located diagnostics |
| `core/src/adapters/` | contract v1 → IR, reference checking, non-throwing load |
| `docs/diagnostics.md` | public code reference, kept in sync by a test |

`packages/core/src/index.ts` gained exports only. `schema.ts`, `loader.ts`,
`renderer.ts`, `generator.ts`, and `manifest.ts` were not modified.

### 11.2 Decisions that differ from the Phase 0 plan

**Glob matcher: Node built-in, not `picomatch`.** §7 assumed a third-party
matcher. Node's `path.matchesGlob` (present since v22.5, stable since v24.8)
was verified against every pattern form the platforms actually use — globstars,
single-star segment boundaries, brace alternatives, directory patterns — and
handled all of them. It ships zero dependencies and no `@types` package, so it
wins on both supply chain and maintenance. It is used only inside `paths/`, so
swapping engines later is a one-file change. The one semantic worth knowing —
a leading `*` does not match a leading dot, so `**/*.md` does not match
`.claude/rules/x.md` — is pinned by test rather than left to discovery.

**Reserved codes are declared but not emitted.** `AGF101`, `AGF102`, `AGF301`,
`AGF401`, `AGF501`, and `AGF601` carry `status: "reserved"`. The taxonomy is
fixed now so it stays stable, but nothing emits them, so no consumer sees a code
appear without a release note. `AGF301` in particular needs typed settings or
negation analysis to detect deterministically, so it waits for the analysis
layer rather than shipping as a heuristic.

**AGF004 is an error, not a warning.** The v1 generator substitutes empty
content for a missing `content_file`, so the failure currently ships to every
developer's generated output silently. Loud is correct here.

**Nested skills are path-scoped.** A contract inside a subdirectory scopes its
skills to that subtree rather than offering them repository-wide. This was found
by running the stack against a real monorepo fixture, not by unit tests, and it
matches how both Claude Code and Cursor treat nested skill directories (§5.3,
§5.4). Regression tests now cover both directions.

### 11.3 Problems from §4 now closed or reduced

| Problem | Status |
|---|---|
| P2 no resolution engine | **closed** — `resolveForPath` answers what/why/where, with exclusion reasons |
| P3 no diagnostics model | **closed** — codes, severities, positions, JSON output |
| P4 silent broken references | **closed for contract references** — AGF004 |
| P5 no capability model | **closed** — sourced registry, `unknown` where unverified |
| P10 I/O interleaved with logic | **reduced** — new layers take a `FileSystem`; legacy modules unchanged until Phase 7 |

Still open, by design: P1 (platform names in the generator), P6 (discovery),
P7 (three staleness implementations), P8 (closed rule vocabulary — the IR now
treats `category` as an open label, but the v1 schema still fixes the four),
P9 (`SKILL.md` as a real input), P11, P12. Each is scheduled to a later phase.

### 11.4 Verified end to end

The stack was run against an on-disk monorepo fixture — root contract plus an
`apps/mobile` contract, a missing `content_file`, and the same package-manager
rule declared twice in different casing. It produced: correct root→leaf
directive ordering with real line numbers, per-path scoping that keeps mobile
rules and skills out of `apps/web`, the duplicate detected across files, the
broken reference caught, and a sourced compatibility error for emitting skills
to plain AGENTS.md.

---

## 12. Phase 2 as built

Delivered, suite green: **459 tests** (408 core, 51 CLI), build, typecheck, and
lint clean, and the pre-existing 144 tests still passing untouched.

### 12.1 What shipped

| Module | Purpose |
|---|---|
| `core/src/discovery/scan.ts` | one bounded repository walk, shared by every adapter; reports truncation rather than hanging |
| `core/src/discovery/instructions.ts` | AGENTS.md, CLAUDE.md / `.claude/CLAUDE.md` / CLAUDE.local.md, `.claude/rules/`, `.cursor/rules/`, `.cursorrules`, Copilot repo-wide and `applyTo` instructions |
| `core/src/discovery/skills.ts` | `SKILL.md` from `.claude/skills`, `.cursor/skills`, `.github/skills`, `.agents/skills`, with resource classification |
| `core/src/discovery/agents-mcp.ts` | `.claude/agents/**` subagents and `.mcp.json` servers |
| `core/src/parsers/frontmatter.ts` | one frontmatter parser for every markdown agent format, plus field coercion |
| `core/src/analysis/context.ts` | always-loaded context budget and skill-routing metadata signals |
| `core/src/analysis/derive.ts` | atomic directives derived from prose bullets, marked `origin: "derived"` |
| `core/src/analysis/overlap.ts` | line-level duplication between instruction files |
| `cli/src/commands/doctor.ts` | `agentfile doctor`, human and JSON output |

`FileSystem` grew `readDirectory` and `isDirectory` — the concrete need arrived
with the scanner. `Instruction` gained an optional `bodyLine` so positions
derived from a body still point at the right line in a file with frontmatter.

### 12.2 What `doctor` reports

Deterministically, with no model and no network, and without executing anything
it finds:

* every configuration file, attributed to a platform and a scope
* always-loaded context, as characters and lines measured exactly plus a token
  figure labelled as an estimate with its method named
* directory-scoped configuration, resolved per directory
* rules duplicated across files and across platforms
* skills whose description is too thin to route on
* misconfigurations: an MCP entry with a `url` and no `type`, a stdio server
  with no `command`, an unrecognised transport, an instruction file importing a
  path that does not exist, malformed YAML or JSON, unclosed frontmatter

Exit code is non-zero only on error-severity findings, matching the existing
`validate` and `diff` convention.

Measured on this repository (138 files, 11 directories skipped) and on the
messy fixture, a full `doctor` run takes **130–150 ms** including Node startup,
which keeps it inside pre-commit budget as §30 requires. One filesystem walk,
no network, no model.

### 12.3 Decisions worth recording

**Prose duplication is detected line by line, not by extracting rules.** The
first implementation derived directives from bullets and compared those. Running
it against a realistic fixture showed the flaw immediately: `.cursor/rules/*.mdc`
and `.github/copilot-instructions.md` commonly state a rule as a plain sentence,
not a bullet, so the most valuable finding in the whole tool was missed. Line
comparison catches bullets and prose alike and never has to decide whether a
sentence "is a rule" — a decision that would either miss real duplication or
invent it. Statement-level comparison is still used, but only for *declared*
directives, so bullets are not reported twice.

**Derived directives are kept, and labelled.** Derivation still runs, because
per-path rule counts and future conflict detection need statements. Every
derived directive carries `origin: "derived"` and a note naming the bullet it
came from, so it can never be mistaken for something the author declared.

**Glob lists are split brace-aware.** `applyTo`, `globs`, and `paths` are all
documented as accepting a comma-separated string, and all three support brace
expansion, so a naive comma split turns `src/**/*.{ts,tsx}` into two broken
patterns. A test caught this; `splitGlobList` fixes it for all three fields.

**Symlinked directories are not followed during the scan**, and dot directories
are not skipped wholesale — the configuration being looked for lives in
`.claude`, `.cursor`, `.github`, and `.agents`. Only an explicit list of
generated and vendored directory names is skipped.

**Nested configuration is scoped to its subtree.** A `.claude/rules/` or
`.cursor/rules/` inside `apps/web` governs `apps/web`, not `apps/web/.claude` —
`governedDirectory` walks out of configuration directories so nesting depth
reflects the code the configuration applies to.

### 12.4 Problems from §4 now closed

| Problem | Status |
|---|---|
| P6 useless without adoption | **closed** — `doctor` works on a repository that has never used agentfile; the contract is one optional source among many |
| P4 silent broken references | **fully closed** — AGF004 now also covers instruction-file imports |

Still open, by design: P1 (platform names in the generator, Phase 7), P7 (three
staleness implementations, Phase 3), P8 (the v1 schema still fixes four rule
categories, though the IR treats `category` as an open label), P9 (`SKILL.md` is
now *read*; validating it against the specification is Phase 5), P11, P12.

---

## 13. Phase 3 as built

### 13.1 One rule set, three selections

`check`, `validate`, and `lint` are not three implementations. They are three
selections over one rule set — `packages/core/src/validation/` — which is what
stops them disagreeing about whether something is a problem. ESLint's flat
config works the same way, for the same reason.

The layers are the rework brief's own separation of responsibility (§12), so the
selection needed no invention:

| Layer | Rules | `check` | `lint` | `validate` |
|---|---|:-:|:-:|:-:|
| structural | `configuration-integrity` | ✓ | | ✓ |
| resolution | `duplicate-instructions`, `unreachable-configuration`, `inconsistent-scope` | ✓ | | ✓ |
| quality | `near-duplicate-instructions`, `context-budget` | | ✓ | ✓ |
| compatibility | `target-compatibility` | | | ✓ |
| security | *(Phase 6)* | | | |
| behavioral | *(Phase 8)* | | | |

`security` and `behavioral` are declared with no rules rather than left out. A
selected layer with nothing in it reports itself as empty, because a layer that
silently does not exist is worse than one that says so.

Four invariants are pinned by test rather than by convention:

* rule ids are unique and kebab-case
* a rule only claims codes that exist in the registry
* a rule only claims `active` codes, never `reserved` ones
* **every active code is claimed by some rule** — so a code cannot become
  emitted-by-nobody as the rule set moves

### 13.2 A rule computes nothing itself

Each rule is a thin composition over a primitive that already exists and is
already tested. A rule decides *when* a finding is reported, never *how* it is
computed. That constraint is what keeps a second definition of duplication or
reachability from appearing: `duplicate-instructions` calls the resolver and the
overlap analysis, and has no comparison logic of its own.

The same move retired a duplication introduced in Phase 2. `doctor` had its own
copy of "resolve the root plus one probe per configured directory, then
deduplicate"; that is now `repositoryResolutionDiagnostics` in core, and `doctor`
calls it. Two commands, one definition.

### 13.3 New diagnostics

| Code | What it catches | Why it is deterministic |
|---|---|---|
| `AGF303` | glob-scoped configuration no file matches | set intersection against the scan's file list, using the resolver's own matcher |
| `AGF304` | shared text whose applicability differs per platform | the text is already known to be shared, so the only question is whether the two IR nodes' `Applicability` agree |
| `AGF305` | copies of a rule that have drifted apart | token-set Jaccard over normalised lines |
| `AGF401` | always-loaded context over budget | now emitted; was reserved |

`AGF304` needed one non-obvious decision: `always` and a directory scope of the
repository root canonicalise to the same signature. Everything is inside the
root, so they are one statement — and without that, every repository with both a
root `AGENTS.md` and a root `CLAUDE.md` would report a mismatch that does not
exist.

### 13.4 Similarity: exact Jaccard, not MinHash

The brief lists MinHash among the candidate techniques (§12). It was not used,
deliberately. MinHash exists to *approximate* Jaccard when a corpus is too large
to compare pairwise; an instruction corpus is hundreds of lines. Approximating
here would add error for no saving. So Jaccard is computed exactly, and the
pairwise cost is controlled the honest way instead — an inverted token index, so
lines with nothing in common are never compared, plus a comparison budget that
*reports itself* when reached rather than quietly returning fewer findings.

Three limits are enforced in code and stated in every finding:

* **Words, not meaning.** "Use pnpm" and "npm is forbidden" share no tokens and
  are never paired. Paraphrase detection needs embeddings, which the brief keeps
  optional.
* **Polarity is never crossed.** A pair whose negation markers differ is skipped.
  Those lines may genuinely contradict each other, and calling a contradiction a
  duplicate would send a developer to delete one of them — the worst possible
  outcome for this analysis. The stopword list therefore excludes every negation
  and every modal.
* **Cross-file only.** A file repeating itself is a lint concern about that file.

The 0.6 threshold was chosen against real drift, not picked round: *"Use pnpm as
the package manager"* against *"...never npm"* scores 0.67, and *"Never commit
secrets to the repository"* against *"...to this repo"* scores 0.60. It is
configurable with `--similarity`.

### 13.5 Compatibility only answers a question that was asked

`featuresUsed` reads the capabilities a repository relies on straight off the IR,
so a new discovery adapter contributes usages without that file changing. Those
are checked against the capability registry, and every finding carries the
target's own documentation URL.

The compatibility layer runs **only when `--target` is named**. Inferring targets
from the platforms discovered was implemented and then rejected: a repository
with an `AGENTS.md` and a `.claude/skills/` directory would infer `agents-md`,
and `agents-md` cannot express skills, so a CI build would fail over a target
nobody was compiling to. "Will compiling to X lose behaviour" is only a question
once X is named. Without a target the rule reports that it did not run.

Findings are one per target and feature, not one per node — thirty skills against
a target with no skill concept is one clear error, not thirty identical ones.

### 13.6 `--strict`

`--strict` promotes warnings to errors. Infos are deliberately untouched: the
info-level codes report unverified platform behaviour, so `validate --target all
--strict` would otherwise fail on gaps in *agentfile's own* registry rather than
on anything wrong with the repository.

### 13.7 Backward compatibility

`validate` predates these layers and is wired into the CI workflow `init`
generates, so its v1 behaviour is preserved and verified by diffing against the
stashed implementation on the same fixture:

* the title, the four success lines, and their wording are byte-identical
* a contract that fails its schema is still an immediate exit 1, before anything
  else runs
* a repository with an `ai/` directory still requires a valid contract there

Two changes are intentional and are called out in the CHANGELOG:

1. **Error-severity findings from outside the contract can now fail the run.**
   Each is a real defect — an MCP server that will silently fail to load, an
   import pointing at a missing file — and generation does not skip those, it
   silently produces empty content. A previously-passing repository starts
   failing only if it has one.
2. **A contract is no longer required.** A repository with an `AGENTS.md` and no
   `ai/` directory is validated on what it has, instead of failing with
   "contract not found".

### 13.8 Measured

`check` on this repository and on the messy fixture: **≈140 ms** including Node
startup, one filesystem walk, no network, no model. That is the number that makes
the pre-commit claim in §30 of the brief true rather than aspirational.

562 tests (487 core, 75 CLI). Build and typecheck clean; lint unchanged from
baseline.

---

## 14. Phase 4 as built

### 14.1 Two directions on one primitive

`context` and `explain` are the two directions of the same question, and both are
projections of `resolveForPath`:

| Command | Question | Input |
|---|---|---|
| `context <path>` | what applies here, in what order, and why | a path |
| `explain <target>` | where does this come from, when does it apply, what beats it | a node |

Neither recomputes applicability. `verdictAt` calls the resolver and reads the
answer out of `applied` or `excluded`; every reason string a developer sees is
the resolver's own `MatchReason.detail` or `ExclusionReason.detail`, not a second
description of the same rule written for display. That is the difference between
observability and a plausible-looking second opinion.

### 14.2 Addressing a node

`explain` takes what a developer already has in front of them, so the query is
resolved by how precisely it identifies something: exact id, then source file,
then exact name, then substring. **The first strategy that matches anything
wins** — a query naming a file is not also run as a substring search, which would
bury the answer under coincidental matches.

Several matches are all returned rather than one being picked, because a file
query legitimately matches everything that file contributes. Above five matches
the command lists candidates compactly and says how to narrow, instead of
printing forty explanations.

### 14.3 One IR change: skills got an id

`Instruction` and `Directive` carried a stable `id`; `SkillEntry` did not. That
gap only became visible here, because matching a node by *label* is wrong in a
way that is easy to miss: two nested `AGENTS.md` files share a label and are
different configuration. `Excluded` gained an `id` for the same reason, so a
"why does this not apply" answer is exact rather than a best guess.

Both are additive. The only construction sites were the skills discovery adapter
and the contract adapter.

### 14.4 What "the same thing" means

`explain` reports where else the same configuration is declared, and per node
kind that means what a developer would call the same thing:

* a **rule** — another directive with the same normalised text
* a **skill** — another skill with the same name, in a different file
* an **instruction** — another instruction file that shares lines with it,
  computed by reusing `findInstructionOverlap` rather than re-deriving what
  "shared" means

### 14.5 Honesty carried into the output

* Nodes no verified platform scopes by path — subagents, hooks, MCP servers,
  permissions — report exactly that, rather than being given a fabricated scope.
* Directives read out of prose are marked `(read from prose)` in `context`, and
  their `derived` origin and note appear in `explain`. Agentfile's reading of a
  bullet is never presented as something the author declared.
* Token figures repeat the estimate caveat, and `context` splits the number into
  what loads in every session and what is specific to the path — because those
  two costs lead to different decisions.
* `context` says how many pieces of configuration did *not* apply even without
  `--excluded`, so the count is never silently zero.

### 14.6 Verified

603 tests (508 core, 95 CLI). Build and typecheck clean; lint unchanged from
baseline. Both commands are read-only and pinned by a test that asserts nothing
appears on disk.

---

## 15. Phase 5 as built

### 15.1 Validating against a standard, not a format

`packages/core/src/skills/spec.ts` holds every published constraint and imports
nothing. That is deliberate: it is the leaf of the dependency graph, so both the
skills module and `analysis/context.ts` can read the same numbers without a
cycle, and there is exactly one place to check when the specification moves.

The specification's own distinction between *must* and *recommended* becomes the
severity. A name over 64 characters breaks a requirement, so it is an error. A
body over 5000 tokens exceeds a recommendation, so it is a warning. Nothing in
this module upgrades a recommendation into a rule.

| Area (brief §16) | Code | Severity | Basis |
|---|---|---|---|
| Structure | `AGF101` / `AGF102` | error | specification requirement |
| Resources — broken references | `AGF004` | error | the file does not exist |
| Routing | `AGF103` | warning | agentfile threshold, stated in the finding |
| Context | `AGF104` | warning | specification recommendation |
| Resources — layout | `AGF105` | info | may be intentional |
| Portability | `AGF106` | warning | documented platform constraint |
| Security | `AGF501` | per pattern | documented risk pattern |

### 15.2 No score

The brief requires any scoring system to be explainable and forbids arbitrary
scores. A skill score would have to combine six unrelated signals — a name
mismatch, a thin description, an oversized body, a deep resource, a non-spec
key, a `sudo` in a script — into one number. That number cannot be explained,
only argued with, and it would hide which of the six actually needs attention.
So there is none. Each finding carries its own threshold and its own reason.

### 15.3 One judgement of routing quality

Phase 2 put a quick description check in `analysis/context.ts` for `doctor`.
Phase 5 needed the same judgement as a diagnostic. Writing it twice is precisely
the drift this project exists to remove, so instead:

* `analyzeSkillRouting` is the single judgement, now returning structured
  problems (`{ kind, message }`) rather than strings
* `routingDiagnostics` maps those problems to `AGF103`
* specification *violations* were removed from it — an over-length description is
  `AGF101` from `validateSkills`, not a routing signal, and reporting it under
  both codes would make one of them noise

`doctor` renders the signals; `lint` and `validate` render the diagnostics. They
cannot disagree, because there is one function.

### 15.4 The measurable half of "overly broad"

The brief lists "overly broad descriptions" under routing. Whether a description
is broad in the abstract is a judgement agentfile would have to fake. Whether two
skills in the same repository give an agent any basis to choose between them is a
comparison — so that is what is measured, with the same Jaccard machinery Phase 3
built for near-duplicate instructions.

### 15.5 Static inspection

Two rules, both from the brief, are enforced in code rather than stated in a
comment:

1. **Nothing is executed.** Files are read as text and matched against patterns.
   No shell is spawned, no interpreter is invoked, no file is made executable —
   even when the whole point of the file is to be run.
2. **Risk is described; safety is never claimed.** A clean result means "no
   pattern in this list matched". The explanation on every finding says it came
   from reading text and cannot see intent, and files that could not be inspected
   (too large, unreadable) are returned in `skipped` rather than passed over.

The pattern set is deliberately small — eleven entries, each naming a concrete
mechanism and carrying a stated reason. A large fuzzy set produces findings a
developer learns to ignore, which is worse than no findings at all. Severity
follows the mechanism: piping a download into a shell is an error, `sudo` is a
warning, and making network calls at all is `info`, recorded so that what a skill
reaches out to is visible without reading every script.

Comment lines are skipped: a shell comment is documentation, not an instruction.

### 15.6 One rule reads from disk, and says so

`RuleContext` gained `root` and `fs`. Every other rule is a pure function of the
configuration; `skill-scripts` has to read files discovery deliberately did not
load, because a bundled script's contents have no business in the IR. Access is
in the context rather than smuggled in through a module import, so which rules
touch the disk is visible at the type level.

The `security` layer therefore has a rule, and `validate` covers it. `check`
still runs structural and resolution only, which keeps the pre-commit path free
of file reads — measured at **≈133 ms** on the Phase 5 fixture, unchanged.

### 15.7 Verified

On a deliberately broken skill — name/directory mismatch, two-word description,
a link to a missing file, a resource two levels deep, two non-spec keys, and a
script that pipes `curl -k` into `sh`, runs `sudo rm -rf` on a variable, and
copies `~/.aws/credentials` — `validate` reports twelve findings across six
codes, each located, each with a reason. `check` reports the two structural ones;
`lint` reports the four quality ones. Nothing was executed.

656 tests (561 core, 95 CLI). Build and typecheck clean; lint unchanged from
baseline.

---

## 16. Phase 6 as built

### 16.1 One pattern set, three surfaces

Phase 5's risk patterns moved from `skills/security.ts` to `security/patterns.ts`,
because a bundled script, a hook command, and an MCP server's argv are the same
kind of text with the same failure modes. Two copies of the list would drift, and
the copy that drifted would be the one that missed something. The skills module
now imports the shared set; its behaviour and its `AGF501` findings are unchanged.

New codes are append-only, per §7.3:

| Code | Name | Surface |
|---|---|---|
| `AGF502` | dangerous-hook | hook commands, plain-HTTP endpoints |
| `AGF503` | untrusted-mcp-server | unpinned packages, unencrypted transports |
| `AGF504` | secret-in-configuration | literal credentials in env, headers |
| `AGF505` | prompt-injection-indicator | invisible characters, hidden comments, override wording |
| `AGF506` | permission-rule-problem | rules that do not grant what they appear to |

### 16.2 Settings discovery

Hooks and permission rules live in `.claude/settings.json`, not in markdown, so
discovery gained `discovery/settings.ts`. It reads the two repository-scoped
files (`settings.json`, `settings.local.json`) and deliberately not the user or
managed scopes: agentfile analyses what a repository commits, and reaching into a
developer's home directory would make the same repository report differently for
different people.

`HookEntry` grew the documented handler shapes (`command`, `http`, `mcp_tool`,
`prompt`, `agent` — left open, because an unrecognised kind must be reportable
rather than dropped), and the IR gained `SettingEntry` for the handful of settings
keys whose value changes what an agent is allowed to do, starting with
`permissions.defaultMode`.

### 16.3 Documented mechanics, not opinions

Every permission finding is a documented mechanic of the platform's permission
syntax, with the documentation linked in the finding: `Bash(ls*)` matching `lsof`,
`:*` being literal anywhere but the end, unanchored allow-globs approving nothing,
deny→ask→allow evaluation making shadowed allow rules dead, and
`bypassPermissions` in a committed file. The value of the check is that it knows
rules a developer reasonably would not; a style opinion here would be noise.

Injection indicators are split by how objective they are. Invisible characters
(zero-width, bidi overrides) have no legitimate place in an instruction file and
are reported plainly. Override wording ("ignore all previous instructions") is
very often a document *about* prompt injection, so it is `info`, deduplicated per
indicator per file, and every finding says exactly that — except when the same
wording hides inside an HTML comment, invisible in rendered markdown, which is
the shape that matters and is reported as such.

### 16.4 Coverage is part of the result

`auditConfiguration` returns the surfaces it analysed with counts, the files it
read, and the files it could not read with reasons. The command prints all three
before any finding, and every rendering of a clean result carries the same
caveat: no findings means no pattern matched what could be read — not that the
configuration is safe. Nothing found in the repository is executed; skills,
hooks, scripts, and MCP configuration are read as text (REWORK §33).

### 16.5 Verified

On a fixture with a `curl | sh` hook, an unpinned MCP package, a committed
`ghp_` token, `bypassPermissions`, a boundary-less allow rule, a shadowed allow
rule, and an override hidden in an HTML comment, `audit` reports all seven with
locations and reasons, exits 1, and names the one informational finding it
withheld. 718 tests (614 core, 104 CLI). Build and typecheck clean.

---

## 17. Phase 7 as built

### 17.1 Compilation is downstream, and the legacy path is intact

`agentfile compile` runs the REWORK §22 pipeline: discovery → IR → compilers →
target files. Whatever the repository's source of truth is — AGENTS.md,
CLAUDE.md, an agentfile contract — the same normalized configuration feeds every
target. The template-driven v1 path (`generate()`, `sync`, `ai/agents/`
templates) is untouched: repositories that own templates keep exactly the
behaviour they had.

The shape is the one multi-target generators converge on (OpenAPI Generator,
GraphQL codegen, Terraform providers): compilers are pure — `compile(IR) →
{files, diagnostics, notCarried}` — and one host owns markers, drift detection,
overwrite safety, writing, and the manifest. A compiler cannot write a file, so
no compiler can bypass a safety rule.

### 17.2 Two kinds of loss, never conflated

* **The target cannot express it** → `AGF201`/`AGF202`/`AGF203` through the same
  `diagnoseCapability` the validation rule uses, backed by a registry row with a
  documentation URL. A path-scoped rule compiled to AGENTS.md is an `AGF201`
  with the source location, not a silent drop and not a fold into the root file
  where it would apply more broadly than its author scoped it.
* **agentfile does not translate it (yet)** → a `notCarried` entry with the real
  reason. Cursor supports skills; agentfile not compiling them is agentfile's
  limitation, and blaming the target would point the developer at the wrong fix.

### 17.3 What the compilers emit

Only file shapes with verified registry rows. agents-md: root and nested
AGENTS.md. claude: CLAUDE.md files plus `.claude/rules/*.md` with `paths:`.
copilot: `.github/copilot-instructions.md` plus `applyTo` instruction files
(degraded → `AGF202`); nested scopes are named as the agents-md target's job.
cursor: `alwaysApply` and `globs` rules. codex is refused with a pointer at
agents-md, because that is all its verified rows say.

Selection is the same for every target: never the target's own files, never
`origin: generated` files, never `local`-scoped files, exact-duplicate bodies
dropped and recorded. Discovery now stamps `origin: "generated"` on any file
carrying the marker, which is what makes compile-discover-compile a fixed point
instead of a feedback loop.

### 17.4 Determinism and safety

Same tree in, same bytes out: sources sorted by path and line, files sorted by
path, no timestamps in content (the manifest carries `generatedAt`). The
overwrite rule is one function: a file that exists without a marker, without a
manifest entry, and without `--force` is refused with `AGF204` — a hand-written
CLAUDE.md is someone's work, not drift. `--check` verifies without writing and
exits 0/1/2 (clean/drift/error), the prettier contract, so CI can gate on it.

### 17.5 A marker bug the round-trip test caught

`addMarker` used to prepend the HTML comment unconditionally — above YAML
frontmatter, where it stops the frontmatter being frontmatter and silently
unscopes every generated rule file (legacy cursor `.mdc` output included). The
marker now goes after a leading frontmatter block, `hasGeneratedMarker` looks in
both places, and the fixture proves compile → discover → compile `--check`
returns exit 0.

### 17.6 Verified

On a CLAUDE.md-first fixture with a path-scoped rule and a nested directory
file, `compile --target agents-md cursor` emits five files, reports the one
genuine loss (`AGF201`: AGENTS.md cannot express a path scope), records
ownership in the manifest, and is idempotent under `--check`. 755 tests
(641 core, 114 CLI). Build and typecheck clean.

---

## 18. Phase 8 as built

### 18.1 REWORK §18's model, literally

`evals/*.eval.yaml` follows the brief's conceptual test shape field for field —
name, prompt, and deterministic assertions (`files`, `absent`, `commands`,
`contains`, `forbidden`). Where the brief is silent the shape borrows from the
eval tools people already know (promptfoo's typed assertion list, plugin eval's
per-case configuration) rather than inventing a third convention. An eval that
asserts nothing is rejected: it would pass vacuously.

The flow is the brief's preferred model verbatim: run the agent in an isolated
environment, collect the resulting state, validate through deterministic
assertions. Every assertion result carries its observation — "exit 2", "found
at src/Button.tsx:14" — so a failure reads like evidence. Failures are `AGF602`;
`AGF601` stays reserved for future baseline comparison.

### 18.2 SAFE TO ANALYZE vs SAFE TO EXECUTE

Everything an eval executes — setup, the agent, assertion commands — runs in a
workspace seeded into a temporary directory from what the repository versions
(`git ls-files -co --exclude-standard`, or the discovery scan outside git).
Nothing runs in the working tree, and the tests assert that the user's tree is
untouched after a run. The `Sandbox` interface is deliberately replaceable
(REWORK §21); the first implementation states what it provides (filesystem
isolation, timeouts, output caps) and what it does not (network isolation,
resource limits) in its own description, printed with every run.

### 18.3 No implicit agent, no silent spend

A prompted eval runs only when the user names the agent
(`--agent "claude -p {prompt}"`); without one it is reported as skipped, never
as passed. The prompt is data, not shell: `{prompt}` becomes a single-quoted
literal and the raw text travels as `$AGENTFILE_EVAL_PROMPT`, so quotes and
`$(...)` in a prompt cannot become part of the command.

Results are cached (REWORK §20) against the definition text, the agent command,
and a repository fingerprint of HEAD plus the *content* of tracked changes and
untracked files — the porcelain status alone would serve stale hits, since
editing an already-modified file does not change it. agentfile's own state under
`.agentfile/` is excluded from the fingerprint so the cache cannot invalidate
itself. No fingerprint (not a git repository) means no caching, never a stale
hit.

### 18.4 Exit codes CI can gate on

0 all passed, 1 assertions failed, 2 the harness could not run an eval — the
promptfoo split between "the test failed" and "the tool failed", which CI needs
to distinguish. A cached failure replays as a failure; the smoke test caught the
label that said otherwise, and a regression test now pins it.

### 18.5 Verified

A prompted eval against a scripted agent passes all three assertion kinds with
located evidence, leaves the user's tree untouched, caches its result, and
replays it on an unchanged tree. 780 tests (658 core, 122 CLI). Build and
typecheck clean. `docs/evals.md` documents the format.

---

## 19. Sources

- <https://agents.md/>
- <https://code.claude.com/docs/en/memory>
- <https://code.claude.com/docs/en/skills>
- <https://code.claude.com/docs/en/sub-agents>
- <https://code.claude.com/docs/en/mcp>
- <https://agentskills.io/> and <https://agentskills.io/specification>
- <https://cursor.com/docs/context/rules>
- <https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions>
- <https://eslint.org/docs/latest/use/configure/configuration-files>
- <https://eslint.org/docs/latest/extend/custom-rules>
