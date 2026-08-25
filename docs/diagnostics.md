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

### `AGF101` invalid-skill · error · reserved
A skill does not satisfy the Agent Skills specification: a `name` outside
1–64 lowercase characters, consecutive hyphens, a name that does not match its
directory, or a `description` over 1024 characters.

### `AGF102` missing-skill-metadata · error · reserved
A skill omits `name` or `description`, the two fields the specification requires.

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

### `AGF501` security-issue · error · reserved
Static analysis found a risk in a hook, script, or MCP configuration.

Security diagnostics describe risk. They never assert that configuration is
safe, and nothing untrusted is executed to produce them.

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
