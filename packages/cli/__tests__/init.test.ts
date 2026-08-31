/// <reference types="node" />
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
// At file scope rather than inside each test: a dynamic import in the first
// test body charges that test's 5s timeout for the whole cold transform of
// the module graph. vi.mock is hoisted, so the mocks still apply.
import { validateContract } from "@agentfile/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initCommand } from "../src/commands/init.js";

// ─── Test Directory ────────────────────────────────────────────────────────

const TEST_DIR = join(process.cwd(), "__test_project__");

function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

function readFile(relative: string): string {
  return readFileSync(join(TEST_DIR, relative), "utf-8");
}

function fileExists(relative: string): boolean {
  return existsSync(join(TEST_DIR, relative));
}

// ─── Mock Enquirer ─────────────────────────────────────────────────────────

vi.mock("enquirer", () => ({
  default: class MockEnquirer {
    async prompt() {
      return {
        name: "Test App",
        stack: ["typescript", "react"],
        agents: ["claude", "cursor"],
      };
    }
  },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("init command", () => {
  beforeEach(() => {
    cleanup();
    // Run init inside the test directory by temporarily changing cwd
    vi.spyOn(process, "cwd").mockReturnValue(TEST_DIR);
    require("node:fs").mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("creates ai/contract.yaml with correct project name and stack", async () => {
    await initCommand();

    expect(fileExists("ai/contract.yaml")).toBe(true);
    const contract = readFile("ai/contract.yaml");
    expect(contract).toContain("name: Test App");
    expect(contract).toContain("- typescript");
    expect(contract).toContain("- react");
  });

  it("creates agent config and template for each default agent", async () => {
    await initCommand();

    for (const agent of ["claude", "copilot", "cursor"]) {
      expect(fileExists(`ai/agents/${agent}/config.yaml`)).toBe(true);
      expect(fileExists(`ai/agents/${agent}/template.md`)).toBe(true);
    }
  });

  it("creates .ai-agents with the selected agents", async () => {
    await initCommand();

    expect(fileExists(".ai-agents")).toBe(true);
    const agents = readFile(".ai-agents");
    expect(agents).toContain("claude");
    expect(agents).toContain("cursor");
  });

  it("creates .ai-agents.example", async () => {
    await initCommand();

    expect(fileExists(".ai-agents.example")).toBe(true);
  });

  it("creates CI workflow file", async () => {
    await initCommand();

    expect(fileExists(".github/workflows/ai-contract.yml")).toBe(true);
    const workflow = readFile(".github/workflows/ai-contract.yml");
    expect(workflow).toContain("npx agentfile validate");
    expect(workflow).toContain("npx agentfile sync --dry-run");
  });

  it("does not overwrite existing files on re-run", async () => {
    await initCommand();

    // Mutate the contract file
    const contractPath = join(TEST_DIR, "ai/contract.yaml");
    require("node:fs").writeFileSync(contractPath, "version: 1\n# custom content", "utf-8");

    // Run init again
    await initCommand();

    // Should not have been overwritten
    expect(readFile("ai/contract.yaml")).toContain("# custom content");
  });

  it("generated contract.yaml passes core schema validation", async () => {
    await initCommand();

    const contractPath = join(TEST_DIR, "ai", "contract.yaml");

    expect(() => validateContract({ contractPath })).not.toThrow();
  });
});
