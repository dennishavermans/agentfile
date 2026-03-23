/// <reference types="node" />
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test Directory ────────────────────────────────────────────────────────

const TEST_DIR = join(process.cwd(), "__test_migrate__");

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
}

function writeFixture(name: string, content: string): string {
  const filePath = join(TEST_DIR, name);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function readResult(relative: string): string {
  return readFileSync(join(TEST_DIR, relative), "utf-8");
}

// ─── Fixture Content ───────────────────────────────────────────────────────

const CLAUDE_MD = `# Project Instructions

**Project:** Billit App
**Stack:** TypeScript, React Native, Expo

---

## Coding Rules

- Use strict TypeScript types
- Prefer const over let
- No class components

## Architecture

- Follow feature-based folder structure
- Avoid cross-feature imports
- Use Query Factory pattern for TanStack Query

## Testing

- Write tests with React Native Testing Library
- Use testID for element queries
- Co-locate test files next to source

## Naming

- Use kebab-case for feature folders
- PascalCase for components
- Screen suffix for screens

## Skills

### implement-feature-component

A complete feature component following the project conventions.

**Steps:**
1. Create the component file in the correct feature folder
2. Add TypeScript types for all props
3. Implement the component with accessibility attributes
4. Write a co-located test file

**Expected output:** A typed React Native component with tests.
`;

const COPILOT_MD = `# Copilot Instructions

This file configures GitHub Copilot for **Billit App**.
Stack: TypeScript, React Native, Expo

## Coding

- Use strict TypeScript types
- Always handle loading and error states
- React Compiler handles memoization automatically

## Architecture

- Follow feature-based folder structure
- Avoid cross-feature imports

## Testing

- Write tests with React Native Testing Library
- Use testID for element queries

## Naming

- Use kebab-case for feature folders
- PascalCase for components

## Skills

### implement-screen

A full screen implementation with navigation integration.

**Steps:**
1. Create a screen file in app/ or features/ as appropriate
2. Implement the screen with TanStack Query data fetching
3. Add Expo Router navigation props

**Expected output:** A navigable screen with data fetching and tests.
`;

// ─── Mock Enquirer (no prompts expected in fully auto-detected runs) ────────

vi.mock("enquirer", () => ({
  default: class MockEnquirer {
    async prompt(questions: { name: string }[]) {
      const answers: Record<string, unknown> = {};
      for (const q of questions) {
        if (q.name === "name") answers["name"] = "Prompted Project";
        if (q.name === "stack") answers["stack"] = ["typescript"];
        if (q.name === "overwrite") answers["overwrite"] = true;
      }
      return answers;
    }
  },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("parseAgentFile", () => {
  beforeEach(() => {
    cleanup();
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(cleanup);

  it("extracts project name and stack from metadata lines", async () => {
    const path = writeFixture("CLAUDE.md", CLAUDE_MD);
    const { parseAgentFile } = await import("../src/commands/migrate.js");

    const result = parseAgentFile(path);
    expect(result.projectName).toBe("Billit App");
    expect(result.stack).toEqual(["TypeScript", "React Native", "Expo"]);
  });

  it("extracts coding rules from matching heading", async () => {
    const path = writeFixture("CLAUDE.md", CLAUDE_MD);
    const { parseAgentFile } = await import("../src/commands/migrate.js");

    const result = parseAgentFile(path);
    expect(result.rules.coding).toContain("Use strict TypeScript types");
    expect(result.rules.coding).toContain("Prefer const over let");
    expect(result.rules.coding).toContain("No class components");
  });

  it("extracts architecture rules", async () => {
    const path = writeFixture("CLAUDE.md", CLAUDE_MD);
    const { parseAgentFile } = await import("../src/commands/migrate.js");

    const result = parseAgentFile(path);
    expect(result.rules.architecture).toContain(
      "Follow feature-based folder structure",
    );
    expect(result.rules.architecture).toContain("Avoid cross-feature imports");
  });

  it("extracts testing rules", async () => {
    const path = writeFixture("CLAUDE.md", CLAUDE_MD);
    const { parseAgentFile } = await import("../src/commands/migrate.js");

    const result = parseAgentFile(path);
    expect(result.rules.testing).toContain(
      "Write tests with React Native Testing Library",
    );
    expect(result.rules.testing).toContain("Use testID for element queries");
  });

  it("extracts naming rules", async () => {
    const path = writeFixture("CLAUDE.md", CLAUDE_MD);
    const { parseAgentFile } = await import("../src/commands/migrate.js");

    const result = parseAgentFile(path);
    expect(result.rules.naming).toContain("Use kebab-case for feature folders");
    expect(result.rules.naming).toContain("PascalCase for components");
  });

  it("extracts skills from a Skills container section", async () => {
    const path = writeFixture("CLAUDE.md", CLAUDE_MD);
    const { parseAgentFile } = await import("../src/commands/migrate.js");

    const result = parseAgentFile(path);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe("implement-feature-component");
  });

  it("extracts skill description", async () => {
    const path = writeFixture("CLAUDE.md", CLAUDE_MD);
    const { parseAgentFile } = await import("../src/commands/migrate.js");

    const result = parseAgentFile(path);
    expect(result.skills[0].description).toContain("feature component");
  });

  it("extracts skill steps from numbered list under **Steps:**", async () => {
    const path = writeFixture("CLAUDE.md", CLAUDE_MD);
    const { parseAgentFile } = await import("../src/commands/migrate.js");

    const result = parseAgentFile(path);
    const steps = result.skills[0].steps;
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps[0]).toMatch(/component file/i);
  });

  it("extracts expected output", async () => {
    const path = writeFixture("CLAUDE.md", CLAUDE_MD);
    const { parseAgentFile } = await import("../src/commands/migrate.js");

    const result = parseAgentFile(path);
    expect(result.skills[0].expected_output).toContain(
      "React Native component",
    );
  });

  it("handles a file with no recognizable project metadata without crashing", async () => {
    const minimal = `# My Rules\n\n## Coding Rules\n\n- Use semicolons\n`;
    const path = writeFixture("minimal.md", minimal);
    const { parseAgentFile } = await import("../src/commands/migrate.js");

    const result = parseAgentFile(path);
    expect(result.projectName).toBeUndefined();
    expect(result.stack).toBeUndefined();
    expect(result.rules.coding).toContain("Use semicolons");
  });
});

describe("mergeFiles", () => {
  beforeEach(() => {
    cleanup();
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(cleanup);

  it("deduplicates identical rules across files", async () => {
    const p1 = writeFixture("A.md", CLAUDE_MD);
    const p2 = writeFixture("B.md", COPILOT_MD);
    const { parseAgentFile, mergeFiles } =
      await import("../src/commands/migrate.js");

    const merged = mergeFiles([parseAgentFile(p1), parseAgentFile(p2)]);

    // "Follow feature-based folder structure" appears in both
    const architectureMatches = merged.rules.architecture.filter(
      (r) => r === "Follow feature-based folder structure",
    );
    expect(architectureMatches).toHaveLength(1);
  });

  it("includes unique rules from both files", async () => {
    const p1 = writeFixture("A.md", CLAUDE_MD);
    const p2 = writeFixture("B.md", COPILOT_MD);
    const { parseAgentFile, mergeFiles } =
      await import("../src/commands/migrate.js");

    const merged = mergeFiles([parseAgentFile(p1), parseAgentFile(p2)]);

    expect(merged.rules.coding).toContain("Prefer const over let"); // from CLAUDE
    expect(merged.rules.coding).toContain(
      "React Compiler handles memoization automatically",
    ); // from COPILOT
  });

  it("merges skills from multiple files by name", async () => {
    const p1 = writeFixture("A.md", CLAUDE_MD);
    const p2 = writeFixture("B.md", COPILOT_MD);
    const { parseAgentFile, mergeFiles } =
      await import("../src/commands/migrate.js");

    const merged = mergeFiles([parseAgentFile(p1), parseAgentFile(p2)]);

    const skillNames = merged.skills.map((s) => s.name);
    expect(skillNames).toContain("implement-feature-component");
    expect(skillNames).toContain("implement-screen");
  });

  it("does not duplicate skills with the same name", async () => {
    // Both files have the same skill name
    const dup = CLAUDE_MD;
    const p1 = writeFixture("A.md", dup);
    const p2 = writeFixture("B.md", dup);
    const { parseAgentFile, mergeFiles } =
      await import("../src/commands/migrate.js");

    const merged = mergeFiles([parseAgentFile(p1), parseAgentFile(p2)]);

    const count = merged.skills.filter(
      (s) => s.name === "implement-feature-component",
    ).length;
    expect(count).toBe(1);
  });

  it("records a conflict when the same skill has different descriptions", async () => {
    const alt = CLAUDE_MD.replace(
      "A complete feature component following the project conventions.",
      "DIFFERENT DESCRIPTION",
    );
    const p1 = writeFixture("A.md", CLAUDE_MD);
    const p2 = writeFixture("B.md", alt);
    const { parseAgentFile, mergeFiles } =
      await import("../src/commands/migrate.js");

    const merged = mergeFiles([parseAgentFile(p1), parseAgentFile(p2)]);

    expect(merged.conflicts.length).toBeGreaterThan(0);
    expect(merged.conflicts[0]).toContain("implement-feature-component");
  });
});

describe("migrateCommand", () => {
  beforeEach(() => {
    cleanup();
    mkdirSync(TEST_DIR, { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(TEST_DIR);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("writes ai/contract.yaml from a single source file", async () => {
    const src = writeFixture("CLAUDE.md", CLAUDE_MD);
    const { migrateCommand } = await import("../src/commands/migrate.js");

    await migrateCommand({ from: [src] });

    expect(existsSync(join(TEST_DIR, "ai", "contract.yaml"))).toBe(true);
  });

  it("generated contract.yaml contains extracted rules", async () => {
    const src = writeFixture("CLAUDE.md", CLAUDE_MD);
    const { migrateCommand } = await import("../src/commands/migrate.js");

    await migrateCommand({ from: [src] });

    const content = readResult("ai/contract.yaml");
    expect(content).toContain("Use strict TypeScript types");
    expect(content).toContain("Follow feature-based folder structure");
    expect(content).toContain("Write tests with React Native Testing Library");
    expect(content).toContain("Use kebab-case for feature folders");
  });

  it("generated contract.yaml contains extracted skills", async () => {
    const src = writeFixture("CLAUDE.md", CLAUDE_MD);
    const { migrateCommand } = await import("../src/commands/migrate.js");

    await migrateCommand({ from: [src] });

    const content = readResult("ai/contract.yaml");
    expect(content).toContain("implement-feature-component");
  });

  it("generated contract.yaml passes core schema validation", async () => {
    const src = writeFixture("CLAUDE.md", CLAUDE_MD);
    const { migrateCommand } = await import("../src/commands/migrate.js");

    await migrateCommand({ from: [src] });

    const { validateContract } = await import("@agentfile/core");
    const contractPath = join(TEST_DIR, "ai", "contract.yaml");
    expect(() => validateContract({ contractPath })).not.toThrow();
  });

  it("dry-run does not write any files", async () => {
    const src = writeFixture("CLAUDE.md", CLAUDE_MD);
    const { migrateCommand } = await import("../src/commands/migrate.js");

    await migrateCommand({ from: [src], dryRun: true });

    expect(existsSync(join(TEST_DIR, "ai", "contract.yaml"))).toBe(false);
  });

  it("writes to a custom --output path", async () => {
    const src = writeFixture("CLAUDE.md", CLAUDE_MD);
    const outputPath = join(TEST_DIR, "custom", "output.yaml");
    const { migrateCommand } = await import("../src/commands/migrate.js");

    await migrateCommand({ from: [src], output: outputPath });

    expect(existsSync(outputPath)).toBe(true);
  });

  it("merges rules from multiple --from files", async () => {
    const p1 = writeFixture("A.md", CLAUDE_MD);
    const p2 = writeFixture("B.md", COPILOT_MD);
    const { migrateCommand } = await import("../src/commands/migrate.js");

    await migrateCommand({ from: [p1, p2] });

    const content = readResult("ai/contract.yaml");
    expect(content).toContain("Prefer const over let");
    expect(content).toContain(
      "React Compiler handles memoization automatically",
    );
  });

  it("exits with an error when a --from file does not exist", async () => {
    const { migrateCommand } = await import("../src/commands/migrate.js");

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as never);

    await migrateCommand({ from: ["/nonexistent/file.md"] });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with an error when no --from files are provided", async () => {
    const { migrateCommand } = await import("../src/commands/migrate.js");

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as never);

    await migrateCommand({ from: [] });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ─── Target / Exclude Filtering ────────────────────────────────────────────

describe("migrate --targets / --exclude", () => {
  beforeEach(() => {
    cleanup();
    vi.spyOn(process, "cwd").mockReturnValue(TEST_DIR);
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("filters sources by --targets", async () => {
    // .github path → detected as copilot
    mkdirSync(join(TEST_DIR, ".github"), { recursive: true });
    const copilotFile = writeFixture(
      ".github/copilot-instructions.md",
      COPILOT_MD,
    );
    // .claude path → detected as claude
    mkdirSync(join(TEST_DIR, ".claude"), { recursive: true });
    const claudeFile = writeFixture(".claude/CLAUDE.md", CLAUDE_MD);

    const { migrateCommand } = await import("../src/commands/migrate.js");

    await migrateCommand({
      from: [copilotFile, claudeFile],
      targets: ["copilot"],
    });

    const content = readResult("ai/contract.yaml");
    // Copilot-only rule should be present
    expect(content).toContain(
      "React Compiler handles memoization automatically",
    );
    // Claude-only rule (not in copilot) should be absent
    expect(content).not.toContain("No class components");
  });

  it("filters sources by --exclude", async () => {
    mkdirSync(join(TEST_DIR, ".github"), { recursive: true });
    const copilotFile = writeFixture(
      ".github/copilot-instructions.md",
      COPILOT_MD,
    );
    mkdirSync(join(TEST_DIR, ".claude"), { recursive: true });
    const claudeFile = writeFixture(".claude/CLAUDE.md", CLAUDE_MD);

    const { migrateCommand } = await import("../src/commands/migrate.js");

    await migrateCommand({
      from: [copilotFile, claudeFile],
      exclude: ["copilot"],
    });

    const content = readResult("ai/contract.yaml");
    // Claude-only rule should be present
    expect(content).toContain("No class components");
    // Copilot-only rule should be absent
    expect(content).not.toContain(
      "React Compiler handles memoization automatically",
    );
  });

  it("exits when all sources are filtered out", async () => {
    mkdirSync(join(TEST_DIR, ".github"), { recursive: true });
    const copilotFile = writeFixture(
      ".github/copilot-instructions.md",
      COPILOT_MD,
    );

    const { migrateCommand } = await import("../src/commands/migrate.js");
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as never);

    await migrateCommand({
      from: [copilotFile],
      targets: ["claude"],
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ─── Replace Policy ────────────────────────────────────────────────────────

describe("migrate --replace-policy", () => {
  beforeEach(() => {
    cleanup();
    vi.spyOn(process, "cwd").mockReturnValue(TEST_DIR);
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("keeps source files with replace-policy keep (default)", async () => {
    const file = writeFixture("instructions.md", CLAUDE_MD);
    const { migrateCommand } = await import("../src/commands/migrate.js");

    await migrateCommand({ from: [file], replacePolicy: "keep" });

    expect(existsSync(file)).toBe(true);
  });

  it("deletes source files with replace-policy delete", async () => {
    const file = writeFixture("instructions.md", CLAUDE_MD);
    const { migrateCommand } = await import("../src/commands/migrate.js");

    await migrateCommand({ from: [file], replacePolicy: "delete" });

    expect(existsSync(file)).toBe(false);
  });

  it("archives source files with replace-policy archive", async () => {
    const file = writeFixture("instructions.md", CLAUDE_MD);
    const { migrateCommand } = await import("../src/commands/migrate.js");

    await migrateCommand({ from: [file], replacePolicy: "archive" });

    // Original file should be gone
    expect(existsSync(file)).toBe(false);
    // Should exist somewhere in the backup dir
    const backupDir = join(TEST_DIR, ".agentfile-backup");
    expect(existsSync(backupDir)).toBe(true);
  });

  it("creates a backup before writing with replace-policy delete", async () => {
    const file = writeFixture("instructions.md", CLAUDE_MD);
    const { migrateCommand } = await import("../src/commands/migrate.js");

    await migrateCommand({ from: [file], replacePolicy: "delete" });

    // Backup directory should exist with the source content
    const backupDir = join(TEST_DIR, ".agentfile-backup");
    expect(existsSync(backupDir)).toBe(true);
  });
});
