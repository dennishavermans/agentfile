# Moving to v2

**Nothing you have breaks.** `ai/contract.yaml`, `init`, `migrate`, `sync`,
`watch`, the manifest and the generated output are unchanged, still tested, and
still supported. If you upgrade and change nothing else, everything keeps
working exactly as it did.

What changed is what agentfile can do *without* a contract.

---

## The short version

v1 asked a repository to adopt a format first, then generated files from it. v2
reads the configuration a repository already has — `AGENTS.md`, `CLAUDE.md`,
`.claude/`, `.cursor/`, `.github/` — and tells you what is wrong with it.

```bash
npx @agentfile/cli doctor      # works in any repository, no setup, writes nothing
```

If that is all you ever run, v2 has paid for itself.

---

## What is new

| Command | Question it answers |
| --- | --- |
| `doctor` | What agent configuration is here, and what is wrong with it? |
| `adopt` | What would a single source of truth look like, and what would it cost? |
| `check` | Is it correct? (fast enough for a pre-commit hook) |
| `validate` | Is it correct, across every layer, for a named target? (CI) |
| `lint` | Is it any good — drifted copies, duplication, context cost? |
| `audit` | What could a hook, skill, command, MCP server or permission rule do? |
| `context <path>` | Which configuration applies here, in what order, and why? |
| `explain <target>` | Where does this rule come from and when does it apply? |
| `compile` | Generate native files for each platform from one source |
| `eval` | Did the agent actually comply? (sandboxed, deterministic assertions) |
| `rule [code]` | What does `AGF302` mean? |

Also new: `agentfile.yaml` for settings, `--format sarif` for GitHub code
scanning, `--max-warnings` as a ratchet, and `agentfile-disable` comments for
findings you have reviewed and accepted.

---

## Breaking changes

Two, both in the exit-code and packaging layers rather than in anything a
repository contains.

### Usage errors now exit 2, not 1

A mistyped flag, an unknown `--target`, an unparsable `--budget`: these exit
`2`. Exit `1` now means only one thing — agentfile ran and found something.

This was already true of `compile` and `eval` and false of everything else,
which made "the build failed" ambiguous between a bad argument and a real
finding. If your CI checks for a specific exit code, see
[stability.md](stability.md) for the full contract.

### The dashboard is an optional peer dependency

`agentfile ui` now needs `@agentfile/ui` installed alongside the CLI:

```bash
npm install --save-dev @agentfile/ui
```

It ships an HTTP server and a built front end, which is a lot to install on
every machine that only runs `agentfile check` in a pre-commit hook. Every other
command works without it, and the CLI tells you exactly this if you run `ui`
without it. Same arrangement as `vitest --ui`.

### Also worth knowing

* **Node 22 or later.** Down from 24, so most CI images qualify without change.
* **`--format sarif`** is accepted by `check`, `validate`, `lint` and `audit`.
  Commands whose output is a plan rather than findings refuse it rather than
  emitting an empty log.

---

## Moving off the contract, if you want to

You do not have to. But if you would rather have one markdown file than a
contract plus generated output, `adopt` is the supported route:

```bash
npx @agentfile/cli adopt            # plan only — writes nothing
npx @agentfile/cli adopt --apply    # after confirming
```

It consolidates every platform's instruction text into one hand-written source
(`AGENTS.md` by default) and turns the others into generated output of it. The
order matters and is not cosmetic: a compiler never carries a target's own file
into that target, so generating `CLAUDE.md` while `CLAUDE.md` still holds text
nothing else has would lose that text. Consolidation comes first for exactly
that reason.

Nothing is written without `--apply`, `--apply` confirms first, and a
hand-written file is overwritten only once its own text is already in the
source.

---

## A v2 CI job

```yaml
- run: npx @agentfile/cli validate --strict
```

Or, for findings as annotations on the pull request rather than lines in a log:

```yaml
- run: npx @agentfile/cli check --format sarif > agentfile.sarif
  continue-on-error: true
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: agentfile.sarif
```

Working an existing warning count down rather than fixing it all at once:

```yaml
- run: npx @agentfile/cli lint --max-warnings 12
```

---

## Questions you might have

**Will `sync` stop working?** No. There is no removal planned, and the v1 tests
run on every commit.

**Do I have to write `agentfile.yaml`?** No. Every setting in it is also a flag,
and the defaults are what the flags default to.

**Will `doctor` change my files?** No. `doctor`, `check`, `validate`, `lint`,
`audit`, `context`, `explain` and `rule` write nothing. Only `compile`, `adopt
--apply`, `sync`, `init`, `migrate`, `clean` and `rollback` write, and each says
what it will do first.

**Does anything execute my hooks or scripts?** No. Every analysis path reads
files as text. `eval` is the single exception, it runs only the agent command
you name, only in a temporary sandbox, and only when you ask.
