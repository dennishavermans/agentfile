/// <reference types="node" />
/**
 * The exit-code contract at the binary boundary (docs/stability.md): 1 is a
 * fact about the repository, 2 is a fact about the invocation.
 *
 * The command functions honour it — they exit through EXIT_USAGE — but
 * commander's own failures (an unknown option, a bad --root) used to exit 1,
 * which CI reads as "findings at error severity", and a --root that named no
 * directory scanned nothing and exited 0. These have to be tested by spawning
 * the built binary, because commander does the parsing before any command runs.
 * CI builds before it tests, so dist/ is present.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = join(__dirname, "..", "dist", "bin.js");

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf-8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("exit codes at the binary boundary", () => {
  it("exits 2 for an unknown option, not 1", () => {
    const { code, stderr } = run("check", "--nonsense");
    expect(code).toBe(2);
    expect(stderr).toContain("unknown option");
  });

  it("exits 2 when --root names no directory, instead of a clean 0", () => {
    const { code, stderr } = run("check", "--root", "/nonexistent-dir-for-agentfile-tests");
    expect(code).toBe(2);
    expect(stderr).toContain("no such directory");
  });

  it("exits 2 when --root names a file rather than a directory", () => {
    const { code } = run("check", "--root", BIN);
    expect(code).toBe(2);
  });

  it("keeps --help at 0", () => {
    const { code, stdout } = run("--help");
    expect(code).toBe(0);
    expect(stdout).toContain("agentfile");
  });

  it("keeps -V at 0", () => {
    const { code, stdout } = run("-V");
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
