#!/usr/bin/env python3
"""Report agentfile findings for a file the agent just edited.

Informs, never blocks. A hook that refuses a write on a warning gets
uninstalled the same day, and a finding is advice rather than a verdict:
static analysis cannot see intent. Every failure path exits 0 silently, so a
missing binary or an unreadable payload can never wedge an edit.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

# Agent configuration only. Everything else is none of this hook's business.
SUFFIXES = ("CLAUDE.md", "AGENTS.md", ".mcp.json", "copilot-instructions.md")
DIRECTORIES = ("/.claude/", "/.cursor/")
LISTED = 5
PINNED = "@agentfile/cli@2.7.0"


def edited_path(payload: dict) -> str:
    tool_input = payload.get("tool_input") or {}
    return tool_input.get("file_path") or ""


def is_agent_configuration(path: str) -> bool:
    if any(path.endswith(suffix) for suffix in SUFFIXES):
        return True
    return any(directory in path for directory in DIRECTORIES)


def command_for(root: str) -> list[str] | None:
    """An installed binary beats a package fetch: faster, and works offline."""
    override = os.environ.get("AGENTFILE_BIN")
    if override:
        return [*override.split(), "doctor", "--root", root, "--format", "json"]
    if shutil.which("agentfile"):
        return ["agentfile", "doctor", "--root", root, "--format", "json"]
    if shutil.which("npx"):
        return ["npx", "--yes", PINNED, "doctor", "--root", root, "--format", "json"]
    return None


def findings_for(report: dict, relative: str) -> list[dict]:
    diagnostics = (report.get("report") or {}).get("diagnostics") or []
    return [d for d in diagnostics if (d.get("location") or {}).get("file") == relative]


def render(findings: list[dict], relative: str) -> str:
    lines = [f"agentfile on {relative}:"]
    for finding in findings[:LISTED]:
        line = (finding.get("location") or {}).get("line")
        where = f":{line}" if line else ""
        severity = finding.get("severity", "warning")
        lines.append(f"  {severity} {finding.get('code', '')}{where} {finding.get('message', '')}")
    if len(findings) > LISTED:
        lines.append(f"  and {len(findings) - LISTED} more")
    lines.append(f"  Detail: agentfile explain {findings[0].get('code', '')}")
    return "\n".join(lines)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    edited = edited_path(payload)
    if not edited or not is_agent_configuration(edited):
        return 0

    root = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    command = command_for(root)
    if command is None:
        return 0

    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=15)
        report = json.loads(completed.stdout)
    except Exception:
        return 0

    prefix = root.rstrip("/") + "/"
    relative = edited[len(prefix):] if edited.startswith(prefix) else edited

    findings = findings_for(report, relative)
    if not findings:
        return 0

    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": render(findings, relative),
                }
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
