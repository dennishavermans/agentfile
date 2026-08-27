# Security

## What agentfile promises

agentfile reads configuration that other people wrote, including hooks, scripts,
slash commands and MCP server definitions. Those are, by their nature, things
designed to be executed.

**Nothing agentfile discovers is ever executed.** Every analysis path reads files
as text and matches them against patterns. No shell is spawned, no interpreter is
invoked, no MCP server is started, no network request is made — including when
the whole point of the file is to be run.

There is exactly one exception, and it is opt-in and explicit: `agentfile eval`
runs the agent command **you** name, in a temporary directory seeded with a copy
of your files, only when you ask for it. It never runs anything found in the
repository, and it never runs in your working tree.

If you find a way to make any other command execute repository content, that is
a vulnerability. Please report it.

## What agentfile does not promise

A clean result means **no pattern matched**. It never means "this configuration
is safe".

Static analysis cannot see intent. A hook that pipes a script into a shell is
reported because that construct is worth a second look, not because agentfile
knows it is malicious — and a genuinely malicious hook written in an ordinary
way will not be reported at all. Treat findings as a reason to read something,
never as a substitute for reading it.

The same applies in reverse: agentfile reporting nothing about a repository is
not a security review of that repository.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use [GitHub's private vulnerability
reporting](https://github.com/dennishavermans/agentfile/security/advisories/new),
which reaches the maintainers without disclosing anything publicly.

Useful things to include, as far as you have them:

- what you did, precisely enough to repeat
- what happened, and what you expected instead
- the version (`agentfile --version`) and platform
- whether it requires a crafted repository, and if so the smallest one that shows it

You will get an acknowledgement within a few days. This is a small project
without a paid security team, so please be patient with the timeline — but a
report will not be ignored.

### What counts

- Any command other than `eval` executing content found in a repository
- `eval` escaping its sandbox, or touching the working tree
- A crafted configuration file causing agentfile to write outside the project root
- A credential, token or file content being sent anywhere
- A crafted repository causing an unbounded hang or memory exhaustion

### What does not

- A finding you disagree with. That is a false positive, and a
  [normal issue](https://github.com/dennishavermans/agentfile/issues/new/choose)
  is the right place — it is useful feedback, just not a vulnerability.
- A missed defect. Also a normal issue, and also useful.
- Vulnerabilities in the configuration agentfile is analysing. Those belong to
  the repository that ships them.

## Supported versions

While v2 is in beta, fixes go to the latest release only.

| Version | Supported |
| --- | --- |
| 2.0.0-beta.x | Yes |
| 0.4.x and earlier | No |
