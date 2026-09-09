---
name: agent-config
description: Use when writing or editing agent configuration, especially permission rules in settings.json, skills, hooks, or MCP servers. Covers the permission-matching behaviour that makes a rule grant more than it reads, and how to check configuration with agentfile.
---

# Writing agent configuration that means what it says

Permission rules are the part people get wrong, because a rule that looks
narrow can be wide. The behaviour below was measured on Claude Code 2.1.238
with a write probe, a command that creates a file, so the read-only classifier
could not approve it on its own.

## The one thing to know

**Everything before the first `*` is matched as written, and that prefix is the
only thing limiting the rule. The wildcard spans spaces.**

Nearly every dangerous rule follows from that sentence.

## Rule shapes that grant more than they read

**A wildcard where the subcommand goes leaves only the program.**

`Bash(git * main)` reads as "git something main". It approves every git
subcommand and every option before it. Measured with that rule as the only rule
present: `git branch -D main` deleted the branch, and
`git -c core.fsmonitor=<script> diff main` ran the named script. `-c
core.fsmonitor=` makes git run a program you name, so this rule is arbitrary
command execution.

**A leading wildcard leaves nothing at all.**

`Bash(* --version)` has no prefix, so nothing limits it. Measured: `bash -c
'touch <marker>' --version` ran and the marker appeared. The tail still has to
match, which is exactly what makes the rule read narrower than it is.

**A runner passes the wildcard to a shell.**

`Bash(npx *)`, `Bash(uvx *)` and friends approve any command, because the
runner executes its arguments. The rule limits the runner, not what runs.

**`gh api` writes look like reads.**

A rule shaped for fetching also approves mutation, because the method is a
flag. `-X`, `--method`, `-f`, `-F`, `--field`, `--raw-field` and `--input` all
turn a GET into a write, and short flags cluster, so `-fkey=value` is `-f`.

**Some rules approve nothing at all.**

`:*` is only recognised at the end of a pattern. A shell separator like `&&`
splits a command before rules are matched, so a rule containing one never
fires. These are the harmless half of the same misunderstanding, and they are
worth fixing because they give false confidence.

## When writing a rule

Name the program and the subcommand, and put the wildcard last where you can:
`Bash(git diff *)` rather than `Bash(git * main)`. One rule per thing you mean
to approve. Deny beats allow, so a deny rule is the reliable half of a pair.

## Checking configuration

Run the full analysis over the repository:

```bash
npx @agentfile/cli doctor
```

`doctor` runs every layer. The narrower verbs are subsets of it: `check` for
the fast structural pass suitable for CI, `lint` for quality, `audit` for the
security layer alone. To understand one finding:

```bash
npx @agentfile/cli explain AGF506
```

Run it after editing `settings.json`, a skill, a hook, or an MCP server, and
before committing agent configuration.

## Reading the result

A clean run means no pattern in agentfile's set matched the configuration it
could read. It is not a statement that the configuration is safe: static
analysis cannot see intent, cannot follow a variable, and cannot read a binary.
Nothing is executed to produce the result.
