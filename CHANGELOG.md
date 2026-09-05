# Changelog

All notable changes to agentfile will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

## [2.4.1] — 2026-09-05

Three false positives, found by running the tool across fourteen more
repositories it had never seen.

### Fixed

- A credential assignment whose value is only shell expansion is no longer
  reported as a hardcoded credential. sglang writes
  `HF_TOKEN="$HUGGINGFACE_HUB_TOKEN"` and langfuse
  `TOKEN="${LINEAR_API_KEY:-${LINEAR_TOKEN:-}}"`, and reading a secret from the
  environment is what this project recommends everywhere else, so the finding
  contradicted the advice. Expansions are removed innermost first and the
  remainder still has to look like a literal, so
  `token="prefix-$SUFFIX-0123456789"` keeps its finding.
- Two skills sharing a name are only a collision on the same platform. novu
  ships byte-identical copies of `better-auth-best-practices` to
  `.claude/skills` and `.cursor/skills`; Claude Code reads one directory and
  Cursor the other, so no precedence question arises. Drift between such copies
  is a real problem and AGF305 is the check that reports it.
- An import the file itself marks as conditional is no longer reported missing.
  vllm's `rust/CLAUDE.md` opens "First, check @AGENTS.override.md if exists",
  describing a per-developer override the repository deliberately does not
  carry. Only the line carrying the import is considered, so a conditional
  sentence elsewhere cannot excuse a genuinely missing one.

### Not changed

An earlier note in this session claimed airflow's eight broken skill links were
gitignored build artefacts. Checked with `git check-ignore`: they are not. The
links resolve to nothing in that checkout and the findings stand. Likewise
next.js's `eval "VER_$arm=$V"` interpolates command output, so
"what runs depends on the variable's value at that moment" is true of it and
the severity is left alone.


## [2.4.0] — 2026-09-05

Near-duplicate findings are grouped. The check was correct and unusable at the
same time: it reported one warning per similar pair, and duplication is not
pairwise. One rule copied into four files is six pairs; a line repeated down a
documentation index is thousands.

Measured on twenty's configuration: 11,317 pairs from 13 real groups, the
largest holding 205 lines. That is 11,317 warnings for 13 facts, on exactly the
repositories whose configuration is large enough to drift in the first place.

### Changed

- `AGF305` reports one finding per group of mutually near-duplicate lines
  rather than one per pair. Membership is transitive: A similar to B and B to C
  is one conversation about one rule, even where A and C fall below the
  threshold against each other. A group of two reads exactly as it did before,
  which is the common case. Larger groups name the number of copies, list the
  first six with their locations, and count the rest. `data.copies` carries the
  group size for machine consumers.

Warning counts on the repositories used to check this: twenty 11,346 to 42,
streamlit 723 to 79, bun 42 to 21, prefect 42 to 29. Repositories with no
duplication are unchanged.


## [2.3.2] — 2026-09-05

A false-positive release, found by running the tool on eight repositories that
had never seen it: n8n, supabase, bun, cline, streamlit, twenty, prefect and
ruff. Between them they drew 15 error-severity AGF004 findings, and every one
of the 15 was wrong.

### Fixed

- Hook scripts written with the unbraced `$CLAUDE_PROJECT_DIR` were reported as
  missing. Only `${CLAUDE_PROJECT_DIR}` was stripped, so the literal variable
  name stayed in the path and no file could match it. Five hooks across cline,
  streamlit, prefect and twenty were reported missing while their scripts sat
  in the repository. Both spellings are documented and both are used.
- A hook command like `"$CLAUDE_PROJECT_DIR"/.claude/hooks/format.js`, which is
  how bun writes them, lost its path: the first shell word was read as the
  quoted chunk alone, leaving a bare variable with no slash, and the check
  skipped a script it could have verified. A word is now assembled from its
  quoted and unquoted parts, the way a shell reads it.
- Links inside code are no longer followed. n8n documents image syntax as
  `` `![description](url)` `` and ruff documents a permalink as
  `` `[project file.py:123](permalink)` ``; both were reported as missing
  files. Fenced blocks are excluded too, which is what turned n8n's remaining
  four link errors into zero: the links sat inside a fenced example of a skill,
  not in the skill's own prose. Import detection has always ignored code for
  this reason; links now do the same, and line numbers still point at the link.
- A placeholder target such as `tmp/review-<repo>-<number>.md` names a file the
  skill creates at run time, not one that should already exist.
- A GitHub web URL written without its origin, such as
  `../blob/master/CONTRIBUTING.md`, is no longer read as a repository path. From
  a pull request page that link resolves to the file's GitHub page, which is
  where n8n's canned review replies use it. Scoped to `blob`, `tree` and `raw`
  followed by a ref, so an ordinary directory named `blob` still resolves.


## [2.3.1] — 2026-09-03

A correction release. 2.2.0 shipped a sentence that said "measured" about
something the harness could not separate.

### Fixed

- The `Bash(git * main)` finding claimed a measured `git push --force origin
  main`. The machine that measurement ran on carries `Bash(git push *)` in its
  own user settings, which approves every push by itself, so the run proved
  nothing about the rule under test. The documented behaviour is unchanged, and
  the vendor's table still lists `git push origin main` as a match, but the word
  "measured" now covers only what a clean harness showed.

  Re-measured on Claude Code 2.1.238 with `Bash(git * main)` as the only rule,
  in a throwaway repository, using effects on disk as the evidence rather than
  transcript text: `git branch -D main` deleted the branch, and
  `git -c core.fsmonitor=<script> diff main` ran the named script. With no rule
  present neither ran, and `git branch -D dev` did not run, so the rule is the
  grant and the tail is what selects it. The second case is arbitrary program
  execution from a rule that reads as a git allowance, which is sharper than the
  claim it replaces.

### Changed

- Both wildcard findings now quote the permission documentation that describes
  them. For a leading star that is "In `Bash(* --version)`, the `*` stands in
  for the program, so any program matches", with `bash -c 'echo hi' --version`
  listed as a match in the vendor's own table; for a star before the subcommand
  it is the note that the wildcard covers `-c`, "which makes git run a program
  you name".


## [2.3.0] — 2026-09-03

The wildcard family had a member nobody had measured: a rule that begins with
`*`. Claude Code matches everything before the first wildcard as written, so a
leading star leaves nothing at all to limit the rule — it approves a shape,
and any program can wear it. The Netherlands Red Cross carries
`Bash(* --version)` and `Bash(* --help *)` in a public repository, and both read
as courtesies for version banners.

Measured on Claude Code 2.1.238 with a file-creating probe, chosen so the
read-only classifier could not approve it on its own: under `Bash(* --version)`,
`bash -c 'touch <marker>' --version` ran and the marker appeared. With no rules
present it did not run, so the grant is the rule's. Without the flag it did not
run, and neither did the same command with a word after it: the tail still has
to match, which is exactly what makes the rule read narrower than it is.

### Added

- `AGF506` now reports an allow rule whose wildcard stands where the program
  goes. Tail-constrained rules such as `Bash(* --version)` are reported as
  arbitrary-command grants; `Bash(*)` is reported plainly as approving every
  Bash command. Where the tail names a program, as in `Bash(*vitest*)`, the
  suggestion is the rule the author meant: `Bash(vitest *)`.

### Fixed

- The word-boundary check no longer prints a false sentence about rules that
  open with a wildcard. `Bash(*xmrig*)` drew "also matches every program whose
  name starts with `*xmrig`", and no program is named `*xmrig`. Across a
  344-file sample that removes 29 such sentences, all of them on deny rules
  that were written correctly.
- A doc comment orphaned from `wildcardBeforeSubcommand` in 2.2.0 sits with its
  function again.

### Scope

Deny rules keep their leading stars without comment: in the same 344-file
sample, most leading-star rules were denies such as `Bash(*xmrig*)` and
`Bash(* | sh)`, and breadth in a deny runs in the safe direction. Across 12,556
rules the new check fires 33 times — 4 tail-constrained rules in 2 repositories,
and 29 spellings of `Bash(*)`.


## [2.2.0] — 2026-09-03

A ranking release. 2.1.1 made every finding true; this one makes the volume
track the consequence. Running the permission audit over the Linux Foundation's
crowd.dev produced 22 identical word-boundary warnings, and exactly one of the
22 rules — `Bash(gh api repos*)` — grants remote writes. The one that can
delete a branch read no louder than `git logfoo`. That is the wall of noise the
pattern set's own comment warns about, so this release ranks the wildcard
findings by what was measured to ride in the wildcard.

### Added

- **`AGF506`: a wildcarded `gh api` allow rule is reported as a write grant.**
  A `*` matches any characters including spaces, so method and parameter flags
  ride wherever it stands, and gh's own help documents that adding a parameter
  switches the request from GET to POST. Measured on Claude Code 2.1.238:
  `Bash(gh api repos*)` auto-approved `-X DELETE`, `-f description=x`, and a
  branch deletion through `git/refs`. Deliberately scoped to `gh api`, which
  sends the user's token on every call — the same flags ride a wildcarded curl
  rule, but unlock writes nothing in the command is authorised to make.
- **`AGF506`: a mid-rule wildcard that stands where the runner's subcommand
  goes.** Measured: `pnpm --filter web exec rm -rf ./x build` is auto-approved
  by `Bash(pnpm --filter * build)`, because a mid-rule `*` spans multiple
  space-separated words. The check stays quiet once the subcommand is pinned
  before the first star, so `Bash(npx rhachet run --skill x --glob '*.ts')`
  reports nothing.

### Changed

- **Word-boundary findings are ranked by what the fusion can reach.** A
  one-word prefix fuses the program name itself — `Bash(python*)` silently
  covers `python3 -c` with anything after it — and stays a warning. After the
  first word the fused text must still share the prefix, so `Bash(git log*)`
  drops to info: `git logfoo` is nobody's command. Across the 344-file
  permission corpus this moves roughly two thirds of all permission findings
  from warning to info while 34 wildcarded `gh api` rules surface as the write
  grants they are.
- **One fact per rule.** A rule whose wildcard admits writes or chooses the
  subcommand is no longer additionally nagged about its word boundary; the
  wildcard-before-subcommand finding now carries its measured consequence
  (`Bash(git * main)` auto-approves `git push --force origin main`).
  Severity defaults remain documented as not stable in
  [docs/stability.md](docs/stability.md); pin them in `agentfile.yaml` if CI
  depends on them.

## [2.1.1] — 2026-09-01

2.1.0 shipped with a claim it had only partly earned. The lesson of that
release was that a parse error belongs to the linter, not the program — and
the fix went to one of the five call sites that had the bug. This release
comes from running 2.1.0 over ten popular repositories in full and measuring
every error it produced against Claude Code 2.1.238. There were 69 findings at
error severity. All 69 were wrong, in six distinct ways, and every fix below
carries the measurement that grounds it. The same run's one true finding — an
invisible U+2060 WORD JOINER inside a code span in trigger.dev's Cursor rules
— still stands, now at the right line number.

### Fixed

- **A markdown link is not an import.** `AGF004`'s capture ran through
  `[@user](https://…)` link syntax into the URL, picked up a `/`, and passed
  the looks-like-a-path gate. Biome's CLAUDE.md credits twenty-two maintainers
  exactly that way, and every one was an error. No real import target contains
  a `]`, so the capture now stops there.

- **An import resolves from the file that declares it.** n8n's
  `.github/CLAUDE.md` opens with `@../AGENTS.md`, and the target is a real
  18KB file. The resolver used the directory the file *governs* — the root —
  so the `..` escaped the repository and the import was reported missing.
  Measured: a chain of imports loads `sub/leaf.md` from `sub/mid.md` while an
  identically named file at the root stays unloaded, so resolution is
  file-relative and root-relative is not a fallback. That cuts both ways: an
  import that only resolves against the root is genuinely broken and is now
  reported, where before it passed. A target that escapes the repository is
  never reported — a bounded scan cannot prove absence.

- **Skills, commands, and `.claude/rules` read their frontmatter the way the
  programs do.** The 2.1.0 lenient parser went to subagents only.
  trigger.dev's `drizzle` skill — an unquoted description carrying
  `conventions: ` — loads in Claude Code and echoes its description back
  verbatim, while agentfile reported a parse error and a missing description.
  Measured per surface: a command whose frontmatter reads
  `description: uses: colons, badly: everywhere` is listed with exactly that
  description, and a rule with the same shape still loads its body. All five
  call sites now share the strict-then-lenient reading; an unclosed fence is
  still an error in either reading.

- **An emoji's joiner is rendered, not hidden.** `AGF505` flagged the ZERO
  WIDTH JOINER inside PostHog's 🧑‍💻 — the codepoint that makes two
  pictographs one glyph. A well-formed emoji ZWJ sequence is now exempt; a
  joiner that joins nothing is still a finding.

- **`AGF505` line numbers point at the file, not the body.** Skill and
  subagent text starts after the frontmatter, and the scanner numbered it from
  1 — PostHog's finding said lines 306 and 311 when the characters sat on 317
  and 322. Skills and subagents now carry `bodyLine` through the IR, the same
  anchor instructions already had.

### Changed

- **A skill name the loader ignores cannot be an error.** Measured: a skill
  named `n8n:create-pr` in a `create-pr/` directory loads and is invoked as
  `create-pr`, and a skill in a directory named `My_Weird.Skill` loads and is
  invoked as exactly that. The directory is the identity, so `AGF101`'s
  name-grammar and directory-mismatch findings drop to warning severity, and a
  name that both breaks the grammar and mismatches its directory is one
  finding, not two — n8n went from 44 errors to 22 warnings. `AGF102` drops
  its default to warning for the same reason: a `SKILL.md` with no frontmatter
  at all still loads, is listed with its first heading standing in for the
  description, and resolves when invoked by name. Missing metadata degrades
  discovery; it does not break the skill. Severity defaults are documented as
  not stable in [docs/stability.md](docs/stability.md); pin them in
  `agentfile.yaml` if CI depends on them.

## [2.1.0] — 2026-09-01

A minor, not the patch this started as. Most of it is correctness work, but
`AGF306` is a new code, so a repository that reported nothing can now report
something — and a repository that reported `AGF003` on a `.mdc` file will stop.
Anything gating CI on the output sees a change, which is a minor by
[docs/stability.md](docs/stability.md).

Three threads run through it. The first began with running 2.0.0 against a
repository small enough to sit under the scan cap: truncation had been hiding
five bugs, because the bounded-scan guard suppresses exactly the checks that
were wrong. The second began with @gantoine's review of an upstream PR, which
showed that a flagship example was built on an assumption about a file format
nobody had checked. That prompted a documentation-first audit of the hooks and
permission surfaces.

The third was running the permission analyser over 12,556 rules from 344
`.claude/settings.json` files in public repositories. Fixtures only contain
what someone thought to write down; the corpus found two checks firing on
documented-valid syntax, and caught a third false positive in a check added
that same afternoon, before it shipped.

### Added

- **Three documented ways a permission rule does not do what it says.** All
  three are `AGF506`, which already means "permission rule does not grant what
  it appears to", so no new code is involved.

  An `mcp__` rule with parentheses is *skipped* when the settings file loads —
  discarded whole, not narrowed. As a deny rule that is the worst thing a
  permissions file can contain: it reads as a restriction, a reviewer counts it
  as one, and the tool is unrestricted. Claude Code says so in the
  invalid-settings dialog and in `claude doctor`, but not in the diff where the
  rule was added.

  A tool's primary content field cannot be parameter-matched — `command` on Bash
  and PowerShell, `file_path` on Read, Edit and Write, `path` on Grep and Glob,
  `notebook_path` on NotebookEdit, `url` on WebFetch. Claude Code ignores such a
  rule and warns at startup. Deny and ask only: parameter matching is documented
  for those effects, while allow rules keep each tool's own specifier syntax.

  Environment runners are not stripped wrappers, so `Bash(devbox run *)` allows
  `devbox run rm -rf .`. This is the mirror of the existing exec-wrapper check —
  that one reports a rule that approves less than it appears to, this one a rule
  that approves far more. Allow rules only, and only when the wildcard sits
  directly after the runner. The five runners are the five the documentation
  names.

  Across the 344-file corpus these find 26 real `Bash(npx *)` grants and one
  skipped `mcp__*(*)` rule.

- **And the last four, which complete the permissions page.** Every defect the
  page documents is now detected — 16 of 16 against a fixture built from the
  page itself, up from 7.

  An **allow** rule that spans a command separator grants nothing. A command is
  split on `&&`, `||`, `;`, `|`, `|&`, `&` and newlines *before* rules are
  matched, so `Bash(cd src && go build:*)` is compared against fragments it
  cannot equal and the command still prompts. 61 rules in the corpus.

  Allow only, and that limit came from running Claude Code rather than reading
  about it. With `printf` and `tee` as the two halves, so neither is a built-in
  read-only command: allowing both subcommands separately runs; allowing only
  the whole compound is refused; allowing both and *denying* the whole compound
  is also refused. So a deny rule spanning a separator does block —
  `Bash(curl * | sh)` in a deny list works — and an earlier version of this
  check called 67 such rules dead on the strength of a documented sentence
  written about allow semantics.

  Two details decide whether the check is useful or noise — a pipe inside
  `sed 's|a|b|'` is an argument, not an operator, and 161 rules are that shape;
  and `>&` is a redirection, so reading it as a separator would report the real
  reverse-shell deny rule `Bash(bash -i >& /dev/tcp/*)` as dead.

  A wildcard in the subcommand slot: in `Bash(git * main)` only `git` limits the
  rule, so `git push --force main` is approved. Claude Code warns about this
  shape at startup.

  A tool name that cannot exist. `Stop Task` is a transcript label; the
  canonical name is `TaskStop`, and rules match the canonical name only. Only
  structurally impossible names are reported — in practice, names containing
  whitespace — rather than names missing from a list of known tools, because
  such a list would report every tool added after this version shipped. It
  catches something a list would not: JSON has no comments, so a
  `// === Git Operations ===` line in a permissions array is an inert rule. All
  27 whitespace-bearing names in the corpus are exactly that.

  A `curl` rule pinned to a host is recorded at info, not raised. The
  documentation calls the pattern fragile rather than wrong: the rule works for
  what it matches, and the spellings it misses still prompt. Exact-match rules
  and loopback addresses are not reported.

  Findings now have a precedence, so a rule that matches nothing is reported
  once rather than alongside three observations about what it matches too much
  or too little.

- **`AGF306`, a `globs` value Cursor will not match.** The inverse of the
  mistake described under the `.mdc` reader below: a quoted or bracketed
  `globs:` value is valid YAML and is exactly what a YAML-shaped intuition
  writes, and Cursor matches none of it, because it compares the raw text. The
  rule is reported as manual rather than path-scoped, so `AGF303` does not
  report the same thing again with the cause removed.

  Nothing else checks this, because checking it requires knowing that `.mdc`
  frontmatter is not YAML.

### Fixed

- **A nested rule directory now scopes its globs to what it governs.** Cursor
  and Claude both let a subproject carry its own rule directory, and its globs
  are relative to that subproject. They were matched against the repository root
  instead, which was wrong in both directions at once:
  `python/.cursor/rules/python.mdc` with `globs: *.py` was reported as never
  applying while `python/conftest.py` sat beside it, and was reported as
  applying the moment any unrelated `*.py` existed at the repository root — an
  answer about a different file entirely. `governedDirectory` already computed
  the right base for unscoped rules; it is now used for scoped ones too. A
  leading `/` is the author anchoring to the root and is left alone.

- **An unresolved alias points at the alias, not at line 1.** The error the YAML
  library throws for `globs: *.py` carries no position, so the finding was
  hardcoded to the first line of the frontmatter — correct only when the broken
  key happened to be first. This is the code path behind the most common finding
  agentfile produces, and SARIF turns that line into a code-scanning annotation,
  so a wrong line put a marker on innocent code. Parsing succeeds in this case
  and only conversion fails, so the alias is still a real node with a real
  range; the finding now uses it.

- **A bare path in a skill can mean the repository root.** A link like
  `services/mcp/src/lib/instructions.ts` in a `SKILL.md` has two readings:
  relative to the file, which is what Markdown says, and relative to the
  repository root, which is how people write paths in a document *about* a
  repository. Only the first was tried, so a file sitting at the root was
  reported as a broken reference at error severity. Both readings are now
  checked before a link is called broken; `./` and `../` are left alone, since
  those state where the file is.

- **A bad invocation exits 2, and a missing `--root` is a bad invocation.**
  [docs/stability.md](docs/stability.md) makes exit 1 a fact about the
  repository and exit 2 a fact about the invocation. Commander's own failures —
  an unknown option, a malformed argument — exited 1, which CI reads as findings
  at error severity. Worse, `--root` naming a path that does not exist scanned
  nothing, reported "no agent configuration found" and exited 0, so a typo in a
  CI job read as a permanently clean repository. `--root` must now name a
  directory that exists, checked at parse time so every command gets it.
  `--help` and `--version` keep their exit 0.

- **`doctor` says "1 rule applies everywhere".** The count was pluralised and
  the verb was not.

- **`.mdc` frontmatter is not YAML, and quoting a glob breaks it.** Cursor reads
  the raw text after `globs:` as the pattern list. It is not a YAML parser,
  which is why `globs: *.py` works there, why Cursor's UI writes globs unquoted
  and comma-separated, and why every example in its documentation is unquoted.

  Parsing it as YAML was wrong three times over. A leading `*` opens an alias,
  so the whole block failed and `description` and `alwaysApply` were lost with
  it. `AGF003` was reported at error severity on a file that works. And the
  suggested fix was to quote the value, which is the one edit that stops Cursor
  matching the pattern at all — advice that silently disables the rule it claims
  to repair.

  `.mdc` now has its own reader. `.claude/agents` keeps the strict YAML one:
  Anthropic documents that block as YAML, and the block-scalar form appears in
  thousands of public repositories.

  Caught by @gantoine reviewing PostHog/posthog#91631, who tested the consumer
  instead of the spec. Both upstream PRs have been corrected.

- **A leading bracket is a character class, not a YAML list.** The `AGF306`
  check above shipped hours after that lesson and immediately repeated it, by
  reading `[abc]*.ts` as a bracketed list. It is a glob character class and
  Cursor matches it. A bracketed value is only reported when it also contains a
  quote.

- **A hook with `args` has no shell, so it has no shell mechanisms.** Claude
  Code documents two forms for a `command` hook, and the presence of `args` is
  the whole switch: without it the string is passed to a shell, with it the
  executable is spawned directly and "there is no shell, so each `args` element
  is one argument exactly as written". Both were matched against the same
  patterns, so `{"command": "/bin/echo", "args": ["rm -rf /tmp/danger"]}` was
  reported as deleting recursively. It prints a string.

  Each pattern now states what it depends on. A shell mechanism cannot happen
  without a shell. A finding about a program needs that program to be the
  executable. A finding about text holds wherever the text appears. Shells
  invoked *as* the executable are still read, so `{"command": "bash", "args":
  ["-c", "curl x | sh"]}` is not a new blind spot.

  A false positive on the security surface is the most expensive kind this tool
  can produce: a reader who finds one alarm untrue has no reason to trust the
  next.

- **A repository that switched its hooks off is not running them.**
  `disableAllHooks` is a documented setting and agentfile did not read it, so
  every hook in such a repository was reported as something that runs
  automatically with no prompt. It is now read from both settings files a
  repository can commit, with project local outranking shared project as
  documented.

  Findings are kept rather than dropped — the switch is documented as temporary,
  and dropping them would make one line in a settings file the cheapest place to
  hide a `curl | sh` hook. They are reported at the severity something that does
  not run deserves. A credential in a committed header is the exception and
  keeps its severity: it is disclosed whether or not anything ever sends it.

- **`Bash(find:*)` and `Bash(find *)` are the same rule.** The documentation
  says so — "the `:*` suffix is an equivalent way to write a trailing wildcard"
  — but every check that reads the command word saw only the space form, so the
  same rule got two verdicts depending on which spelling its author chose.

  Found by running against chain33, a 733-star repository cloned in full. It
  writes all 45 of its permission rules in the `:*` form and agentfile reported
  nothing; one of them is `Bash(find:*)`, which does not cover `find -exec`.
  The missed spelling is the more common one: across 12,556 rules,
  `Bash(find:*)` appears 77 times against 26 for `Bash(find *)`. Normalising it
  adds 111 findings that were always true.

- **Two permission checks fired on rules the documentation defines.** Neither
  appeared against fixtures.

  `:*` is Bash syntax — the documentation puts the trailing-wildcard suffix in
  the Bash section, and PowerShell "use the same shape as Bash rules". Every
  other tool gives the colon its own meaning, and `WebFetch(domain:*.example.com)`
  is a documented form that matches any subdomain at any depth. agentfile read
  that `:*` as a misplaced Bash prefix and reported the rule as matching
  nothing, at error severity, which fails CI. Eleven of the thirteen rules that
  tripped this check in the corpus were WebFetch subdomain wildcards.

  A `*` after punctuation is already at a word boundary. `Bash(ls*)` matching
  `lsof` is real, but the mechanism is a wildcard continuing a word. In
  `Bash(rm -rf /*)` the `*` follows a slash, so it extends a path and no command
  other than `rm` can match — and the suggested `Bash(rm -rf / *)` is a
  different rule that, as a deny, stops matching `rm -rf /etc`. 147 of 916
  findings had that shape. Advice that quietly weakens the rule it claims to
  repair is the same mistake as telling people to quote their Cursor globs.


## [2.0.0] — 2026-08-31

The 2.0 line, stable. `npm install @agentfile/cli` now resolves to it, which is
the substantive part of this release: `latest` pointed at the v1 CLI throughout
the beta, so every command in the README failed for anyone who followed it.
[docs/migration-v2.md](docs/migration-v2.md) covers what changes for an existing
repository; the three beta entries below carry the detail of what 2.0 is.

### Breaking

- **Truncation is `AGF006`, not `AGF002`.** One code carried two unrelated
  meanings: "configuration file not found" and "the repository scan stopped
  early". They are different problems with different severities, and merging
  them meant `agentfile rule AGF002` explained the wrong one, a SARIF `ruleId`
  mislabelled it, and a `severity: AGF002: off` written to quiet truncation
  noise also silenced genuine missing-file errors. Diagnostic codes are
  append-only, so this had to land before the meaning froze at stable.

  `AGF002` keeps its registered meaning and is unchanged. Anything matching on
  the truncation warning by code needs to look for `AGF006`.

### Added

- **A GitHub Action.** `uses: dennishavermans/agentfile@v1` runs `check`, writes
  SARIF, and fails the step on findings. It deliberately does not upload the
  SARIF: that needs `security-events: write`, and a job asking for write access
  to security alerts should say so where a reader can see it rather than acquire
  it inside a step called "run the linter". The README shows the upload step.

### Fixed

- **`--format sarif` is discoverable.** It has worked on `check`, `validate`,
  `lint` and `audit` since it landed, but every command's `--help` said
  `human or json`, so the CLI contradicted the README. Corrected on those four;
  the rest reject SARIF deliberately and were already accurate.

- **The truncation warning is covered by a test that pins its code.** The
  existing test asserted the word "truncated" appeared in the message, which is
  exactly why the `AGF002` overload survived unnoticed.

## [2.0.0-beta.3] — 2026-08-28

### Fixed

- **The same truncation bug, in the other direction.** `AGF303` asks whether any
  file matches a glob, which a bounded scan cannot answer either: PostHog's
  `proto/**` and `tach.toml` were both reported as matching nothing while both
  sat on disk. A pattern is now only called dead when the scan is complete, or
  when the literal part of the pattern before its first wildcard is also absent
  from the disk. A pattern with no literal prefix cannot be settled that way and
  is left alone rather than guessed at.

  All three of PostHog's reported dead globs were this. It has none.

## [2.0.0-beta.2] — 2026-08-27

### Fixed

- **A bounded scan proved absence, and it cannot.** The repository scan stops
  after 20,000 files so a huge repository degrades into a reported truncation
  rather than a hang. Every skill link and hook script pointing past that cut
  was reported as a missing file — 65 findings in PostHog alone, whose 47,010
  files do not fit, and every one of them was wrong. Absence is now settled
  against the disk; presence in the file list is still checked first because it
  is free and answers most cases. Instruction imports were never affected,
  because they already checked the disk.

  PostHog goes from 74 findings to 41, and its two remaining broken links are
  real: one skill link is missing its `../../../` and resolves inside the skill
  directory, and one points at a tool that is not in the repository.

  Found while recording a demo, which showed the tool reporting files that were
  plainly there.

- `doctor --format json` now carries `scan.truncationReason`. The human output
  already said why a scan stopped early; a machine consumer deciding whether to
  trust an incomplete report needs the same sentence.

## [2.0.0-beta.1] — 2026-08-27

The v2 rework, in one release. See [docs/migration-v2.md](docs/migration-v2.md)
for what changes for an existing repository — the short answer is that nothing
you have breaks, and `agentfile doctor` now works in a repository that has never
heard of agentfile.

### Breaking

- **Usage errors exit `2`, not `1`.** A mistyped flag, an unknown `--target`, an
  unparsable `--budget`. Exit `1` now means one thing only: agentfile ran and
  found something. This was already true of `compile` and `eval` and false of
  everything else, which left "the build failed" ambiguous between a bad
  argument and a real finding. The contract is pinned by test and documented in
  [docs/stability.md](docs/stability.md).
- **`@agentfile/ui` is an optional peer dependency.** `agentfile ui` needs it
  installed alongside the CLI; every other command works without it, and the CLI
  says so if it is missing. It ships an HTTP server and a built front end, which
  is a lot to install on a machine that only runs `check` in a pre-commit hook.
  Same arrangement as `vitest --ui`.
- **Node `>=22`**, down from `>=24`. `@types/node` is pinned to the same line so
  the compiler enforces the floor rather than the `engines` field claiming it.

### Added

- **`agentfile adopt`** — plans a single source of truth for the configuration a
  repository already has, and shows the plan before touching anything. Two
  phases, in an order that is not cosmetic: consolidate every platform's text
  into one hand-written source, then generate the rest from it. A compiler never
  carries a target's own file into that target, so generating `CLAUDE.md` while
  it still holds unique text would lose that text.
- **`AGF205`** — two compile targets that would each be built from the other.
  Without `--force` this surfaces as per-file refusals; with `--force` the two
  files swap contents, which looks like a successful compile and is not.
- **Slash commands are configuration.** `.claude/commands/` and
  `.cursor/commands/` are discovered, and the shell a Claude command embeds with
  `` !`…` `` — which runs at invocation, before the model sees the output, and
  is reachable by the model itself unless `disable-model-invocation` bars it —
  is audited as `AGF501`. Nothing is executed.
- **Suppression directives.** `agentfile-disable`, `-line` and `-next-line`, in
  `<!-- -->`, `#` or `//` comments. Suppressed findings are counted and kept,
  never silently dropped, and a directive that silences nothing is reported as
  `AGF005` — including in files that are now clean, which is where stale
  suppressions accumulate.
- **`agentfile.yaml`** — ignored directories, per-code severity including `off`,
  budget, similarity, targets, warning ceiling. Optional, and strict: an
  unrecognised key is an error, and a file that fails to validate is reported
  and then ignored entirely rather than half-applied. Flags always win.
- **`--format sarif`** on `check`, `validate`, `lint` and `audit`. Every code is
  declared with a documentation link, including ones that did not fire, and
  findings are fingerprinted without their line number so an edit above a
  finding does not close the alert and open an identical one.
- **`--max-warnings <n>`** — a ratchet for working a count down, without
  `--strict`'s claim that every warning is a failure.
- **`agentfile rule [code]`** — what a diagnostic code means, from the registry
  that produces it.
- **`AGF206`** — an instruction file past a limit a platform documents; today
  Codex truncating `AGENTS.md` at 32 KiB. Distinct from `AGF201`–`AGF203`: the
  target supports everything in the file and stops partway through, so those
  rules are not unsupported, they are unread.
- **CI**, across ubuntu, macOS and Windows on Node 22 and 24, plus a smoke job
  that installs the packed tarballs into a bare project, and a scheduled corpus
  job that analyses PostHog, Next.js and Expo.
- **[docs/stability.md](docs/stability.md)** — what consumers may depend on, and
  what is deliberately free to change.

### Fixed

- Symlinked instruction files are one text, not two. A `CLAUDE.md` symlinked to
  `AGENTS.md` was reported as duplication and counted twice against the context
  budget.
- Scoped npm package names in prose (`@next/rspack-core`) are no longer read as
  broken imports.
- A malformed YAML frontmatter value no longer aborts discovery, and one bad
  file produces one finding rather than dozens.
- The generated-file marker is written after YAML frontmatter, not above it,
  which previously unscoped every generated rule file.
- Glob matching is pinned to POSIX semantics, so a repository does not resolve
  differently depending on who cloned it.
- The dashboard is imported lazily, taking roughly 15% off the startup of every
  other command.
- `.gitattributes` normalises line endings, so `compile --check` cannot report
  permanent drift on a CRLF checkout.

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
  documented specificity order, built on Node's `path.posix.matchesGlob` so no
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

### Added — skills: specification validation, quality analysis, static inspection

`SKILL.md` is an external standard
(<https://agentskills.io/specification>). Agentfile validates against it and does
not extend it or invent a replacement. Every constraint enforced has its source
recorded in `packages/core/src/skills/spec.ts`, and the specification's own
distinction between *must* and *recommended* is preserved in the severities.

There is deliberately **no skill score**. A single number rolled up from six
unrelated signals cannot be explained, only argued with. Each finding stands on
its own and carries its own threshold.

- **Specification validation** (`AGF101`, `AGF102`) — names outside the allowed
  character set or length, a name that does not match its parent directory,
  over-length `description` or `compatibility`, two skills sharing a name, and
  the two required fields. A name/directory mismatch is not cosmetic: platforms
  locate a skill by directory, so the skill loads under a name its own
  frontmatter disagrees with.
- **Broken skill links** (`AGF004`) — a body promising `references/api.md` and
  shipping without it does not fail. The agent looks, finds nothing, and carries
  on with less than the skill said it would have.
- **Routing quality** (`AGF103`) — descriptions too short to choose on, or that
  never say when to use the skill. Also reports two skills whose descriptions are
  similar enough that nothing tells an agent which to pick — the one "overly
  broad" signal that can be measured rather than guessed.
- **Context bloat** (`AGF104`) — bodies over the specification's recommended
  5000 tokens or 500 lines, and code blocks long enough to belong in a resource
  file. Skills exist for progressive disclosure; a body this large defeats it.
- **Resource layout** (`AGF105`, info) — files nested deeper than one level, and
  files the body never mentions. Info severity because a platform may list a
  directory rather than follow links, so an unreferenced file is worth knowing
  about and not worth failing a build over.
- **Portability** (`AGF106`) — frontmatter outside the specification, named key
  by key with whose extension each is. Not a mistake, a constraint: claude.ai
  uploads and the Skills API accept only the specification's fields. Also reports
  routing metadata over Claude Code's documented 1,536-character listing limit.
- **Static inspection of bundled scripts** (`AGF501`) — a small, documented set
  of risk patterns, each with a stated reason: piping a download into a shell,
  decoding text and executing it, evaluating a variable as a command, hardcoded
  keys and credentials, recursive force-deletes, privilege escalation,
  credential-path access, disabled certificate verification, world-writable
  permissions, and outbound network calls recorded as information.

  **Nothing is executed.** Files are read as text and matched against patterns —
  no shell, no interpreter — even when the whole point of the file is to be run.
  A clean result means "no pattern in this list matched", which is far weaker
  than "safe", and the wording says so. Files that could not be inspected are
  reported rather than passed over.

- **New validation rules** — `skill-specification` (structural),
  `skill-quality` (quality), `skill-scripts` (security). The `security` layer now
  has a rule, so `validate` covers it; `check` still runs structural and
  resolution only, keeping the pre-commit path free of file reads.
- `agentfile doctor` now reports skill specification breaches, since those are
  errors nothing else in the toolchain surfaces.

### Changed

- `analyzeSkillRouting` returns structured problems (`{ kind, message }`) instead
  of strings, and no longer judges specification violations — an over-length
  description is `AGF101`, not a routing signal. It is now the single judgement
  of routing quality, and the `AGF103` diagnostic is built from it, so `doctor`
  and `validate` cannot disagree about the same skill.
- `basenameOf` moved from `discovery/` to `paths/`, where it belongs. Still
  exported under the same name.
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
