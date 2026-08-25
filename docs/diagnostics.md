# Agentfile diagnostics reference

Every finding agentfile reports carries a stable code. Codes are the contract
between agentfile and everything that consumes it — CI, editors, dashboards — so
this registry is **append-only**:

* the meaning of a code never changes
* codes are never renumbered
* an obsolete code is marked retired, never removed or reused

Codes are grouped in bands by the first digit after `AGF`:

| Band | Domain |
|---|---|
| `AGF0xx` | configuration and structure |
| `AGF1xx` | skills |
| `AGF2xx` | targets and compatibility |
| `AGF3xx` | instructions and resolution |
| `AGF4xx` | context budget |
| `AGF5xx` | security |
| `AGF6xx` | behavioral evaluation |

**Status** is honest about what exists today. `active` means something emits the
code now. `reserved` means the taxonomy slot is fixed but the subsystem that
emits it has not landed yet — reserved codes are never emitted, so a consumer
will not see one appear without a release note.

---

## AGF0xx — configuration and structure

### `AGF001` invalid-configuration · error · active
A configuration file does not satisfy its schema. Reported once per violation,
each located at the offending field, so a single run surfaces every problem
rather than stopping at the first.

### `AGF002` missing-configuration-file · error · active
The configuration file agentfile was asked to read does not exist.

### `AGF003` unparsable-file · error · active
The file is not valid YAML or JSON, so none of its configuration could be read.
Reported with the parser's own position.

### `AGF004` broken-file-reference · error · active
Configuration points at a file that does not exist — an artifact `content_file`,
a doc `file`, or a skill resource. This is an error rather than a warning
because generation does not skip a missing reference: it silently produces empty
content.

---

## AGF1xx — skills

`SKILL.md` is an external standard
(<https://agentskills.io/specification>). Agentfile validates against it and does
not extend it. Every constraint enforced below has its source recorded in
`packages/core/src/skills/spec.ts`, and the specification's own distinction
between *must* and *recommended* is preserved in the severities: a breach of a
requirement is an error, exceeding a recommendation is a warning.

There is deliberately **no skill score**. The rework brief requires any scoring
system to be explainable, and a single number rolled up from six unrelated
signals cannot be explained — only argued with. Each finding stands on its own
and carries its own threshold.

### `AGF101` invalid-skill · error · active
A skill breaks a specification requirement:

* a `name` over 64 characters, or outside lowercase `a-z0-9` and single hyphens
* a `name` that does not match its parent directory — platforms locate a skill by
  directory, so the skill loads under a name its own frontmatter disagrees with,
  and anything referring to it by the frontmatter name will not find it
* a `description` over 1024 characters, or `compatibility` over 500
* two skills sharing a name, where which one loads depends on directory
  precedence the platforms do not document identically

### `AGF102` missing-skill-metadata · error · active
A skill omits `name` or `description`, the two fields the specification requires.
A missing description is not a weak skill but an unusable one: the description is
the only thing an agent sees before deciding whether to load it.

### `AGF103` skill-routing-quality · warning · active
The description is valid but an agent cannot route on it reliably — it is too
short to distinguish this skill from another, or it says what the skill does
without ever saying when to use it. Also reported when two skills in the same
repository have descriptions similar enough that nothing tells an agent which to
pick.

Whether a description is "too broad" in the abstract is a judgement agentfile
will not fake. Whether two skills give an agent any basis to choose between them
is a comparison, so that is what is measured.

This measures metadata, not model behaviour. A good description makes correct
routing likely; it does not guarantee it, and no finding here claims otherwise.

### `AGF104` skill-context-bloat · warning · active
The body is larger than the specification recommends — over roughly 5000
estimated tokens or 500 lines — or embeds a code block long enough to be
reference material.

Skills exist for progressive disclosure: metadata at startup, the body only on
activation, resources only on demand. A body this large defeats the middle step,
because all of it enters context the moment the skill is chosen, relevant or not.

Token figures are estimated from character length, not measured with any target's
tokenizer.

### `AGF105` skill-resource-layout · info · active
Bundled files are not laid out as the specification expects: nested deeper than
one level, or never mentioned anywhere in the body.

Info severity throughout, deliberately. A platform may list a skill directory
rather than following links, so an unreferenced file is not necessarily broken —
worth knowing about, not worth failing a build over.

### `AGF106` skill-portability · warning · active
The skill uses frontmatter outside the specification, or more routing metadata
than a platform will show.

Non-spec keys are not a mistake — Claude Code documents several and they are
useful. They are a constraint: claude.ai uploads and the Skills API accept only
the specification's fields, so a skill using extensions cannot be shared through
those surfaces unchanged. The finding names each key and says whose extension it
is, because "not in the specification" alone is not actionable.

Also reported when `description` plus `when_to_use` exceeds Claude Code's
documented 1,536-character listing limit, where truncation falls at the limit
rather than at the end of the meaning.

---

## AGF2xx — targets and compatibility

These come from the capability registry. Every level is backed by a URL in the
target's own documentation.

### `AGF201` unsupported-target-feature · error · active
The configuration uses a feature the target has no equivalent for. Compiling it
anyway loses behaviour, so agentfile reports it instead of dropping it quietly.

### `AGF202` degraded-target-feature · warning · active
The target supports the feature, but not natively (`emulated`) or not on every
surface (`degraded`). The behaviour is reachable; it is just narrower than
elsewhere.

### `AGF203` unknown-target-feature · info · active
Nobody has verified this target's behaviour for this feature against the
target's documentation. Agentfile reports the gap rather than assuming either
answer.

### `AGF204` compile-would-overwrite · error · active
`agentfile compile` planned an output file that already exists, carries no
generated-by-agentfile marker, and is not recorded in the manifest. That is what
a hand-written file looks like, and a compiler must not replace someone's work
silently. The file is left untouched; `--force` overwrites it deliberately.

Emitted by the compile host rather than by a validation rule — it is a fact
about the disk at compile time, not about the configuration.

---

## AGF3xx — instructions and resolution

### `AGF301` conflicting-instructions · error · reserved
Two instructions that both apply to the same path contradict each other.
Deterministic detection needs typed settings or negation analysis, so this lands
with the analysis layer.

### `AGF302` duplicate-instruction · warning · active
The same instruction exists in more than one place. Two mechanisms emit it, and
they do not overlap:

* **Structured rules** — declared directives (such as `contract.yaml` rule
  lists) that both apply to one path. Comparison ignores case, whitespace runs,
  and trailing sentence punctuation.
* **Prose** — text shared between instruction files, compared line by line
  after stripping list markers, emphasis, and inline code. This catches bullets
  and plain prose alike, without having to guess whether a given sentence "is a
  rule".

Both fire only across *different* files: repetition inside a single file is a
lint concern about that file, not a duplication problem between sources. Many
shared lines between the same pair of files are reported as one finding rather
than one per line.

When the copies span platforms, the message says so, because that is the
actionable part: every copy costs context in every session, and editing one and
forgetting the others is how agent configuration silently disagrees with
itself.

### `AGF303` unreachable-configuration · warning · active
Glob-scoped configuration that no file in the repository matches. The rule loads
nothing, changes nothing, and reports nothing — it simply does not exist, which
is why it needs saying out loud. Both cases are reported and distinguished in the
message: every pattern dead (the configuration never applies at all) and some
patterns dead (it still applies, but part of it covers nothing, which usually
means a rename or a typo).

Measured against the files present right now, with the same matcher the resolver
uses. The scan skips generated and vendored directories, so a pattern aimed at
`dist/` will appear here — the explanation says so rather than leaving the reader
to guess.

### `AGF304` inconsistent-scope · warning · active
The same instruction text is present in several files, but the configuration
around it does not agree on when it applies — unconditional in `AGENTS.md`,
attached only to `src/api/**` in a Cursor rule. Nothing is duplicated
incorrectly and no single file looks wrong; the rule just means something
different depending on which tool the developer is using.

`always` and a directory scope of the repository root canonicalise to the same
signature, since everything is inside the root. Without that, every root
`AGENTS.md`/`CLAUDE.md` pair would report a mismatch that does not exist.

### `AGF305` near-duplicate-instruction · warning · active
Two instruction lines that are similar but not identical — copies of one rule
that have drifted apart. Exact comparison goes quiet at precisely the moment one
copy is edited, which is when the configuration starts disagreeing with itself.

Similarity is token-set Jaccard over normalised lines, computed exactly rather
than approximated with MinHash: MinHash exists to avoid pairwise comparison on
large corpora, and an instruction corpus is hundreds of lines, so approximating
would add error for no saving. Candidate pairs come from an inverted token index,
so lines with nothing in common are never compared.

Three deliberate limits, all stated in the finding rather than hidden:

* **Words, not meaning.** "Use pnpm" and "npm is forbidden" share no tokens and
  will never be paired. Paraphrase detection needs embeddings, which the rework
  brief keeps optional.
* **Polarity is never crossed.** A pair whose negation markers differ is skipped.
  Those two lines may well contradict each other, but calling a contradiction a
  duplicate would send a developer to delete one of them.
* **Cross-file only.** A file repeating itself is a lint concern about that file,
  not two sources disagreeing.

---

## AGF4xx — context budget

### `AGF401` context-overload · warning · active
Always-loaded context exceeds its budget, with the largest contributing files
named — "you are over budget" without "here is what is big" is not actionable.

Two honesty constraints apply. The token figure is estimated from character
length, not measured with any target's tokenizer. And the budget is agentfile's
own default, not a platform limit: no agent platform documents a maximum size for
always-loaded instructions.

---

## AGF5xx — security

### `AGF501` security-issue · error · active
Static analysis matched a documented risk pattern in a file bundled with a
skill. Severity follows the pattern: piping a downloaded script into a shell is
an error, requesting elevated privileges is a warning, and making network calls
at all is recorded as info so that what a skill reaches out to is visible
without reading every script.

Two rules govern every finding in this band:

1. **Nothing is executed.** Files are read as text and matched against patterns.
   No shell is spawned and no interpreter is invoked, even when the whole point
   of the file is to be run.
2. **Risk is described; safety is never claimed.** A clean result means "no
   pattern in this list matched", which is far weaker than "this is safe".
   Pattern matching cannot see intent, cannot follow a variable, and cannot read
   a binary. Files that could not be inspected — too large, unreadable — are
   reported rather than passed over silently.

Each pattern carries a name and a stated reason, so a finding can be argued with
on its merits rather than accepted because a tool said so. The set is
deliberately small and specific: a large fuzzy set produces findings developers
learn to ignore, which is worse than none.

The same pattern set is used for skill scripts, hook commands, and MCP server
invocations — they are the same kind of text with the same failure modes, and two
copies of the list would drift.

### `AGF502` dangerous-hook · warning · active
A hook is the one piece of agent configuration that runs on its own. Nobody
approves it at the moment it fires; committing the file was the approval. That
makes a hook the highest-leverage thing in a repository to get wrong and the
least likely to be noticed.

Reported for a hook command matching a risk pattern, and for an `http` hook
posting over plain HTTP — a hook payload carries the tool input that triggered
it, which can include file contents and command lines. Every finding states
whether the hook fires on every occurrence of its event or only behind a matcher,
because that changes how much it matters.

A hook whose script is not in the repository is `AGF004`: it fails every time its
event fires, which is either noise in every session or a check the team believes
is running and is not.

### `AGF503` untrusted-mcp-server · warning · active
An MCP server whose behaviour is not determined by what the repository commits:

* an **unpinned package** — `npx`, `bunx`, `uvx`, `pnpm dlx`, and `pipx run`
  fetch when the server starts, so without a version the code that runs is
  whatever the registry serves at that moment. Two developers on the same commit
  can run different code, and a compromised release reaches everyone who
  restarts.
* a **plain-HTTP endpoint** — everything sent to and from the server, including
  tool arguments and results, is readable and modifiable in transit. A loopback
  address is reported as info, since the traffic does not leave the machine.
* a **risk pattern** in the command it runs.

Claude Code asks before connecting to a project MCP server, so none of this is a
gate being bypassed. It is what the person at that gate cannot see.

### `AGF504` secret-in-configuration · error · active
A committed file contains what looks like a credential rather than a reference to
one — an MCP server's `env` or `headers`, a hook's headers. A value like `$TOKEN`
or `${MY_KEY}` is a reference and is fine.

An error rather than a warning because the exposure is already complete: anyone
with repository access can read it, as can anything that mirrors the repository.
The suggestion says to rotate, not just to remove.

Matched shapes include AWS access key IDs, private key blocks, full bearer
tokens, and long opaque values with no variable reference. The last of these also
matches some placeholders, so the finding says to confirm before rotating.

### `AGF505` prompt-injection-indicator · warning · active
The word is *indicators*. A repository's own instruction files are written by the
team that owns them, so "ignore previous instructions" in an `AGENTS.md` is far
more likely to be a document *about* prompt injection than an attack — and every
finding of this kind says so.

It is checked anyway because instruction files travel: copied between
repositories, pasted from articles, pulled from templates, generated by tools.
Three mechanisms are reported, in descending order of how objective they are:

* **Invisible characters** (warning) — zero-width joiners and spaces, a
  byte-order mark used mid-file, and the bidirectional overrides behind the
  Trojan Source class of attack. These render as nothing, or as text in a
  different order than it is stored, so what a reviewer sees is not what the
  agent reads. There is no legitimate reason for them in an instruction file, so
  this finding carries no hedge.
* **Text hidden in an HTML comment** (warning) — markdown does not render an HTML
  comment; an agent reading the raw file does.
* **Wording that addresses the agent's instructions** (info) — "disregard your
  previous instructions", "reveal your system prompt", "from now on you are".
  Deliberately narrow: "Do not use npm" is an instruction about the project, and
  only the former shape is an injection. Reported once per indicator per file, so
  a document about injection does not produce forty findings.

### `AGF506` permission-rule-problem · warning · active
A permission rule that does not grant what it appears to. Every case is a
*documented* mechanic of Claude Code's permission syntax, not a style preference
— the value of this check is that it knows the rules a developer reasonably would
not:

* **`Bash(ls*)` also matches `lsof`.** A `*` with no space before it enforces no
  word boundary. `Bash(ls *)` — one space different — matches only `ls` with
  arguments. As an allow rule this grants more than it appears to.
* **`:*` is recognised only at the end of a pattern.** In `Bash(git:* push)` the
  colon is literal and the rule matches nothing. Reported as an error: the rule
  has no effect and nothing says so at load time.
* **An unanchored glob in an allow rule approves nothing.** Allow rules accept a
  tool-name glob only after a literal `mcp__<server>__` prefix; `"*"`, `"B*"`, and
  `"mcp__*"` are skipped with a startup warning. The rule looks like a broad grant
  and is not one, which is the worst of both.
* **An allow rule under a broader deny or ask rule is dead.** Rules are evaluated
  deny, then ask, then allow, and specificity does not change that order, so a
  broad deny cannot carry allowlist exceptions.
* **Exec wrappers are not auto-approved by a prefix rule.** `Bash(watch *)`,
  `Bash(setsid *)`, `Bash(ionice *)`, `Bash(flock *)`, and `Bash(find *)` with
  `-exec` or `-delete` still prompt.
* **`permissions.defaultMode: "bypassPermissions"` in a committed file** (error).
  Claude Code's own documentation says to use that mode only in isolated
  environments like containers or VMs where it cannot cause damage. In a
  committed file it applies to everyone on the project, including anyone who has
  not read the line.

---

## AGF6xx — behavioral evaluation

### `AGF601` behavioral-regression · error · reserved
A behavioral evaluation assertion that previously passed now fails.

---

## Output formats

Human output leads with severity, code, and a specific message, then the
explanation, every source location involved, and the suggested fix:

```text
warning AGF302: Duplicate instruction: "Use pnpm as the package manager"

  The same instruction reaches this path from 2 different files. Duplicated
  context costs tokens in every session and drifts apart as one copy is edited.

  Source:
    ai/contract.yaml:11
    apps/mobile/ai/contract.yaml:10 — also declared here

  Suggested fix:
    Keep the instruction in one place and remove the 1 other copy.

  (resolution · duplicate-instruction)
```

Machine output is a versioned envelope. Ordering is deterministic — file, then
line, then column, then code — so it is safe to diff between runs:

```json
{
  "version": 1,
  "summary": { "errors": 0, "warnings": 1, "infos": 0, "total": 1 },
  "diagnostics": [
    {
      "code": "AGF302",
      "name": "duplicate-instruction",
      "band": "resolution",
      "severity": "warning",
      "message": "Duplicate instruction: \"Use pnpm as the package manager\"",
      "location": { "file": "ai/contract.yaml", "line": 11 },
      "related": [
        {
          "location": { "file": "apps/mobile/ai/contract.yaml", "line": 10 },
          "message": "also declared here"
        }
      ],
      "data": { "text": "Use pnpm as the package manager", "copies": 2 }
    }
  ]
}
```

Identity lives in `code` and `data`. Message prose may be improved in any
release; match on codes, never on message text.
