import { describe, expect, it } from "vitest";
import { planAdoption } from "../src/adopt/index.ts";
import { discover } from "../src/discovery/index.ts";
import { memoryFileSystem } from "../src/fs/index.ts";

const ROOT = "/repo";

function planFor(files: Record<string, string>, sourcePlatform?: string) {
  const fs = memoryFileSystem(files);
  const { configuration } = discover({ root: ROOT, fs });
  return planAdoption(configuration, { root: ROOT, fs, sourcePlatform });
}

describe("planAdoption", () => {
  it("consolidates into AGENTS.md by default", () => {
    const plan = planFor({
      "/repo/AGENTS.md": "# Rules\n\n- Use pnpm, never npm\n",
      "/repo/CLAUDE.md": "# Claude\n\n- Run the tests before pushing\n",
    });

    expect(plan.source?.file).toBe("AGENTS.md");
    expect(plan.source?.created).toBe(false);
    expect(plan.targets.map((entry) => entry.target)).toEqual(["claude"]);
  });

  it("never lists the source platform as a target to generate", () => {
    const plan = planFor({
      "/repo/AGENTS.md": "- Use pnpm\n",
      "/repo/CLAUDE.md": "- Run tests\n",
      "/repo/.github/copilot-instructions.md": "- Prefer composition\n",
    });

    expect(plan.targets.map((entry) => entry.target)).not.toContain("agents-md");
    expect(plan.targets.map((entry) => entry.target)).toEqual(["claude", "copilot"]);
  });

  it("keeps every rule, from every platform, in the consolidated source", () => {
    const plan = planFor({
      "/repo/AGENTS.md": "- Use pnpm, never npm\n",
      "/repo/CLAUDE.md": "- Run the tests before pushing\n",
      "/repo/.github/copilot-instructions.md": "- Prefer composition over inheritance\n",
    });

    const content = plan.source?.content ?? "";
    expect(content).toContain("Use pnpm, never npm");
    expect(content).toContain("Run the tests before pushing");
    expect(content).toContain("Prefer composition over inheritance");
  });

  it("keeps the source's own text first and unchanged", () => {
    const plan = planFor({
      "/repo/AGENTS.md": "# Project rules\n\n- Use pnpm, never npm\n",
      "/repo/CLAUDE.md": "- Run the tests before pushing\n",
    });

    expect(plan.source?.content.startsWith("# Project rules")).toBe(true);
    expect(plan.source?.existing).toContain("Use pnpm, never npm");
  });

  it("skips a file the source already says everything from, rather than duplicating it", () => {
    const duplicated = "- Use pnpm as the package manager, never npm\n";
    const plan = planFor({
      "/repo/AGENTS.md": duplicated,
      "/repo/CLAUDE.md": duplicated,
    });

    expect(plan.source?.appended).toHaveLength(0);
    expect(plan.source?.alreadyCovered.map((entry) => entry.file)).toEqual(["CLAUDE.md"]);
    expect(plan.source?.content.match(/never npm/g)).toHaveLength(1);
  });

  it("appends a file that adds even one new rule, whole", () => {
    const plan = planFor({
      "/repo/AGENTS.md": "- Use pnpm as the package manager, never npm\n",
      "/repo/CLAUDE.md": "- Use pnpm as the package manager, never npm\n- Run the tests before pushing\n",
    });

    expect(plan.source?.appended.map((entry) => entry.file)).toEqual(["CLAUDE.md"]);
    expect(plan.source?.content).toContain("Run the tests before pushing");
  });

  it("names where appended text came from", () => {
    const plan = planFor({
      "/repo/AGENTS.md": "- Use pnpm\n",
      "/repo/CLAUDE.md": "- Run the tests before pushing\n",
    });

    expect(plan.source?.content).toContain("## From CLAUDE.md");
  });

  it("creates the source when the repository has no AGENTS.md", () => {
    const plan = planFor({
      "/repo/CLAUDE.md": "- Run the tests before pushing\n",
      "/repo/.cursorrules": "- Prefer composition\n",
    });

    expect(plan.source?.created).toBe(true);
    expect(plan.source?.existing).toBe("");
    expect(plan.source?.content).toContain("Run the tests before pushing");
    expect(plan.source?.content).toContain("Prefer composition");
  });

  it("consolidates into another platform when asked", () => {
    const plan = planFor(
      {
        "/repo/AGENTS.md": "- Use pnpm\n",
        "/repo/CLAUDE.md": "- Run tests\n",
      },
      "claude",
    );

    expect(plan.source?.file).toBe("CLAUDE.md");
    expect(plan.targets.map((entry) => entry.target)).toEqual(["agents-md"]);
  });

  it("refuses a source platform that has no single root file", () => {
    const plan = planFor({ "/repo/AGENTS.md": "- Use pnpm\n" }, "cursor");

    expect(plan.source).toBeUndefined();
    expect(plan.blockers.map((item) => item.code)).toEqual(["AGF001"]);
  });

  it("never folds personal, local-scoped configuration into a committed file", () => {
    const plan = planFor({
      "/repo/AGENTS.md": "- Use pnpm\n",
      "/repo/CLAUDE.local.md": "- My personal shortcut\n",
    });

    expect(plan.source?.content).not.toContain("My personal shortcut");
  });

  it("treats a symlinked twin as one text, not a second source", () => {
    // memoryFileSystem has no symlinks, so the generated-marker path is the
    // proxy for "already output": neither may be appended.
    const plan = planFor({
      "/repo/AGENTS.md": "- Use pnpm\n",
      "/repo/CLAUDE.md": "<!-- generated by agentfile — do not edit directly -->\n- Use pnpm\n",
    });

    expect(plan.source?.appended).toHaveLength(0);
    expect(plan.source?.alreadyCovered).toHaveLength(0);
  });

  it("reports the surfaces it leaves alone", () => {
    const plan = planFor({
      "/repo/AGENTS.md": "- Use pnpm\n",
      "/repo/.claude/skills/deploy/SKILL.md":
        "---\nname: deploy\ndescription: Deploys the service to production\n---\n\nSteps.",
      "/repo/.claude/commands/release.md": "Cut a release.",
    });

    const kinds = plan.untouched.map((entry) => entry.kind);
    expect(kinds).toContain("skills");
    expect(kinds).toContain("commands");
    for (const surface of plan.untouched) expect(surface.reason.length).toBeGreaterThan(10);
  });

  it("plans nothing for a repository with no instructions", () => {
    const plan = planFor({ "/repo/README.md": "# Hello\n" });

    expect(plan.source).toBeUndefined();
    expect(plan.targets).toEqual([]);
    expect(plan.blockers).toEqual([]);
  });

  it("is deterministic", () => {
    const files = {
      "/repo/AGENTS.md": "- Use pnpm\n",
      "/repo/CLAUDE.md": "- Run tests\n",
      "/repo/.github/copilot-instructions.md": "- Prefer composition\n",
    };

    expect(planFor(files).source?.content).toBe(planFor(files).source?.content);
  });
});
