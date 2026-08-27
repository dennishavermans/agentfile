/// <reference types="node" />
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contextCommand } from "../src/commands/context.js";
import { explainCommand } from "../src/commands/explain.js";
import { EXIT_USAGE } from "../src/report.js";

const TEST_DIR = join(process.cwd(), "__test_observability__");

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

/** A repository whose rules disagree about scope, which is what makes this worth asking about. */
function seedRepository() {
  write("AGENTS.md", "# Team\n\n- Use pnpm as the package manager\n- Always validate input at the API boundary\n");
  write(
    ".cursor/rules/api.mdc",
    "---\nglobs: src/api/**\nalwaysApply: false\n---\n\nAlways validate input at the API boundary\n",
  );
  write(
    ".claude/skills/deploy/SKILL.md",
    "---\nname: deploy\ndescription: Deploy the service when a release is cut\n---\n\nRun it.\n",
  );
  write(".mcp.json", JSON.stringify({ mcpServers: { db: { command: "npx", args: ["-y", "server"] } } }));
  write("src/api/handler.ts", "export const handler = () => {};\n");
  write("apps/web/index.ts", "export const app = 1;\n");
}

describe("observability commands", () => {
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

  // ─── context ─────────────────────────────────────────────────────────────

  describe("context", () => {
    it("lists what applies, in load order, with the reason for each", async () => {
      seedRepository();

      const output = captureOutput();
      await contextCommand("src/api/handler.ts", { root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("AGENTS.md");
      expect(text).toContain(".cursor/rules/api.mdc");
      expect(text).toContain("matches src/api/**");
      // Most specific last: the glob-scoped rule comes after the unconditional one.
      expect(text.indexOf("AGENTS.md")).toBeLessThan(text.indexOf(".cursor/rules/api.mdc"));
    });

    it("leaves out configuration that does not apply to the path asked about", async () => {
      seedRepository();

      const output = captureOutput();
      await contextCommand("apps/web/index.ts", { root: TEST_DIR });
      const text = output.text();
      output.restore();

      const instructionsSection = text.slice(text.indexOf("Instructions"), text.indexOf("Rules ("));
      expect(instructionsSection).not.toContain(".cursor/rules/api.mdc");
    });

    it("says why something did not apply, with --excluded", async () => {
      seedRepository();

      const output = captureOutput();
      await contextCommand("apps/web/index.ts", { root: TEST_DIR, excluded: true });
      const text = output.text();
      output.restore();

      expect(text).toContain("Did not apply");
      expect(text).toContain("matches none of");
      expect(text).toContain("src/api/**");
    });

    it("mentions that exclusions exist without listing them by default", async () => {
      seedRepository();

      const output = captureOutput();
      await contextCommand("apps/web/index.ts", { root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("--excluded");
      expect(text).not.toContain("Did not apply");
    });

    it("separates the cost that loads always from the cost specific to the path", async () => {
      seedRepository();

      const output = captureOutput();
      await contextCommand("src/api/handler.ts", { root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("loads in every session");
      expect(text).toContain("specific to this path");
      expect(text).toContain("(estimated)");
    });

    it("reports repository-wide configuration separately from path-scoped configuration", async () => {
      seedRepository();

      const output = captureOutput();
      await contextCommand("src/api/handler.ts", { root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("Repository-wide");
      expect(text).toContain("MCP server");
      expect(text).toContain("no verified platform scopes these by path");
    });

    it("says so plainly when the repository configures nothing", async () => {
      const output = captureOutput();
      await contextCommand("src/index.ts", { root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("No agent configuration found");
    });

    it("emits machine-readable JSON with provenance on every entry", async () => {
      seedRepository();

      const output = captureOutput();
      await contextCommand("src/api/handler.ts", { root: TEST_DIR, format: "json" });
      const text = output.text();
      output.restore();

      const parsed = JSON.parse(text);
      expect(parsed.command).toBe("context");
      expect(parsed.path).toBe("src/api/handler.ts");
      expect(parsed.instructions.length).toBeGreaterThan(1);
      for (const entry of parsed.instructions) {
        expect(entry.file).toBeTruthy();
        expect(entry.platform).toBeTruthy();
        expect(entry.reason.kind).toBeTruthy();
      }
      expect(parsed.estimate.method).toBe("characters-per-token-heuristic");
    });

    it("rejects an unknown format instead of guessing", async () => {
      const output = captureOutput();
      await contextCommand("src/index.ts", { root: TEST_DIR, format: "xml" });
      const text = output.text();
      output.restore();

      expect(text).toContain("Unknown format");
      expect(exitCodes).toEqual([EXIT_USAGE]);
    });

    it("changes nothing on disk", async () => {
      seedRepository();

      const output = captureOutput();
      await contextCommand("src/api/handler.ts", { root: TEST_DIR });
      output.restore();

      expect(existsSync(join(TEST_DIR, ".agentfile-manifest.json"))).toBe(false);
      expect(existsSync(join(TEST_DIR, "CLAUDE.md"))).toBe(false);
    });
  });

  // ─── explain ─────────────────────────────────────────────────────────────

  describe("explain", () => {
    it("explains a configuration file: where it comes from and when it applies", async () => {
      seedRepository();

      const output = captureOutput();
      await explainCommand(".cursor/rules/api.mdc", { root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("Declared in");
      expect(text).toContain(".cursor/rules/api.mdc");
      expect(text).toContain("cursor");
      expect(text).toContain("src/api/**");
    });

    it("answers whether it applies at a specific path, and why", async () => {
      seedRepository();

      const output = captureOutput();
      await explainCommand(".cursor/rules/api.mdc", { root: TEST_DIR, at: "src/api/handler.ts" });
      const text = output.text();
      output.restore();

      expect(text).toContain("At src/api/handler.ts: applies");
      expect(text).toContain("matches src/api/**");
    });

    it("answers why it does not apply, which is the harder question", async () => {
      seedRepository();

      const output = captureOutput();
      await explainCommand(".cursor/rules/api.mdc", { root: TEST_DIR, at: "apps/web/index.ts" });
      const text = output.text();
      output.restore();

      expect(text).toContain("does not apply");
      expect(text).toContain("matches none of");
    });

    it("names what outranks it at that path", async () => {
      seedRepository();

      const output = captureOutput();
      await explainCommand("AGENTS.md", { root: TEST_DIR, at: "src/api/handler.ts" });
      const text = output.text();
      output.restore();

      expect(text).toContain("win a disagreement");
      expect(text).toContain(".cursor/rules/api.mdc");
    });

    it("explains a skill by name", async () => {
      seedRepository();

      const output = captureOutput();
      await explainCommand("deploy", { root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("skill");
      expect(text).toContain(".claude/skills/deploy/SKILL.md");
      expect(text).toContain("agent decides");
    });

    it("points at the other files declaring the same thing", async () => {
      seedRepository();

      const output = captureOutput();
      await explainCommand("AGENTS.md", { root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("also declared in");
      expect(text).toContain(".cursor/rules/api.mdc");
    });

    it("lists the candidates compactly when a query is too broad to answer", async () => {
      write(
        "AGENTS.md",
        `# Rules\n\n${Array.from({ length: 8 }, (_, i) => `- Rule ${i} about the api layer`).join("\n")}\n`,
      );

      const output = captureOutput();
      await explainCommand("api", { root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("matches");
      expect(text).toContain("Narrow it with");
    });

    it("fails with guidance when nothing matches", async () => {
      seedRepository();

      const output = captureOutput();
      await explainCommand("nothing like this exists", { root: TEST_DIR });
      const text = output.text();
      output.restore();

      expect(text).toContain("Nothing in this repository");
      expect(text).toContain("agentfile doctor");
      expect(exitCodes).toEqual([1]);
    });

    it("rejects an unknown kind rather than silently ignoring it", async () => {
      const output = captureOutput();
      await explainCommand("deploy", { root: TEST_DIR, kind: "widget" });
      const text = output.text();
      output.restore();

      expect(text).toContain("Unknown kind");
      expect(exitCodes).toEqual([EXIT_USAGE]);
    });

    it("emits machine-readable JSON", async () => {
      seedRepository();

      const output = captureOutput();
      await explainCommand("deploy", { root: TEST_DIR, format: "json", at: "src/api/handler.ts" });
      const text = output.text();
      output.restore();

      const parsed = JSON.parse(text);
      expect(parsed.command).toBe("explain");
      expect(parsed.matches).toHaveLength(1);
      expect(parsed.matches[0].target.kind).toBe("skill");
      expect(parsed.matches[0].at.applies).toBe(true);
    });
  });
});
