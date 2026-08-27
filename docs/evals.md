# Behavioral evals

`agentfile eval` runs an agent against a task in an isolated workspace and
judges the state it leaves behind with deterministic assertions. It is distinct
from `validate` on purpose: `validate` reads configuration, `eval` runs a task.

Nothing executes in your working tree. Each eval gets a fresh temporary
directory seeded with what the repository versions (`git ls-files -co
--exclude-standard`, or the discovery scan outside git); `node_modules` and
other ignored trees stay out, and `setup` commands rebuild what a run needs.

## Definition files

Eval definitions are YAML files ending in `.eval.yaml`, conventionally under
`evals/`. The shape follows the rework brief's conceptual test directly:

```yaml
name: create-react-component

prompt: |
  Create a reusable Button component.

setup:
  - npm install

timeout: 300 # seconds the agent may take

assertions:
  files: # must exist after the run
    - src/Button.tsx
    - src/Button.test.tsx

  absent: # must not exist after the run
    - src/Button.js

  commands: # must exit 0, run inside the sandbox
    - npm test
    - npm run typecheck

  contains: # text that must appear
    - accessibility # in a file the run created or modified
    - file: src/Button.tsx # or pinned to one file
      text: aria-label

  forbidden: # text that must not appear
    - eval(
```

Every field except `name` and `assertions` is optional. An eval without a
`prompt` runs no agent and only executes its assertions — useful for asserting
that a clean copy of the repository builds and tests. An eval must assert at
least one thing; an eval that asserts nothing would pass vacuously and is
rejected as invalid.

## Naming the agent

agentfile never picks a model and never spends tokens by default. A prompted
eval runs only when you say what the agent is:

```bash
agentfile eval --agent "claude -p {prompt}"
```

`{prompt}` is replaced with a single-quoted literal, and the raw prompt is also
exported as `$AGENTFILE_EVAL_PROMPT` — either way, a prompt containing quotes or
`$(...)` cannot become part of the command. Prompted evals without `--agent` are
reported as skipped, never as passed.

## Results and exit codes

Each assertion reports what it observed — `exit 2 — 3 tests failed`, `found at
src/Button.tsx:14` — so a failure reads like evidence. Failed assertions are
`AGF602` diagnostics in `--format json`.

Exit codes follow the convention CI expects:

| Exit | Meaning |
|---|---|
| 0 | every eval passed (or was skipped) |
| 1 | at least one assertion failed |
| 2 | the harness could not run an eval: invalid definition, failed setup |

## Caching

Results are cached in `.agentfile/eval-cache.json`, keyed on the definition
text, the agent command, and a fingerprint of the repository state (HEAD, the
content of tracked changes, and the content of untracked files). Any change to
any input misses the cache; `--no-cache` forces a re-run. Outside a git
repository there is no reliable fingerprint, so nothing is cached.

## Sandbox

The current sandbox is a temporary directory: filesystem isolation, timeouts,
and output caps. It does **not** restrict network access or resource use beyond
time — the command says so in its output. The `Sandbox` interface in
`@agentfile/core` is deliberately replaceable so a container or OS-sandbox
implementation can slot in without changing the runner or the assertions.

`--keep-workspace` leaves each eval's directory on disk for inspection.
