/// <reference types="node" />
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adoptCommand } from "../src/commands/adopt.js";

const TEST_DIR = join(process.cwd(), "__test_adopt__");

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

function write(relative: string, content: string) {
  const target = join(TEST_DIR, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf-8");
}

function read(relative: string): string {
  return readFileSync(join(TEST_DIR, relative), "utf-8");
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

describe("agentfile adopt", () => {
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
    cleanup();
  });

  function mixedRepository() {
    write("AGENTS.md", "# Rules\n\n- Use pnpm, never npm\n");
    write("CLAUDE.md", "# Claude\n\n- Run the tests before pushing\n");
    write(".github/copilot-instructions.md", "- Prefer composition over inheritance\n");
  }

  describe("planning", () => {
    it("writes nothing without --apply", async () => {
      mixedRepository();
      const before = read("CLAUDE.md");

      const output = captureOutput();
      await adoptCommand({ root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(read("CLAUDE.md")).toBe(before);
      expect(text).toContain("Nothing has been written");
    });

    it("names the source, what moves into it, and what becomes generated", async () => {
      mixedRepository();

      const output = captureOutput();
      await adoptCommand({ root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("AGENTS.md");
      expect(text).toContain("CLAUDE.md");
      expect(text).toContain(".github/copilot-instructions.md");
      expect(text).toContain("Consolidate into one source");
      expect(text).toContain("Generate the rest from it");
    });

    it("reports the surfaces it will not touch", async () => {
      mixedRepository();
      write(
        ".claude/skills/deploy/SKILL.md",
        "---\nname: deploy\ndescription: Deploys the service safely\n---\n\nSteps.\n",
      );

      const output = captureOutput();
      await adoptCommand({ root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("Left exactly as it is");
      expect(text).toContain("skills");
    });

    it("says so, and exits 1, when the source platform has no root file", async () => {
      mixedRepository();

      const output = captureOutput();
      await adoptCommand({ root: TEST_DIR, source: "cursor" });
      const text = output.text();
      output.restore();

      expect(text).toContain("AGF001");
      expect(exitCodes).toEqual([1]);
    });

    it("emits a machine-readable plan", async () => {
      mixedRepository();

      const output = captureOutput();
      await adoptCommand({ root: TEST_DIR, format: "json" });
      const parsed = JSON.parse(output.text());
      output.restore();

      expect(parsed.command).toBe("adopt");
      expect(parsed.applied).toBe(false);
      expect(parsed.source.file).toBe("AGENTS.md");
      expect(parsed.targets.map((entry: { target: string }) => entry.target)).toEqual(["claude", "copilot"]);
    });
  });

  describe("applying", () => {
    it("keeps every rule from every platform in the source", async () => {
      mixedRepository();

      const output = captureOutput();
      await adoptCommand({ root: TEST_DIR, apply: true, yes: true });
      output.restore();

      const source = read("AGENTS.md");
      expect(source).toContain("Use pnpm, never npm");
      expect(source).toContain("Run the tests before pushing");
      expect(source).toContain("Prefer composition over inheritance");
    });

    it("leaves the source hand-written, and marks only the generated files", async () => {
      mixedRepository();

      const output = captureOutput();
      await adoptCommand({ root: TEST_DIR, apply: true, yes: true });
      output.restore();

      expect(read("AGENTS.md")).not.toContain("generated by agentfile");
      expect(read("CLAUDE.md")).toContain("generated by agentfile");
      expect(read(".github/copilot-instructions.md")).toContain("generated by agentfile");
    });

    it("generates each target from the source alone, so nothing appears twice", async () => {
      mixedRepository();

      const output = captureOutput();
      await adoptCommand({ root: TEST_DIR, apply: true, yes: true });
      output.restore();

      const claude = read("CLAUDE.md");
      expect(claude.match(/Prefer composition over inheritance/g)).toHaveLength(1);
      expect(claude.match(/Run the tests before pushing/g)).toHaveLength(1);
    });

    it("records ownership so a later compile may update the generated files", async () => {
      mixedRepository();

      const output = captureOutput();
      await adoptCommand({ root: TEST_DIR, apply: true, yes: true });
      output.restore();

      const manifest = JSON.parse(read(".agentfile-manifest.json"));
      const owned = manifest.files.filter((file: { ownership: string }) => file.ownership === "owned");
      expect(owned.map((file: { path: string }) => file.path).sort()).toEqual([
        ".github/copilot-instructions.md",
        "CLAUDE.md",
      ]);
    });

    it("is idempotent: a second run finds nothing left to consolidate", async () => {
      mixedRepository();

      let output = captureOutput();
      await adoptCommand({ root: TEST_DIR, apply: true, yes: true });
      output.restore();
      const afterFirst = read("AGENTS.md");

      output = captureOutput();
      await adoptCommand({ root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(read("AGENTS.md")).toBe(afterFirst);
      expect(text).toContain("already the only source");
    });

    it("creates the source when the repository has none", async () => {
      write("CLAUDE.md", "- Run the tests before pushing\n");

      const output = captureOutput();
      await adoptCommand({ root: TEST_DIR, apply: true, yes: true });
      output.restore();

      expect(existsSync(join(TEST_DIR, "AGENTS.md"))).toBe(true);
      expect(read("AGENTS.md")).toContain("Run the tests before pushing");
    });

    it("never folds personal configuration into the committed source", async () => {
      write("AGENTS.md", "- Use pnpm\n");
      write("CLAUDE.local.md", "- My personal shortcut\n");

      const output = captureOutput();
      await adoptCommand({ root: TEST_DIR, apply: true, yes: true });
      output.restore();

      expect(read("AGENTS.md")).not.toContain("My personal shortcut");
      expect(read("CLAUDE.local.md")).toBe("- My personal shortcut\n");
    });
  });
});
