/// <reference types="node" />
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkCommand } from "../src/commands/check.js";
import { lintCommand } from "../src/commands/lint.js";
import { validateCommand } from "../src/commands/validate.js";

const TEST_DIR = join(process.cwd(), "__test_validation__");

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

/** A valid v1 contract, so the backward-compatible path can be exercised. */
const CONTRACT = `version: 1
project:
  name: Checkout Service
  stack:
    - typescript
rules:
  coding:
    - Use pnpm as the package manager
skills:
  - name: add-endpoint
    description: Add an HTTP endpoint
    steps:
      - Implement the handler
`;

describe("validation commands", () => {
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

  // ─── check ───────────────────────────────────────────────────────────────

  describe("check", () => {
    it("finds a duplicate rule maintained for two platforms", async () => {
      write("AGENTS.md", "- Use pnpm as the package manager, never npm\n");
      write(".github/copilot-instructions.md", "- Use pnpm as the package manager, never npm\n");

      const output = captureOutput();
      await checkCommand({ root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("AGF302");
      expect(exitCodes).toEqual([]);
    });

    it("does not run the quality layer, which belongs to lint", async () => {
      write("AGENTS.md", "- Use pnpm as the package manager, never npm or yarn\n");
      write(".github/copilot-instructions.md", "- Use pnpm as the package manager, never npm\n");

      const output = captureOutput();
      await checkCommand({ root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).not.toContain("AGF305");
    });

    it("exits non-zero on an error so a pre-commit hook can gate on it", async () => {
      write(".mcp.json", JSON.stringify({ mcpServers: { broken: { url: "https://example.com" } } }));

      const output = captureOutput();
      await checkCommand({ root: TEST_DIR });
      output.restore();

      expect(exitCodes).toEqual([1]);
    });

    it("fails on a warning under --strict", async () => {
      write("AGENTS.md", "- Use pnpm as the package manager, never npm\n");
      write("CLAUDE.md", "- Use pnpm as the package manager, never npm\n");

      const output = captureOutput();
      await checkCommand({ root: TEST_DIR, strict: true });
      const text = output.text();
      output.restore();

      expect(exitCodes).toEqual([1]);
      expect(text).toContain("promoted by --strict");
    });

    it("says so plainly when there is nothing to check", async () => {
      const output = captureOutput();
      await checkCommand({ root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("No agent configuration found");
      expect(exitCodes).toEqual([]);
    });

    it("emits machine-readable JSON in the shared report envelope", async () => {
      write("AGENTS.md", "- Use pnpm as the package manager, never npm\n");
      write("CLAUDE.md", "- Use pnpm as the package manager, never npm\n");

      const output = captureOutput();
      await checkCommand({ root: TEST_DIR, format: "json" });
      const text = output.text();
      output.restore();

      const parsed = JSON.parse(text);
      expect(parsed.command).toBe("check");
      expect(parsed.report.version).toBe(1);
      expect(parsed.rulesRun).toContain("duplicate-instructions");
      expect(parsed.layers).toEqual(["structural", "resolution"]);
    });

    it("rejects an unknown format instead of guessing", async () => {
      const output = captureOutput();
      await checkCommand({ root: TEST_DIR, format: "xml" });
      const text = output.text();
      output.restore();

      expect(text).toContain("Unknown format");
      expect(exitCodes).toEqual([1]);
    });

    it("changes nothing on disk", async () => {
      write("AGENTS.md", "- Use pnpm as the package manager\n");

      const output = captureOutput();
      await checkCommand({ root: TEST_DIR });
      output.restore();

      expect(existsSync(join(TEST_DIR, ".agentfile-manifest.json"))).toBe(false);
      expect(existsSync(join(TEST_DIR, "CLAUDE.md"))).toBe(false);
    });
  });

  // ─── lint ────────────────────────────────────────────────────────────────

  describe("lint", () => {
    it("finds a copy that has drifted from the original", async () => {
      write("AGENTS.md", "- Use pnpm as the package manager, never npm or yarn\n");
      write(".github/copilot-instructions.md", "Use pnpm as the package manager, never npm.\n");

      const output = captureOutput();
      await lintCommand({ root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("AGF305");
      expect(text).toContain("similar");
    });

    it("states that similarity is measured on words, not meaning", async () => {
      write("AGENTS.md", "- Use pnpm as the package manager\n");

      const output = captureOutput();
      await lintCommand({ root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("not meaning");
      expect(text).toContain("not a platform limit");
    });

    it("reports always-loaded context over a supplied budget", async () => {
      write("AGENTS.md", `# Rules\n\n${"- Keep every function small and focused\n".repeat(20)}`);

      const output = captureOutput();
      await lintCommand({ root: TEST_DIR, budget: "10" });
      const text = output.text();
      output.restore();

      expect(text).toContain("AGF401");
    });

    it("rejects a nonsensical budget rather than defaulting past it", async () => {
      const output = captureOutput();
      await lintCommand({ root: TEST_DIR, budget: "-5" });
      const text = output.text();
      output.restore();

      expect(text).toContain("Invalid --budget");
      expect(exitCodes).toEqual([1]);
    });

    it("rejects a similarity threshold outside 0 to 1", async () => {
      const output = captureOutput();
      await lintCommand({ root: TEST_DIR, similarity: "5" });
      const text = output.text();
      output.restore();

      expect(text).toContain("Invalid --similarity");
      expect(exitCodes).toEqual([1]);
    });

    it("records the thresholds it used in JSON output", async () => {
      write("AGENTS.md", "- Use pnpm as the package manager\n");

      const output = captureOutput();
      await lintCommand({ root: TEST_DIR, format: "json", budget: "1234", similarity: "0.75" });
      const text = output.text();
      output.restore();

      const parsed = JSON.parse(text);
      expect(parsed.budgetTokens).toBe(1234);
      expect(parsed.similarityThreshold).toBe(0.75);
    });
  });

  // ─── validate ────────────────────────────────────────────────────────────

  describe("validate", () => {
    it("keeps the v1 contract output word for word", async () => {
      write("ai/contract.yaml", CONTRACT);

      const output = captureOutput();
      await validateCommand({ root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("contract.yaml is valid (version 1)");
      expect(text).toContain("Project: Checkout Service");
      expect(text).toContain("Stack:   typescript");
      expect(text).toContain("Rules:   1 total across 4 categories");
      expect(exitCodes).toEqual([]);
    });

    it("still fails immediately on a contract that does not satisfy its schema", async () => {
      write("ai/contract.yaml", 'version: 1\nproject:\n  name: ""\n  stack: []\n');

      const output = captureOutput();
      await validateCommand({ root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("Validation failed");
      expect(exitCodes).toEqual([1]);
    });

    it("validates a repository that has no contract at all", async () => {
      write("AGENTS.md", "- Use pnpm as the package manager, never npm\n");
      write("CLAUDE.md", "- Use pnpm as the package manager, never npm\n");

      const output = captureOutput();
      await validateCommand({ root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("AGF302");
      expect(exitCodes).toEqual([]);
    });

    it("fails when there is no configuration of any kind", async () => {
      const output = captureOutput();
      await validateCommand({ root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("No agent configuration found");
      expect(exitCodes).toEqual([1]);
    });

    it("reports that compatibility was not checked when no target was named", async () => {
      write("AGENTS.md", "- Use pnpm as the package manager\n");

      const output = captureOutput();
      await validateCommand({ root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("Not checked");
      expect(text).toContain("target-compatibility");
    });

    it("checks a named target and fails on a feature it cannot express", async () => {
      write(
        ".claude/skills/deploy/SKILL.md",
        "---\nname: deploy\ndescription: Deploy when a release is cut\n---\n\nRun it.\n",
      );

      const output = captureOutput();
      await validateCommand({ root: TEST_DIR, target: ["agents-md"] });
      const text = output.text();
      output.restore();

      expect(text).toContain("AGF201");
      expect(text).toContain("agents-md");
      expect(exitCodes).toEqual([1]);
    });

    it("expands --target all to every known target", async () => {
      write("AGENTS.md", "- Use pnpm as the package manager\n");

      const output = captureOutput();
      await validateCommand({ root: TEST_DIR, target: ["all"], format: "json" });
      const text = output.text();
      output.restore();

      const parsed = JSON.parse(text);
      expect(parsed.targets).toContain("claude");
      expect(parsed.targets).toContain("cursor");
      expect(parsed.targets.length).toBeGreaterThan(2);
    });

    it("rejects an unknown target rather than quietly checking nothing", async () => {
      write("AGENTS.md", "- Use pnpm as the package manager\n");

      const output = captureOutput();
      await validateCommand({ root: TEST_DIR, target: ["claud"] });
      const text = output.text();
      output.restore();

      expect(text).toContain("Unknown target");
      expect(exitCodes).toEqual([1]);
    });

    it("lists the rule set with its layers and codes", async () => {
      const output = captureOutput();
      await validateCommand({ listRules: true });
      const text = output.text();
      output.restore();

      expect(text).toContain("configuration-integrity");
      expect(text).toContain("AGF001");
      expect(text).toContain("target-compatibility");
      expect(text).toContain("compatibility");
    });

    it("prints the title once, not once per section", async () => {
      write("AGENTS.md", "- Use pnpm as the package manager\n");

      const output = captureOutput();
      await validateCommand({ root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text.match(/agentfile validate/g)).toHaveLength(1);
    });
  });
});
