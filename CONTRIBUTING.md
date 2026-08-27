# Contributing

agentfile is in early development. Issues and pull requests are welcome,
including the ones that say a finding is wrong.

## Getting set up

Node 22 or later.

```bash
npm install      # from the repository root
npm run build    # the CLI typechecks against core's built types, so build first
npm test         # 900+ tests, about two seconds
npm run lint     # biome, must exit clean
```

`npm run typecheck` needs `npm run build` to have run at least once. That is not
a quirk worth fixing: the CLI genuinely compiles against `@agentfile/core`'s
emitted `.d.ts`.

To try a change against a real repository:

```bash
node packages/cli/dist/bin.js doctor --root ../some-other-project
```

## The rules the code follows

These are not style preferences. They are the reasons the tool can be trusted,
and a change that breaks one needs to argue for it.

**Nothing discovered is ever executed.** Hooks, scripts, commands and MCP
configuration are read as text. `agentfile eval` is the single exception, and it
runs only the agent command the user named, only in a sandbox.

**Findings are deterministic.** Same tree in, same findings out. No model, no
network, no timestamps in generated content, no ordering that depends on
filesystem iteration order.

**Coverage is reported, not implied.** A check that could not run says so. "No
problems found" has to mean the checks ran, which is why commands report skipped
rules and unanalysed files instead of quietly contributing zero.

**Risk is described, safety is never claimed.** There is no score and no pass.
Every finding states its reason so a reader can disagree with it.

**Diagnostic codes are append-only.** Never change what a code means, never
renumber, never remove — retire it instead. See
[docs/stability.md](docs/stability.md) for the full contract, and
[docs/diagnostics.md](docs/diagnostics.md) for the registry, which a test keeps
in step with the code.

## Adding a diagnostic

1. Register the code in `packages/core/src/diagnostics/codes.ts`, in the band its
   number implies.
2. Document it in `docs/diagnostics.md`. A test fails if you do not, and another
   test checks that the documentation heading matches the registry.
3. Emit it from a rule in `packages/core/src/validation/rules.ts`, or from a
   command — if from a command, add it to the allowlist in `validation.test.ts`
   with a comment naming the emitter.
4. Add a case to `packages/core/__tests__/detection.test.ts`: a repository
   containing the defect, and the same repository with it fixed. Both halves
   matter. A rule that fires on the broken case and also on the fixed one has
   found nothing.

## Reporting a finding that is wrong

This is the most useful kind of issue, and there is a template for it.

Two things make it actionable: the smallest configuration that reproduces it,
and `--format json` output. The JSON carries the code, the location and the
structured data the finding was built from, which is usually enough to see what
went wrong without guessing.

A false positive found this way has already changed the tool once:
`scripts/verify-findings.mjs` re-derives every finding from three real
repositories using tools that are not agentfile, and it caught `AGF105`
reporting linked files as orphans because it searched only a skill's body and
not its description.

## Pull requests

- Every change with behaviour needs a test. The suite runs on Linux, macOS and
  Windows across Node 22 and 24, and Windows is where the interesting failures
  are.
- `npm run lint` must exit clean.
- Update `CHANGELOG.md` under `[Unreleased]`.
- Commit messages explain **why**, not what. The diff already says what.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
