/// <reference types="node" />
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doctorCommand } from "../src/commands/doctor.js";
import { EXIT_USAGE } from "../src/report.js";

const TEST_DIR = join(process.cwd(), "__test_doctor__");

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

function write(relative: string, content: string) {
  const target = join(TEST_DIR, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf-8");
}

/** Captures stdout and console output for one command run. */
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

describe("doctor command", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let exitCodes: number[];

  beforeEach(() => {
    cleanup();
    mkdirSync(TEST_DIR, { recursive: true });
    exitCodes = [];
    // process.exit must not tear down the test runner, but the code it would
    // have used is part of the contract, so it is recorded.
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

  it("says so plainly when a repository has no agent configuration", async () => {
    const output = captureOutput();
    await doctorCommand({ root: TEST_DIR });
    const text = output.text();
    output.restore();

    expect(text).toContain("No agent configuration found");
    expect(text).toContain("AGENTS.md");
    expect(exitCodes).toEqual([]);
  });

  it("reports the configuration it finds, grouped by platform", async () => {
    write("AGENTS.md", "# Team\n\n- Use pnpm as the package manager\n");
    write(".github/copilot-instructions.md", "# Copilot\n\nPrefer small functions everywhere.\n");

    const output = captureOutput();
    await doctorCommand({ root: TEST_DIR });
    const text = output.text();
    output.restore();

    expect(text).toContain("Configuration found");
    expect(text).toContain("agents-md");
    expect(text).toContain("copilot");
    expect(text).toContain("Always-loaded context");
  });

  it("labels the token figure as an estimate", async () => {
    write("AGENTS.md", "# Team\n\n- Use pnpm as the package manager\n");

    const output = captureOutput();
    await doctorCommand({ root: TEST_DIR });
    const text = output.text();
    output.restore();

    expect(text).toContain("(estimated)");
    expect(text).toContain("not measured with a");
  });

  it("finds the same rule maintained for several platforms", async () => {
    write("AGENTS.md", "- Use pnpm as the package manager\n");
    write(".github/copilot-instructions.md", "- Use pnpm as the package manager\n");
    write(".cursor/rules/main.mdc", "---\nalwaysApply: true\n---\n\n- Use pnpm as the package manager\n");

    const output = captureOutput();
    await doctorCommand({ root: TEST_DIR });
    const text = output.text();
    output.restore();

    expect(text).toContain("AGF302");
    expect(text).toContain("Use pnpm as the package manager");
    expect(text).toContain("maintained separately for");
  });

  it("exits non-zero when it finds an error, so CI can gate on it", async () => {
    write(".mcp.json", JSON.stringify({ mcpServers: { broken: { url: "https://example.com" } } }));

    const output = captureOutput();
    await doctorCommand({ root: TEST_DIR });
    output.restore();

    expect(exitCodes).toEqual([1]);
  });

  it("exits zero when the only findings are warnings", async () => {
    write("AGENTS.md", "- Use pnpm as the package manager\n");
    write("CLAUDE.md", "- Use pnpm as the package manager\n");

    const output = captureOutput();
    await doctorCommand({ root: TEST_DIR });
    const text = output.text();
    output.restore();

    expect(text).toContain("AGF302");
    expect(exitCodes).toEqual([]);
  });

  it("flags a skill whose description cannot be routed on", async () => {
    write(".claude/skills/deploy/SKILL.md", "---\nname: deploy\ndescription: Deploys stuff.\n---\n\nRun it.\n");

    const output = captureOutput();
    await doctorCommand({ root: TEST_DIR });
    const text = output.text();
    output.restore();

    expect(text).toContain("Skill routing metadata");
    expect(text).toContain("deploy");
    expect(text).toContain("not model behaviour");
  });

  it("reports directory-scoped configuration separately", async () => {
    write("AGENTS.md", "- Use pnpm as the package manager\n");
    write("apps/mobile/AGENTS.md", "- Use React Native primitives, never web DOM elements\n");

    const output = captureOutput();
    await doctorCommand({ root: TEST_DIR });
    const text = output.text();
    output.restore();

    expect(text).toContain("Directory-scoped configuration");
    expect(text).toContain("apps/mobile");
  });

  it("lists every file with --verbose", async () => {
    write("AGENTS.md", "- Use pnpm as the package manager\n");
    write(".claude/rules/api.md", '---\npaths: ["src/api/**"]\n---\n\nValidate every input.\n');

    const output = captureOutput();
    await doctorCommand({ root: TEST_DIR, verbose: true });
    const text = output.text();
    output.restore();

    expect(text).toContain(".claude/rules/api.md");
    expect(text).toContain("AGENTS.md");
  });

  it("emits machine-readable JSON", async () => {
    write("AGENTS.md", "- Use pnpm as the package manager\n");
    write(".mcp.json", JSON.stringify({ mcpServers: { db: { command: "npx" } } }));

    const output = captureOutput();
    await doctorCommand({ root: TEST_DIR, format: "json" });
    const text = output.text();
    output.restore();

    const parsed = JSON.parse(text);
    expect(parsed.platforms).toContain("agents-md");
    expect(parsed.report.version).toBe(1);
    expect(parsed.alwaysLoadedContext.estimateMethod).toBe("characters-per-token-heuristic");
    expect(Array.isArray(parsed.sources)).toBe(true);
  });

  it("rejects an unknown format instead of guessing", async () => {
    const output = captureOutput();
    await doctorCommand({ root: TEST_DIR, format: "xml" });
    const text = output.text();
    output.restore();

    expect(text).toContain("Unknown format");
    expect(exitCodes).toEqual([EXIT_USAGE]);
  });

  it("does not read generated or vendored directories", async () => {
    write("node_modules/pkg/AGENTS.md", "- Vendored rule that must not be reported\n");

    const output = captureOutput();
    await doctorCommand({ root: TEST_DIR });
    const text = output.text();
    output.restore();

    expect(text).toContain("No agent configuration found");
  });

  it("changes nothing on disk", async () => {
    write("AGENTS.md", "- Use pnpm as the package manager\n");

    const output = captureOutput();
    await doctorCommand({ root: TEST_DIR });
    output.restore();

    // Analysis is read-only: no manifest, no backups, no generated files.
    expect(existsSync(join(TEST_DIR, ".agentfile-manifest.json"))).toBe(false);
    expect(existsSync(join(TEST_DIR, ".agentfile-backup"))).toBe(false);
    expect(existsSync(join(TEST_DIR, "CLAUDE.md"))).toBe(false);
  });
});
