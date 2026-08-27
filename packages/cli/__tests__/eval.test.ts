/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evalCommand } from "../src/commands/eval.js";

const TEST_DIR = join(process.cwd(), "__test_eval__");

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

function write(relative: string, content: string) {
  const target = join(TEST_DIR, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf-8");
}

function captureOutput() {
  const chunks: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    chunks.push(args.map(String).join(" "));
  });
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((value: unknown) => {
    chunks.push(String(value));
    return true;
  });

  return {
    text: () => chunks.join("\n"),
    restore: () => {
      log.mockRestore();
      stdout.mockRestore();
    },
  };
}

/** A portable agent: node writes a file into the sandbox. */
function nodeAgent(code: string): string {
  return `"${process.execPath}" -e "${code.replaceAll('"', '\\"')}"`;
}

describe("eval command", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let exitCodes: number[];

  beforeEach(() => {
    cleanup();
    mkdirSync(TEST_DIR, { recursive: true });
    exitCodes = [];
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCodes.push(code ?? 0);
      return undefined as never;
    }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    vi.restoreAllMocks();
    cleanup();
  });

  it("says plainly when there are no eval definitions", async () => {
    const output = captureOutput();
    await evalCommand({ root: TEST_DIR });
    const text = output.text();
    output.restore();

    expect(text).toContain("No eval definitions found");
    expect(exitCodes).toEqual([]);
  });

  it("treats an invalid definition as a harness error with exit 2", async () => {
    write("evals/broken.eval.yaml", "name: broken\nassertions: {}\n");

    const output = captureOutput();
    await evalCommand({ root: TEST_DIR });
    const text = output.text();
    output.restore();

    expect(text).toContain("error");
    expect(exitCodes).toContain(2);
  });

  it("skips a prompted eval without an agent, exiting 0 — a skip is not a pass or a fail", async () => {
    write(
      "evals/task.eval.yaml",
      ["name: task", "prompt: Do the thing.", "assertions:", "  files:", "    - out.txt"].join("\n"),
    );

    const output = captureOutput();
    await evalCommand({ root: TEST_DIR });
    const text = output.text();
    output.restore();

    expect(text).toContain("skipped");
    expect(text).toContain("--agent");
    expect(exitCodes).toEqual([]);
  });

  it("runs a prompted eval against the named agent and passes deterministic assertions", async () => {
    write("src/index.ts", "export const x = 1;\n");
    write(
      "evals/create.eval.yaml",
      [
        "name: create-output",
        "prompt: Create out.txt containing accessibility notes.",
        "assertions:",
        "  files:",
        "    - out.txt",
        "  contains:",
        "    - accessibility",
        "  forbidden:",
        "    - eval(",
      ].join("\n"),
    );

    const output = captureOutput();
    await evalCommand({
      root: TEST_DIR,
      agent: nodeAgent("require('fs').writeFileSync('out.txt', 'accessibility matters')"),
    });
    const text = output.text();
    output.restore();

    expect(text).toContain("passed");
    expect(exitCodes).toEqual([]);
    // The agent ran in a sandbox: the user's tree has no out.txt.
    expect(existsSync(join(TEST_DIR, "out.txt"))).toBe(false);
  });

  it("exits 1 when assertions fail, with the observation in the output", async () => {
    write(
      "evals/failing.eval.yaml",
      ["name: failing", "assertions:", "  files:", "    - never-created.txt"].join("\n"),
    );

    const output = captureOutput();
    await evalCommand({ root: TEST_DIR });
    const text = output.text();
    output.restore();

    expect(text).toContain("does not exist");
    expect(exitCodes).toEqual([1]);
  });

  it("caches a result against the repository state and replays it", async () => {
    execFileSync("git", ["init", "-q"], { cwd: TEST_DIR });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "seed"], {
      cwd: TEST_DIR,
    });
    write("evals/pure.eval.yaml", ["name: pure", "assertions:", "  absent:", "    - never.txt"].join("\n"));

    const first = captureOutput();
    await evalCommand({ root: TEST_DIR });
    const firstText = first.text();
    first.restore();
    expect(firstText).not.toContain("cached");
    expect(existsSync(join(TEST_DIR, ".agentfile/eval-cache.json"))).toBe(true);

    const second = captureOutput();
    await evalCommand({ root: TEST_DIR });
    const secondText = second.text();
    second.restore();
    expect(secondText).toContain("cached");

    const third = captureOutput();
    await evalCommand({ root: TEST_DIR, cache: false });
    const thirdText = third.text();
    third.restore();
    expect(thirdText).not.toContain("cached");

    expect(exitCodes).toEqual([]);
  });

  it("replays a cached failure as a failure, never as a pass", async () => {
    execFileSync("git", ["init", "-q"], { cwd: TEST_DIR });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "seed"], {
      cwd: TEST_DIR,
    });
    write("evals/failing.eval.yaml", ["name: failing", "assertions:", "  files:", "    - never.txt"].join("\n"));
    execFileSync("git", ["add", "-A"], { cwd: TEST_DIR });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "eval"], { cwd: TEST_DIR });

    const first = captureOutput();
    await evalCommand({ root: TEST_DIR });
    first.restore();
    expect(exitCodes).toEqual([1]);

    exitCodes.length = 0;
    const second = captureOutput();
    await evalCommand({ root: TEST_DIR });
    const secondText = second.text();
    second.restore();

    expect(secondText).toContain("failed (cached)");
    expect(secondText).not.toContain("passed");
    expect(exitCodes).toEqual([1]);
  });

  it("emits a machine-readable report", async () => {
    write("evals/pure.eval.yaml", ["name: pure", "assertions:", "  absent:", "    - never.txt"].join("\n"));

    const output = captureOutput();
    await evalCommand({ root: TEST_DIR, format: "json" });
    const text = output.text();
    output.restore();

    const report = JSON.parse(text);
    expect(report.command).toBe("eval");
    expect(report.summary).toEqual({ passed: 1, failed: 0, errors: 0, skipped: 0 });
    expect(report.results[0].assertions[0]).toMatchObject({ kind: "absent", passed: true });
    expect(report.sandbox).toContain("temporary directory");
  });
});
