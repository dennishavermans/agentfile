import { describe, expect, it } from "vitest";
import {
  agentsMdCompiler,
  claudeCompiler,
  COMPILE_TARGETS,
  compilerFor,
  copilotCompiler,
  cursorCompiler,
} from "../src/compilers/index.ts";
import { driftedFiles, planCompilation } from "../src/compilers/host.ts";
import { mergeBodies, outputSlug, selectSources } from "../src/compilers/sources.ts";
import { memoryFileSystem } from "../src/fs/index.ts";
import type { AgentConfiguration, Instruction, Provenance } from "../src/ir/index.ts";
import { ALWAYS, appliesToDirectory, appliesToPaths, emptyConfiguration } from "../src/ir/index.ts";

const ROOT = "/repo";

function provenance(file: string, overrides: Partial<Provenance> = {}): Provenance {
  return { file, platform: "agents-md", scope: "project", origin: "declared", ...overrides };
}

function instruction(file: string, body: string, overrides: Partial<Instruction> = {}): Instruction {
  return {
    id: `instruction:${file}`,
    title: file,
    body,
    applies: ALWAYS,
    provenance: provenance(file),
    ...overrides,
  };
}

function configurationWith(overrides: Partial<AgentConfiguration>): AgentConfiguration {
  return { ...emptyConfiguration(ROOT), ...overrides };
}

// ─── Source selection ────────────────────────────────────────────────────────

describe("selectSources", () => {
  it("never carries a target's own files back at it", () => {
    const configuration = configurationWith({
      instructions: [
        instruction("AGENTS.md", "shared"),
        instruction("CLAUDE.md", "claude only", { provenance: provenance("CLAUDE.md", { platform: "claude" }) }),
      ],
    });

    expect(selectSources(configuration, "claude").always.map((entry) => entry.provenance.file)).toEqual(["AGENTS.md"]);
    expect(selectSources(configuration, "agents-md").always.map((entry) => entry.provenance.file)).toEqual(["CLAUDE.md"]);
  });

  it("never carries generated files, so a compile cannot feed itself", () => {
    const configuration = configurationWith({
      instructions: [
        instruction("CLAUDE.md", "compiled earlier", {
          provenance: provenance("CLAUDE.md", { platform: "claude", origin: "generated" }),
        }),
      ],
    });

    expect(selectSources(configuration, "agents-md").always).toHaveLength(0);
  });

  it("never carries local-scoped files into shared output", () => {
    const configuration = configurationWith({
      instructions: [
        instruction("CLAUDE.local.md", "my personal notes", {
          provenance: provenance("CLAUDE.local.md", { platform: "claude", scope: "local" }),
        }),
      ],
    });

    expect(selectSources(configuration, "agents-md").always).toHaveLength(0);
  });

  it("drops exact-duplicate bodies and records the drop", () => {
    const configuration = configurationWith({
      instructions: [
        instruction("AGENTS.md", "Use pnpm.\n"),
        instruction("CLAUDE.md", "Use pnpm.\n", { provenance: provenance("CLAUDE.md", { platform: "claude" }) }),
      ],
    });

    const sources = selectSources(configuration, "copilot");
    expect(sources.always).toHaveLength(1);
    expect(sources.duplicates).toEqual([{ kept: "AGENTS.md", dropped: "CLAUDE.md" }]);
  });

  it("orders deterministically by file, then line", () => {
    const configuration = configurationWith({
      instructions: [
        instruction("b.md", "two"),
        instruction("a.md", "one"),
      ],
    });

    expect(selectSources(configuration, "claude").always.map((entry) => entry.body)).toEqual(["one", "two"]);
  });

  it("buckets by applicability", () => {
    const configuration = configurationWith({
      instructions: [
        instruction("AGENTS.md", "root"),
        instruction("apps/web/AGENTS.md", "web", { applies: appliesToDirectory("apps/web") }),
        instruction(".cursor/rules/api.mdc", "api", {
          applies: appliesToPaths(["src/api/**"]),
          provenance: provenance(".cursor/rules/api.mdc", { platform: "cursor" }),
        }),
        instruction(".cursor/rules/manual.mdc", "manual", {
          applies: { kind: "manual" },
          provenance: provenance(".cursor/rules/manual.mdc", { platform: "cursor" }),
        }),
      ],
    });

    const sources = selectSources(configuration, "claude");
    expect(sources.always).toHaveLength(1);
    expect([...sources.byDirectory.keys()]).toEqual(["apps/web"]);
    expect(sources.byPaths).toHaveLength(1);
    expect(sources.modelSelected).toHaveLength(1);
  });
});

describe("mergeBodies", () => {
  it("passes a single body through verbatim", () => {
    expect(mergeBodies([instruction("AGENTS.md", "just this\n")])).toBe("just this\n");
  });

  it("labels each section with its source when merging", () => {
    const merged = mergeBodies([instruction("AGENTS.md", "one"), instruction("docs/x.md", "two")]);
    expect(merged).toContain("<!-- agentfile: from AGENTS.md -->");
    expect(merged).toContain("<!-- agentfile: from docs/x.md -->");
    expect(merged.indexOf("one")).toBeLessThan(merged.indexOf("two"));
  });
});

describe("outputSlug", () => {
  it("derives a stable filesystem-safe name from the source path", () => {
    expect(outputSlug(instruction(".github/instructions/api.instructions.md", "x"))).toBe(
      "github-instructions-api-instructions",
    );
  });
});

// ─── Target compilers ────────────────────────────────────────────────────────

describe("target compilers", () => {
  const claudeSourced = configurationWith({
    instructions: [
      instruction("CLAUDE.md", "Use pnpm.\n", { provenance: provenance("CLAUDE.md", { platform: "claude" }) }),
      instruction("apps/web/CLAUDE.md", "Web rules.\n", {
        applies: appliesToDirectory("apps/web"),
        provenance: provenance("apps/web/CLAUDE.md", { platform: "claude", scope: "directory" }),
      }),
      instruction(".claude/rules/api.md", "API rules.\n", {
        applies: appliesToPaths(["src/api/**/*.ts"]),
        provenance: provenance(".claude/rules/api.md", { platform: "claude" }),
      }),
    ],
  });

  it("agents-md emits root and nested AGENTS.md, and reports path scopes as unsupported", () => {
    const plan = agentsMdCompiler.compile(claudeSourced);

    expect(plan.files.map((file) => file.path)).toEqual(["AGENTS.md", "apps/web/AGENTS.md"]);
    expect(plan.files[0].content).toBe("Use pnpm.\n");

    const loss = plan.diagnostics.find((entry) => entry.code === "AGF201");
    expect(loss).toBeDefined();
    expect(loss?.message).toContain("path-scoped");
  });

  it("claude emits CLAUDE.md files and .claude/rules with a paths list", () => {
    const configuration = configurationWith({
      instructions: [
        instruction("AGENTS.md", "Root.\n"),
        instruction(".github/instructions/api.instructions.md", "API.\n", {
          applies: appliesToPaths(["src/api/**"]),
          provenance: provenance(".github/instructions/api.instructions.md", { platform: "copilot" }),
        }),
      ],
    });

    const plan = claudeCompiler.compile(configuration);
    expect(plan.files.map((file) => file.path)).toEqual([
      ".claude/rules/agentfile-github-instructions-api-instructions.md",
      "CLAUDE.md",
    ]);

    const rule = plan.files[0].content;
    expect(rule).toContain("paths:");
    expect(rule).toContain('"src/api/**"');
    expect(rule).toContain("API.");
    expect(plan.diagnostics.filter((entry) => entry.code === "AGF201")).toHaveLength(0);
  });

  it("copilot emits its root file, applyTo path files, and says nested scopes come from agents-md", () => {
    const plan = copilotCompiler.compile(claudeSourced);

    expect(plan.files.map((file) => file.path)).toEqual([
      ".github/copilot-instructions.md",
      ".github/instructions/agentfile-claude-rules-api.instructions.md",
    ]);
    expect(plan.files[1].content).toContain('applyTo: "src/api/**/*.ts"');

    // Path-scoped instructions on Copilot are documented as degraded.
    expect(plan.diagnostics.some((entry) => entry.code === "AGF202")).toBe(true);
    const nested = plan.notCarried.find((entry) => entry.kind === "directory-scoped instructions");
    expect(nested?.reason).toContain("agents-md");
  });

  it("cursor emits alwaysApply and globs rules", () => {
    const plan = cursorCompiler.compile(claudeSourced);

    expect(plan.files.map((file) => file.path)).toEqual([
      ".cursor/rules/agentfile-claude-rules-api.mdc",
      ".cursor/rules/agentfile.mdc",
      "apps/web/.cursor/rules/agentfile.mdc",
    ]);

    expect(plan.files[1].content).toContain("alwaysApply: true");
    expect(plan.files[0].content).toContain("globs:");
    expect(plan.files[0].content).toContain('"src/api/**/*.ts"');
  });

  it("reports what the compiler itself does not carry, without blaming the target", () => {
    const configuration = configurationWith({
      instructions: [instruction("AGENTS.md", "Root.\n")],
      skills: [
        {
          id: "skill:x",
          name: "x",
          description: "does x",
          body: "body",
          resources: [],
          applies: { kind: "model-selected" },
          provenance: provenance(".claude/skills/x/SKILL.md", { platform: "claude" }),
        },
      ],
    });

    // Cursor supports skills, so an uncompiled foreign skill is a compiler
    // limitation (notCarried), not a target limitation (diagnostic).
    const cursor = cursorCompiler.compile(configuration);
    expect(cursor.notCarried.some((entry) => entry.kind === "skills")).toBe(true);
    expect(cursor.diagnostics.filter((entry) => entry.data?.feature === "skills")).toHaveLength(0);

    // AGENTS.md has no skill concept, so there it *is* a target limitation.
    const agentsMd = agentsMdCompiler.compile(configuration);
    expect(agentsMd.diagnostics.some((entry) => entry.code === "AGF201" && entry.data?.feature === "skills")).toBe(true);
  });

  it("emits nothing for a target whose only sources are its own files", () => {
    const configuration = configurationWith({
      instructions: [instruction("AGENTS.md", "Root.\n")],
    });

    const plan = agentsMdCompiler.compile(configuration);
    expect(plan.files).toHaveLength(0);
  });

  it("is deterministic: the same configuration produces the same bytes", () => {
    const first = claudeCompiler.compile(claudeSourced);
    const second = claudeCompiler.compile(claudeSourced);
    expect(JSON.stringify(first.files)).toBe(JSON.stringify(second.files));
  });

  it("registers exactly the implemented targets", () => {
    expect(COMPILE_TARGETS).toEqual(["agents-md", "claude", "copilot", "cursor"]);
    expect(compilerFor("claude")?.id).toBe("claude");
    expect(compilerFor("codex")).toBeUndefined();
  });
});

// ─── Host ────────────────────────────────────────────────────────────────────

describe("planCompilation", () => {
  const configuration = configurationWith({
    instructions: [instruction("AGENTS.md", "Use pnpm.\n")],
  });

  it("marks new files as create and prepends the generated marker", () => {
    const plan = planCompilation(configuration, {
      root: ROOT,
      fs: memoryFileSystem({}),
      targets: ["claude"],
    });

    expect(plan.files).toHaveLength(1);
    expect(plan.files[0].action).toBe("create");
    expect(plan.files[0].content).toMatch(/^<!-- generated by agentfile/);
  });

  it("marks byte-identical files as unchanged", () => {
    const first = planCompilation(configuration, { root: ROOT, fs: memoryFileSystem({}), targets: ["claude"] });
    const onDisk = memoryFileSystem({ "/repo/CLAUDE.md": first.files[0].content });

    const second = planCompilation(configuration, { root: ROOT, fs: onDisk, targets: ["claude"] });
    expect(second.files[0].action).toBe("unchanged");
    expect(driftedFiles(second)).toHaveLength(0);
  });

  it("updates a file that carries the marker but drifted", () => {
    const onDisk = memoryFileSystem({ "/repo/CLAUDE.md": "<!-- generated by agentfile — do not edit directly -->\nstale\n" });
    const plan = planCompilation(configuration, { root: ROOT, fs: onDisk, targets: ["claude"] });
    expect(plan.files[0].action).toBe("update");
  });

  it("refuses to overwrite a hand-written file, with an AGF204 finding", () => {
    const onDisk = memoryFileSystem({ "/repo/CLAUDE.md": "# My hand-written memory file\n" });
    const plan = planCompilation(configuration, { root: ROOT, fs: onDisk, targets: ["claude"] });

    expect(plan.files[0].action).toBe("refused");
    expect(plan.diagnostics).toHaveLength(1);
    expect(plan.diagnostics[0].code).toBe("AGF204");
    expect(plan.diagnostics[0].suggestion).toContain("--force");
  });

  it("overwrites a manifest-owned file even without a marker", () => {
    const onDisk = memoryFileSystem({ "/repo/CLAUDE.md": "old compiled content without marker\n" });
    const plan = planCompilation(configuration, {
      root: ROOT,
      fs: onDisk,
      targets: ["claude"],
      owned: new Set(["CLAUDE.md"]),
    });
    expect(plan.files[0].action).toBe("update");
  });

  it("overwrites with force, but only with force", () => {
    const onDisk = memoryFileSystem({ "/repo/CLAUDE.md": "# Hand-written\n" });
    const forced = planCompilation(configuration, { root: ROOT, fs: onDisk, targets: ["claude"], force: true });
    expect(forced.files[0].action).toBe("update");
    expect(forced.diagnostics).toHaveLength(0);
  });

  it("throws on an unknown target instead of guessing", () => {
    expect(() =>
      planCompilation(configuration, { root: ROOT, fs: memoryFileSystem({}), targets: ["codex"] }),
    ).toThrow(/agents-md/);
  });

  it("compiles several targets in one plan, sorted by path", () => {
    const plan = planCompilation(configuration, {
      root: ROOT,
      fs: memoryFileSystem({}),
      targets: ["cursor", "claude", "copilot"],
    });

    expect(plan.files.map((file) => file.path)).toEqual([
      ".cursor/rules/agentfile.mdc",
      ".github/copilot-instructions.md",
      "CLAUDE.md",
    ]);
  });
});
