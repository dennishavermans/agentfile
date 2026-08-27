# What is stable

agentfile is meant to be depended on by things that are not agentfile: CI jobs
that gate on an exit code, editors that render diagnostics, dashboards that read
JSON, scripts that parse SARIF. That only works if the parts they touch are
allowed to change less often than the parts they do not.

This page says which is which. Everything listed as stable follows semantic
versioning: a breaking change to it requires a major release and an entry in
[CHANGELOG.md](../CHANGELOG.md) describing the migration.

---

## Stable

### Diagnostic codes

`AGF001`, `AGF302`, `AGF501` and the rest are the public identity of a finding.
The registry is **append-only**:

* the meaning of a code never changes
* codes are never renumbered
* codes are never removed — one that becomes obsolete is marked
  `status: "retired"` and keeps its entry

Match on codes, never on message text. Message wording is deliberately not
stable: it is improved whenever a clearer sentence is found, which is exactly
why identity lives in the code and not in the prose. This is the same separation
ESLint draws between `messageId` and the rendered message.

Band boundaries are stable too, so `AGF5xx` is always security and `AGF2xx` is
always targets. Codes documented as `reserved` exist and are not emitted yet;
they will begin being emitted without a major release, so a consumer must
tolerate a code it has not seen before.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Ran, and nothing reached error severity |
| `1` | Findings at error severity, drift under `--check`, a warning ceiling exceeded, or an assertion that failed |
| `2` | agentfile itself could not run — bad arguments, an unreadable repository, an eval harness failure |

The distinction between `1` and `2` is load-bearing: `1` is a fact about the
repository, `2` is a fact about agentfile. A CI job that treats them the same
reports a broken tool as a failing codebase.

### The JSON report envelope

`--format json` output carries `version`, currently `1`, exposed as
`DIAGNOSTIC_REPORT_VERSION`. Adding an optional field is not a breaking change;
removing or repurposing one is, and bumps the envelope version.

Consumers should ignore fields they do not recognise.

### SARIF output

`--format sarif` emits SARIF 2.1.0. The tool name is `agentfile`, rule ids are
diagnostic codes, and results carry `partialFingerprints.agentfileDiagnostic`.
The fingerprint deliberately excludes the line number, so a finding that moves
because something was inserted above it stays the same alert.

### The intermediate representation

`AgentConfiguration` carries `version`, exposed as `IR_VERSION`, currently `1`.
Adding a node kind or an optional field is additive. Changing the meaning of an
existing field is breaking.

### Suppression directive syntax

`agentfile-disable`, `agentfile-disable-line` and `agentfile-disable-next-line`,
in `<!-- -->`, `#` or `//` comments. A directive written today keeps working.

### `agentfile.yaml`

The file carries an optional `version`, currently `1`. New keys are additive.
Removing a key or changing what one means is breaking.

---

## Not stable

These change without a major release, by design:

* **Message, explanation and suggestion text.** Improved freely. Match on codes.
* **Human-readable output.** Layout, colour, ordering and wording of the terminal
  report. Anything parsing it should use `--format json` instead.
* **Which rule emits which code.** Rule ids in `--list-rules` are for selecting
  work, not for matching findings; a code may move between rules.
* **Default severities.** A code's default may be raised or lowered as the
  signal is understood better. Pin what matters in `agentfile.yaml`.
* **What a heuristic finds.** Near-duplicate detection, derived directives,
  routing quality and the security risk patterns are all tuned. A repository that
  reports twelve findings today may report eleven or thirteen after an upgrade.
* **Token estimates.** Estimated from character length, not measured with a
  target tokenizer, and stated as such wherever they appear.
* **Everything under `packages/core/src` that the package barrel does not
  export.** Reaching past `@agentfile/core`'s public exports into a deep import
  path is unsupported.

---

## The v1 contract workflow

`ai/contract.yaml`, `init`, `migrate`, `sync`, `watch` and the dashboard are the
v1 workflow. They are **not deprecated and not removed**: the schema, the
generated output and the manifest format are unchanged in v2, and they keep
their tests.

They are no longer the recommended entry point. New work should use the v2
commands, which read the configuration a repository already has and need no
adoption step, and `agentfile adopt` is the supported route from one to the
other. See [migration-v2.md](migration-v2.md).
