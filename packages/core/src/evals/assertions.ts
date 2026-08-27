/// <reference types="node" />

/**
 * The deterministic assertion engine.
 *
 * Every assertion is a yes/no question about the workspace after the run, and
 * every answer carries the observation that produced it — "exit 2", "found at
 * src/x.ts:14" — so a failure reads like evidence, not like a verdict. REWORK
 * §18 is explicit: no LLM judge where a deterministic assertion can answer.
 *
 * Assertion `commands` run inside the workspace, never in the user's tree.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalAssertions, TextAssertion } from "./definition.js";
import type { Workspace } from "./sandbox.js";

export type AssertionKind = "file" | "absent" | "command" | "contains" | "forbidden";

export interface AssertionResult {
  kind: AssertionKind;
  /** What was asserted: a path, a command, or the text. */
  target: string;
  passed: boolean;
  /** The observation: what was actually found or run. */
  detail: string;
}

export interface AssertionOptions {
  /** Files the run created or modified, for bare text assertions. */
  changedFiles: readonly string[];
  /** Timeout per assertion command. */
  commandTimeoutMs: number;
}

function describeText(assertion: TextAssertion): string {
  return typeof assertion === "string" ? assertion : `${assertion.text} in ${assertion.file}`;
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

/** Line number (1-based) of `needle` in `haystack`, or undefined. */
function lineOf(haystack: string, needle: string): number | undefined {
  const index = haystack.indexOf(needle);
  if (index === -1) return undefined;
  return haystack.slice(0, index).split("\n").length;
}

function searchWorkspace(
  workspace: Workspace,
  assertion: TextAssertion,
  changedFiles: readonly string[],
): { found: boolean; where: string } {
  if (typeof assertion !== "string") {
    const absolute = join(workspace.root, assertion.file);
    if (!existsSync(absolute)) return { found: false, where: `${assertion.file} does not exist` };

    const content = readFileSync(absolute, "utf-8");
    const line = lineOf(content, assertion.text);
    return line === undefined
      ? { found: false, where: `not in ${assertion.file}` }
      : { found: true, where: `${assertion.file}:${line}` };
  }

  for (const relative of changedFiles) {
    let content: string;
    try {
      content = readFileSync(join(workspace.root, relative), "utf-8");
    } catch {
      continue;
    }
    const line = lineOf(content, assertion);
    if (line !== undefined) return { found: true, where: `${relative}:${line}` };
  }

  return {
    found: false,
    where: changedFiles.length
      ? `not in any of the ${changedFiles.length} changed file${changedFiles.length === 1 ? "" : "s"}`
      : "the run changed no files",
  };
}

/** Runs every assertion. Order matches the definition, so reports are stable. */
export function runAssertions(
  workspace: Workspace,
  assertions: EvalAssertions,
  options: AssertionOptions,
): AssertionResult[] {
  const results: AssertionResult[] = [];

  for (const path of assertions.files ?? []) {
    const exists = existsSync(join(workspace.root, path));
    results.push({
      kind: "file",
      target: path,
      passed: exists,
      detail: exists ? "exists" : "does not exist",
    });
  }

  for (const path of assertions.absent ?? []) {
    const exists = existsSync(join(workspace.root, path));
    results.push({
      kind: "absent",
      target: path,
      passed: !exists,
      detail: exists ? "exists, but must not" : "absent",
    });
  }

  for (const command of assertions.commands ?? []) {
    const result = workspace.exec(command, { timeoutMs: options.commandTimeoutMs });
    const passed = result.exitCode === 0;
    results.push({
      kind: "command",
      target: command,
      passed,
      detail: passed
        ? `exit 0 in ${result.durationMs}ms`
        : result.timedOut
          ? `timed out after ${options.commandTimeoutMs}ms`
          : `exit ${result.exitCode ?? "none"}${firstLine(result.stderr) ? ` — ${firstLine(result.stderr)}` : ""}`,
    });
  }

  for (const assertion of assertions.contains ?? []) {
    const search = searchWorkspace(workspace, assertion, options.changedFiles);
    results.push({
      kind: "contains",
      target: describeText(assertion),
      passed: search.found,
      detail: search.found ? `found at ${search.where}` : search.where,
    });
  }

  for (const assertion of assertions.forbidden ?? []) {
    const search = searchWorkspace(workspace, assertion, options.changedFiles);
    results.push({
      kind: "forbidden",
      target: describeText(assertion),
      passed: !search.found,
      detail: search.found ? `found at ${search.where}` : "absent",
    });
  }

  return results;
}
