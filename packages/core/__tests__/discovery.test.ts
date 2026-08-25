import { describe, expect, it } from "vitest";
import {
  DEFAULT_IGNORED_DIRECTORIES,
  discover,
  discoverAgentsMd,
  discoverClaudeMd,
  discoverClaudeRules,
  discoverCopilotInstructions,
  discoverCursorRules,
  discoverMcpServers,
  discoverSkills,
  discoverSubagents,
  filesNamed,
  filesUnder,
  findImports,
  governedDirectory,
  scanRepository,
} from "../src/discovery/index.ts";
import { alwaysLoadedContext, findInstructionOverlap } from "../src/analysis/index.ts";
import { memoryFileSystem } from "../src/fs/index.ts";
import { resolveForPath } from "../src/resolver/index.ts";

const ROOT = "/repo";

function scanOf(files: Record<string, string>) {
  const fs = memoryFileSystem(files);
  return { fs, scan: scanRepository(ROOT, fs) };
}

// ─── Scanning ──────────────────────────────────────────────────────────────

describe("scanRepository", () => {
  it("lists every file as a sorted project-relative path", () => {
    const { scan } = scanOf({
      "/repo/AGENTS.md": "a",
      "/repo/src/index.ts": "b",
      "/repo/apps/web/AGENTS.md": "c",
    });

    expect(scan.files).toEqual(["AGENTS.md", "apps/web/AGENTS.md", "src/index.ts"]);
    expect(scan.truncated).toBe(false);
  });

  it("skips generated and vendored directories", () => {
    const { scan } = scanOf({
      "/repo/AGENTS.md": "a",
      "/repo/node_modules/pkg/AGENTS.md": "b",
      "/repo/dist/AGENTS.md": "c",
      "/repo/coverage/AGENTS.md": "d",
    });

    expect(scan.files).toEqual(["AGENTS.md"]);
    expect(scan.ignored).toEqual(["coverage", "dist", "node_modules"]);
  });

  it("does not skip dot directories that hold agent configuration", () => {
    const { scan } = scanOf({
      "/repo/.claude/CLAUDE.md": "a",
      "/repo/.cursor/rules/main.mdc": "b",
      "/repo/.github/copilot-instructions.md": "c",
      "/repo/.agents/skills/deploy/SKILL.md": "d",
    });

    expect(scan.files).toHaveLength(4);
  });

  it("skips the .git directory", () => {
    const { scan } = scanOf({ "/repo/AGENTS.md": "a", "/repo/.git/config": "b" });
    expect(scan.files).toEqual(["AGENTS.md"]);
  });

  it("reports truncation rather than scanning without bound", () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 30; index++) files[`/repo/file-${index}.md`] = "x";

    const fs = memoryFileSystem(files);
    const scan = scanRepository(ROOT, fs, { maxFiles: 10 });

    expect(scan.truncated).toBe(true);
    expect(scan.files).toHaveLength(10);
    expect(scan.truncationReason).toContain("10 files");
  });

  it("reports truncation when nesting exceeds the depth limit", () => {
    const fs = memoryFileSystem({ "/repo/a/b/c/d/deep.md": "x" });
    const scan = scanRepository(ROOT, fs, { maxDepth: 2 });

    expect(scan.truncated).toBe(true);
    expect(scan.truncationReason).toContain("nesting");
  });

  it("exposes its ignore list so callers can extend it", () => {
    expect(DEFAULT_IGNORED_DIRECTORIES).toContain("node_modules");
    expect(DEFAULT_IGNORED_DIRECTORIES).not.toContain(".claude");
  });
});

describe("scan queries", () => {
  const { scan } = scanOf({
    "/repo/AGENTS.md": "a",
    "/repo/apps/web/AGENTS.md": "b",
    "/repo/.claude/rules/style.md": "c",
    "/repo/apps/web/.claude/rules/api.md": "d",
    "/repo/README.md": "e",
  });

  it("finds files by exact basename", () => {
    expect(filesNamed(scan, "AGENTS.md")).toEqual(["AGENTS.md", "apps/web/AGENTS.md"]);
  });

  it("finds files under a directory at any nesting level", () => {
    expect(filesUnder(scan, [".claude/rules"], ".md")).toEqual([
      ".claude/rules/style.md",
      "apps/web/.claude/rules/api.md",
    ]);
  });
});

// ─── Governed directory ────────────────────────────────────────────────────

describe("governedDirectory", () => {
  it("returns the root for a root-level file", () => {
    expect(governedDirectory("AGENTS.md")).toBe("");
  });

  it("returns the containing directory for a nested instruction file", () => {
    expect(governedDirectory("apps/mobile/AGENTS.md")).toBe("apps/mobile");
  });

  it("walks out of a configuration directory", () => {
    expect(governedDirectory(".claude/CLAUDE.md")).toBe("");
    expect(governedDirectory("apps/web/.claude/rules/api.md")).toBe("apps/web");
    expect(governedDirectory("apps/web/.cursor/rules/api.mdc")).toBe("apps/web");
    expect(governedDirectory(".github/copilot-instructions.md")).toBe("");
  });

  it("walks out of a nested skills directory", () => {
    expect(governedDirectory("apps/mobile/.claude/skills/deploy/SKILL.md")).toBe("apps/mobile");
  });
});

// ─── Imports ───────────────────────────────────────────────────────────────

describe("findImports", () => {
  it("finds a path import", () => {
    expect(findImports("See @docs/git-instructions.md for details.")).toEqual(["docs/git-instructions.md"]);
  });

  it("finds a bare filename import with an extension", () => {
    expect(findImports("@AGENTS.md\n\n## Extra")).toEqual(["AGENTS.md"]);
  });

  it("ignores a mention that is not a path", () => {
    expect(findImports("Ask @claude about it")).toEqual([]);
  });

  it("ignores imports inside an inline code span", () => {
    expect(findImports("Write `@README` to keep it literal")).toEqual([]);
  });

  it("ignores imports inside a fenced code block", () => {
    expect(findImports("```\n@secret/file.md\n```\n")).toEqual([]);
  });

  it("deduplicates and sorts", () => {
    expect(findImports("@b/x.md and @a/y.md and @b/x.md")).toEqual(["a/y.md", "b/x.md"]);
  });

  it("strips trailing sentence punctuation", () => {
    expect(findImports("Read @docs/style.md.")).toEqual(["docs/style.md"]);
  });
});

// ─── AGENTS.md ─────────────────────────────────────────────────────────────

describe("discoverAgentsMd", () => {
  it("reads the root file as unconditional", () => {
    const { fs, scan } = scanOf({ "/repo/AGENTS.md": "# Root rules" });
    const found = discoverAgentsMd(ROOT, scan, fs);

    expect(found.instructions).toHaveLength(1);
    expect(found.instructions[0].body).toBe("# Root rules");
    expect(found.instructions[0].applies).toEqual({ kind: "always" });
    expect(found.instructions[0].provenance).toMatchObject({ platform: "agents-md", scope: "project" });
  });

  it("scopes a nested file to its subtree", () => {
    const { fs, scan } = scanOf({ "/repo/apps/mobile/AGENTS.md": "# Mobile" });
    const [instruction] = discoverAgentsMd(ROOT, scan, fs).instructions;

    expect(instruction.applies).toEqual({ kind: "directory", directory: "apps/mobile" });
    expect(instruction.provenance.scope).toBe("directory");
  });

  it("records the file as a source with its size", () => {
    const { fs, scan } = scanOf({ "/repo/AGENTS.md": "abc" });
    expect(discoverAgentsMd(ROOT, scan, fs).sources[0]).toEqual({
      path: "AGENTS.md",
      platform: "agents-md",
      scope: "project",
      kind: "instructions",
      bytes: 3,
    });
  });
});

// ─── CLAUDE.md ─────────────────────────────────────────────────────────────

describe("discoverClaudeMd", () => {
  it("reads CLAUDE.md and .claude/CLAUDE.md as project-scoped", () => {
    const { fs, scan } = scanOf({ "/repo/CLAUDE.md": "root", "/repo/.claude/CLAUDE.md": "also root" });
    const found = discoverClaudeMd(ROOT, scan, fs);

    expect(found.instructions).toHaveLength(2);
    for (const instruction of found.instructions) {
      expect(instruction.applies).toEqual({ kind: "always" });
      expect(instruction.provenance.scope).toBe("project");
    }
  });

  it("treats CLAUDE.local.md as personal, local-scoped configuration", () => {
    const { fs, scan } = scanOf({ "/repo/CLAUDE.local.md": "my notes" });
    expect(discoverClaudeMd(ROOT, scan, fs).instructions[0].provenance.scope).toBe("local");
  });

  it("orders local configuration after shared configuration at the same level", () => {
    const { fs, scan } = scanOf({ "/repo/CLAUDE.md": "shared", "/repo/CLAUDE.local.md": "personal" });
    const configuration = {
      ...discoverClaudeMd(ROOT, scan, fs),
      instructions: discoverClaudeMd(ROOT, scan, fs).instructions,
    };

    const effective = resolveForPath(
      { ...emptyConfigurationFor(ROOT), instructions: configuration.instructions },
      "src/x.ts",
    );

    expect(effective.instructions.map((entry) => entry.node.body)).toEqual(["shared", "personal"]);
  });

  it("records declared imports", () => {
    const { fs, scan } = scanOf({ "/repo/CLAUDE.md": "@AGENTS.md\n\n## Claude Code\nUse plan mode." });
    expect(discoverClaudeMd(ROOT, scan, fs).instructions[0].imports).toEqual(["AGENTS.md"]);
  });

  it("leaves imports undefined when there are none", () => {
    const { fs, scan } = scanOf({ "/repo/CLAUDE.md": "no imports here" });
    expect(discoverClaudeMd(ROOT, scan, fs).instructions[0].imports).toBeUndefined();
  });
});

// Local helper so the CLAUDE.md ordering test can build a configuration.
function emptyConfigurationFor(root: string) {
  return {
    version: 1 as const,
    root,
    project: { stack: [] },
    instructions: [],
    directives: [],
    skills: [],
    subagents: [],
    hooks: [],
    mcpServers: [],
    permissions: [],
    artifacts: [],
    docs: [],
    sources: [],
  };
}

// ─── .claude/rules ─────────────────────────────────────────────────────────

describe("discoverClaudeRules", () => {
  it("applies a rule with a paths list only to matching files", () => {
    const { fs, scan } = scanOf({
      "/repo/.claude/rules/api.md": '---\npaths:\n  - "src/api/**/*.ts"\n---\n\nValidate all input.',
    });

    const [instruction] = discoverClaudeRules(ROOT, scan, fs).instructions;
    expect(instruction.applies).toEqual({ kind: "paths", patterns: ["src/api/**/*.ts"] });
    expect(instruction.body.trim()).toBe("Validate all input.");
  });

  it("accepts a comma-separated paths string", () => {
    const { fs, scan } = scanOf({
      "/repo/.claude/rules/api.md": "---\npaths: src/**/*.ts, lib/**/*.ts\n---\n\nBody",
    });

    expect(discoverClaudeRules(ROOT, scan, fs).instructions[0].applies).toEqual({
      kind: "paths",
      patterns: ["src/**/*.ts", "lib/**/*.ts"],
    });
  });

  it("loads a rule without paths unconditionally", () => {
    const { fs, scan } = scanOf({ "/repo/.claude/rules/style.md": "# Style\n\nUse two spaces." });
    expect(discoverClaudeRules(ROOT, scan, fs).instructions[0].applies).toEqual({ kind: "always" });
  });

  it("scopes a nested rule directory to its subtree", () => {
    const { fs, scan } = scanOf({ "/repo/apps/web/.claude/rules/style.md": "Body" });
    expect(discoverClaudeRules(ROOT, scan, fs).instructions[0].applies).toEqual({
      kind: "directory",
      directory: "apps/web",
    });
  });

  it("reports malformed frontmatter without losing the file", () => {
    const { fs, scan } = scanOf({ "/repo/.claude/rules/bad.md": "---\npaths: [unclosed\n---\n\nBody" });
    const found = discoverClaudeRules(ROOT, scan, fs);

    expect(found.diagnostics[0].code).toBe("AGF003");
    expect(found.instructions).toHaveLength(1);
  });
});

// ─── Cursor ────────────────────────────────────────────────────────────────

describe("discoverCursorRules", () => {
  it("treats alwaysApply as unconditional", () => {
    const { fs, scan } = scanOf({
      "/repo/.cursor/rules/main.mdc": "---\ndescription: Global\nalwaysApply: true\n---\n\nBody",
    });

    expect(discoverCursorRules(ROOT, scan, fs).instructions[0].applies).toEqual({ kind: "always" });
  });

  it("treats globs as path-scoped", () => {
    const { fs, scan } = scanOf({
      "/repo/.cursor/rules/api.mdc": '---\ndescription: API\nglobs: ["src/api/**"]\nalwaysApply: false\n---\n\nBody',
    });

    expect(discoverCursorRules(ROOT, scan, fs).instructions[0].applies).toEqual({
      kind: "paths",
      patterns: ["src/api/**"],
    });
  });

  it("treats a description with no globs as agent-selected", () => {
    const { fs, scan } = scanOf({
      "/repo/.cursor/rules/maybe.mdc": "---\ndescription: Use when writing tests\n---\n\nBody",
    });

    expect(discoverCursorRules(ROOT, scan, fs).instructions[0].applies).toEqual({ kind: "model-selected" });
  });

  it("treats a rule with no routing metadata as manual only", () => {
    const { fs, scan } = scanOf({ "/repo/.cursor/rules/manual.mdc": "Just a body, no frontmatter" });
    expect(discoverCursorRules(ROOT, scan, fs).instructions[0].applies).toEqual({ kind: "manual" });
  });

  it("uses the description as the title when there is one", () => {
    const { fs, scan } = scanOf({ "/repo/.cursor/rules/a.mdc": "---\ndescription: Nice title\n---\n\nBody" });
    expect(discoverCursorRules(ROOT, scan, fs).instructions[0].title).toBe("Nice title");
  });
});

// ─── Copilot ───────────────────────────────────────────────────────────────

describe("discoverCopilotInstructions", () => {
  it("reads the repository-wide file as unconditional", () => {
    const { fs, scan } = scanOf({ "/repo/.github/copilot-instructions.md": "# Copilot" });
    const [instruction] = discoverCopilotInstructions(ROOT, scan, fs).instructions;

    expect(instruction.applies).toEqual({ kind: "always" });
    expect(instruction.provenance.platform).toBe("copilot");
  });

  it("reads applyTo as comma-separated globs", () => {
    const { fs, scan } = scanOf({
      "/repo/.github/instructions/ts.instructions.md": '---\napplyTo: "**/*.ts,**/*.tsx"\n---\n\nUse strict mode.',
    });

    expect(discoverCopilotInstructions(ROOT, scan, fs).instructions[0].applies).toEqual({
      kind: "paths",
      patterns: ["**/*.ts", "**/*.tsx"],
    });
  });

  it("does not split a glob on the spaces inside a brace group", () => {
    const { fs, scan } = scanOf({
      "/repo/.github/instructions/a.instructions.md": '---\napplyTo: "src/**/*.{ts,tsx}"\n---\n\nBody',
    });

    expect(discoverCopilotInstructions(ROOT, scan, fs).instructions[0].applies).toEqual({
      kind: "paths",
      patterns: ["src/**/*.{ts,tsx}"],
    });
  });
});

// ─── Skills ────────────────────────────────────────────────────────────────

describe("discoverSkills", () => {
  it("reads the specification fields as first-class data", () => {
    const { fs, scan } = scanOf({
      "/repo/.claude/skills/pdf-processing/SKILL.md": [
        "---",
        "name: pdf-processing",
        "description: Extract PDF text. Use when handling PDFs.",
        "license: Apache-2.0",
        "compatibility: Requires python3",
        "metadata:",
        "  author: example-org",
        "  version: '1.0'",
        "allowed-tools: Read Bash",
        "---",
        "",
        "# Steps",
      ].join("\n"),
    });

    const [skill] = discoverSkills(ROOT, scan, fs).skills;
    expect(skill.name).toBe("pdf-processing");
    expect(skill.description).toBe("Extract PDF text. Use when handling PDFs.");
    expect(skill.license).toBe("Apache-2.0");
    expect(skill.compatibility).toBe("Requires python3");
    expect(skill.metadata).toEqual({ author: "example-org", version: "1.0" });
    expect(skill.allowedTools).toEqual(["Read", "Bash"]);
    expect(skill.body.trim()).toBe("# Steps");
  });

  it("preserves non-specification frontmatter as extensions", () => {
    const { fs, scan } = scanOf({
      "/repo/.claude/skills/deploy/SKILL.md":
        "---\nname: deploy\ndescription: d\nmodel: opus\neffort: high\n---\n\nBody",
    });

    expect(discoverSkills(ROOT, scan, fs).skills[0].extensions).toEqual({ model: "opus", effort: "high" });
  });

  it("falls back to the directory name when frontmatter has no name", () => {
    const { fs, scan } = scanOf({ "/repo/.claude/skills/deploy/SKILL.md": "---\ndescription: d\n---\n\nBody" });
    expect(discoverSkills(ROOT, scan, fs).skills[0].name).toBe("deploy");
  });

  it("classifies bundled resources by convention", () => {
    const { fs, scan } = scanOf({
      "/repo/.claude/skills/pdf/SKILL.md": "---\nname: pdf\ndescription: d\n---\n\nBody",
      "/repo/.claude/skills/pdf/scripts/extract.py": "print()",
      "/repo/.claude/skills/pdf/references/REFERENCE.md": "ref",
      "/repo/.claude/skills/pdf/assets/template.docx": "bin",
      "/repo/.claude/skills/pdf/notes.txt": "misc",
    });

    expect(discoverSkills(ROOT, scan, fs).skills[0].resources).toEqual([
      { path: "assets/template.docx", kind: "asset" },
      { path: "notes.txt", kind: "other" },
      { path: "references/REFERENCE.md", kind: "reference" },
      { path: "scripts/extract.py", kind: "script" },
    ]);
  });

  it("attributes each skills directory to its platform", () => {
    const { fs, scan } = scanOf({
      "/repo/.claude/skills/a/SKILL.md": "---\nname: a\ndescription: d\n---\n",
      "/repo/.cursor/skills/b/SKILL.md": "---\nname: b\ndescription: d\n---\n",
      "/repo/.github/skills/c/SKILL.md": "---\nname: c\ndescription: d\n---\n",
      "/repo/.agents/skills/d/SKILL.md": "---\nname: d\ndescription: d\n---\n",
    });

    const platforms = discoverSkills(ROOT, scan, fs).skills.map(
      (skill) => `${skill.name}:${skill.provenance.platform}`,
    );
    expect(platforms.sort()).toEqual(["a:claude", "b:cursor", "c:copilot", "d:generic"]);
  });

  it("offers a root skill everywhere and a nested skill only in its subtree", () => {
    const { fs, scan } = scanOf({
      "/repo/.claude/skills/shared/SKILL.md": "---\nname: shared\ndescription: d\n---\n",
      "/repo/apps/mobile/.claude/skills/rn/SKILL.md": "---\nname: rn\ndescription: d\n---\n",
    });

    const skills = discoverSkills(ROOT, scan, fs).skills;
    const shared = skills.find((skill) => skill.name === "shared");
    const nested = skills.find((skill) => skill.name === "rn");

    expect(shared?.applies).toEqual({ kind: "model-selected" });
    expect(nested?.applies).toEqual({ kind: "paths", patterns: ["apps/mobile/**"] });
  });

  it("honours a paths frontmatter list", () => {
    const { fs, scan } = scanOf({
      "/repo/.claude/skills/rn/SKILL.md": '---\nname: rn\ndescription: d\npaths: ["apps/mobile/**"]\n---\n',
    });

    expect(discoverSkills(ROOT, scan, fs).skills[0].applies).toEqual({
      kind: "paths",
      patterns: ["apps/mobile/**"],
    });
  });

  it("honours disable-model-invocation as manual-only", () => {
    const { fs, scan } = scanOf({
      "/repo/.claude/skills/deploy/SKILL.md":
        "---\nname: deploy\ndescription: d\ndisable-model-invocation: true\n---\n",
    });

    expect(discoverSkills(ROOT, scan, fs).skills[0].applies).toEqual({ kind: "manual" });
  });

  it("records the skill directory", () => {
    const { fs, scan } = scanOf({ "/repo/.claude/skills/deploy/SKILL.md": "---\nname: deploy\ndescription: d\n---\n" });
    expect(discoverSkills(ROOT, scan, fs).skills[0].directory).toBe(".claude/skills/deploy");
  });
});

// ─── Subagents ─────────────────────────────────────────────────────────────

describe("discoverSubagents", () => {
  it("reads name, description, tools, and model", () => {
    const { fs, scan } = scanOf({
      "/repo/.claude/agents/reviewer.md": [
        "---",
        "name: code-reviewer",
        "description: Reviews code. Use after writing code.",
        "tools: Read, Grep, Glob, Bash",
        "disallowedTools: Write, Edit",
        "model: sonnet",
        "---",
        "",
        "You are a senior code reviewer.",
      ].join("\n"),
    });

    const [subagent] = discoverSubagents(ROOT, scan, fs).subagents;
    expect(subagent.name).toBe("code-reviewer");
    expect(subagent.tools).toEqual(["Read", "Grep", "Glob", "Bash"]);
    expect(subagent.disallowedTools).toEqual(["Write", "Edit"]);
    expect(subagent.model).toBe("sonnet");
    expect(subagent.body.trim()).toBe("You are a senior code reviewer.");
  });

  it("finds subagents in nested directories", () => {
    const { fs, scan } = scanOf({
      "/repo/.claude/agents/review/security.md": "---\nname: security\ndescription: d\n---\n",
    });

    expect(discoverSubagents(ROOT, scan, fs).subagents[0].name).toBe("security");
  });

  it("falls back to the filename when frontmatter has no name", () => {
    const { fs, scan } = scanOf({ "/repo/.claude/agents/helper.md": "---\ndescription: d\n---\n" });
    expect(discoverSubagents(ROOT, scan, fs).subagents[0].name).toBe("helper");
  });

  it("preserves other documented fields as extensions", () => {
    const { fs, scan } = scanOf({
      "/repo/.claude/agents/a.md": "---\nname: a\ndescription: d\npermissionMode: plan\nmaxTurns: 5\n---\n",
    });

    expect(discoverSubagents(ROOT, scan, fs).subagents[0].extensions).toEqual({
      permissionMode: "plan",
      maxTurns: 5,
    });
  });
});

// ─── MCP ───────────────────────────────────────────────────────────────────

describe("discoverMcpServers", () => {
  it("reads a stdio server", () => {
    const { fs, scan } = scanOf({
      "/repo/.mcp.json": JSON.stringify({
        mcpServers: { db: { command: "npx", args: ["-y", "server"], env: { KEY: "value" } } },
      }),
    });

    const [server] = discoverMcpServers(ROOT, scan, fs).mcpServers;
    expect(server).toMatchObject({
      name: "db",
      transport: "stdio",
      command: "npx",
      args: ["-y", "server"],
      env: { KEY: "value" },
    });
  });

  it("reads a remote server and its timeout", () => {
    const { fs, scan } = scanOf({
      "/repo/.mcp.json": JSON.stringify({
        mcpServers: { stripe: { type: "http", url: "https://mcp.stripe.com", timeout: 600000 } },
      }),
    });

    expect(discoverMcpServers(ROOT, scan, fs).mcpServers[0]).toMatchObject({
      transport: "http",
      url: "https://mcp.stripe.com",
      timeoutMs: 600000,
    });
  });

  it("normalises the streamable-http alias to http", () => {
    const { fs, scan } = scanOf({
      "/repo/.mcp.json": JSON.stringify({ mcpServers: { a: { type: "streamable-http", url: "https://x" } } }),
    });

    expect(discoverMcpServers(ROOT, scan, fs).mcpServers[0].transport).toBe("http");
  });

  it("reports a url with no type, which the platform skips silently", () => {
    const { fs, scan } = scanOf({
      "/repo/.mcp.json": JSON.stringify({ mcpServers: { broken: { url: "https://x" } } }),
    });

    const found = discoverMcpServers(ROOT, scan, fs);
    expect(found.mcpServers).toHaveLength(0);
    expect(found.diagnostics[0].code).toBe("AGF001");
    expect(found.diagnostics[0].message).toContain('has a "url" but no "type"');
    expect(found.diagnostics[0].suggestion).toContain('"type": "http"');
  });

  it("reports a stdio server with no command", () => {
    const { fs, scan } = scanOf({ "/repo/.mcp.json": JSON.stringify({ mcpServers: { a: { args: ["x"] } } }) });
    const found = discoverMcpServers(ROOT, scan, fs);

    expect(found.diagnostics[0].message).toContain('no "command"');
  });

  it("reports an unrecognised transport", () => {
    const { fs, scan } = scanOf({
      "/repo/.mcp.json": JSON.stringify({ mcpServers: { a: { type: "carrier-pigeon", url: "https://x" } } }),
    });

    expect(discoverMcpServers(ROOT, scan, fs).diagnostics[0].message).toContain("unrecognised type");
  });

  it("reports malformed JSON", () => {
    const { fs, scan } = scanOf({ "/repo/.mcp.json": "{ not json" });
    expect(discoverMcpServers(ROOT, scan, fs).diagnostics[0].code).toBe("AGF003");
  });

  it("reports a file with no mcpServers object", () => {
    const { fs, scan } = scanOf({ "/repo/.mcp.json": JSON.stringify({ servers: {} }) });
    expect(discoverMcpServers(ROOT, scan, fs).diagnostics[0].message).toContain('no "mcpServers" object');
  });
});

// ─── Import checking ───────────────────────────────────────────────────────

describe("import checking", () => {
  it("reports an import that points at a missing file", () => {
    const result = discover({ root: ROOT, fs: memoryFileSystem({ "/repo/CLAUDE.md": "@docs/missing.md" }) });

    const found = result.diagnostics.find((item) => item.code === "AGF004");
    expect(found?.message).toContain("docs/missing.md");
  });

  it("stays quiet when the import resolves", () => {
    const result = discover({
      root: ROOT,
      fs: memoryFileSystem({ "/repo/CLAUDE.md": "@AGENTS.md", "/repo/AGENTS.md": "shared" }),
    });

    expect(result.diagnostics.filter((item) => item.code === "AGF004")).toHaveLength(0);
  });

  it("does not judge imports outside the repository", () => {
    const result = discover({
      root: ROOT,
      fs: memoryFileSystem({ "/repo/CLAUDE.md": "@~/.claude/my-notes.md" }),
    });

    expect(result.diagnostics.filter((item) => item.code === "AGF004")).toHaveLength(0);
  });

  it("resolves an import relative to the importing file", () => {
    const result = discover({
      root: ROOT,
      fs: memoryFileSystem({
        "/repo/apps/web/CLAUDE.md": "@style.md",
        "/repo/apps/web/style.md": "styles",
      }),
    });

    expect(result.diagnostics.filter((item) => item.code === "AGF004")).toHaveLength(0);
  });
});

// ─── Orchestration ─────────────────────────────────────────────────────────

describe("discover", () => {
  it("works on a repository that has never used agentfile", () => {
    const result = discover({
      root: ROOT,
      fs: memoryFileSystem({
        "/repo/AGENTS.md": "# Team rules",
        "/repo/.github/copilot-instructions.md": "# Copilot",
        "/repo/.cursor/rules/main.mdc": "---\nalwaysApply: true\n---\n\nBody",
      }),
    });

    expect(result.hasContract).toBe(false);
    expect(result.configuration.instructions).toHaveLength(3);
    expect(result.platforms).toEqual(["agents-md", "copilot", "cursor"]);
  });

  it("finds nothing, quietly, in an empty repository", () => {
    const result = discover({ root: ROOT, fs: memoryFileSystem({}) });

    expect(result.configuration.instructions).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.platforms).toEqual([]);
  });

  it("includes the agentfile contract as one source among the rest", () => {
    const result = discover({
      root: ROOT,
      fs: memoryFileSystem({
        "/repo/AGENTS.md": "# Team rules",
        "/repo/ai/contract.yaml": [
          "version: 1",
          "project:",
          "  name: Demo",
          "  stack: [typescript]",
          "rules:",
          "  coding:",
          "    - Use pnpm",
          "skills:",
          "  - name: s",
          "    description: d",
          "    steps: [one]",
        ].join("\n"),
      }),
    });

    expect(result.hasContract).toBe(true);
    expect(result.configuration.project.name).toBe("Demo");
    expect(result.configuration.directives).toHaveLength(1);
    expect(result.platforms).toEqual(["agentfile", "agents-md"]);
  });

  it("warns when the scan is truncated so a partial report is not mistaken for a clean one", () => {
    const files: Record<string, string> = { "/repo/AGENTS.md": "x" };
    for (let index = 0; index < 20; index++) files[`/repo/file-${index}.md`] = "x";

    const result = discover({ root: ROOT, fs: memoryFileSystem(files), maxFiles: 5 });
    expect(result.diagnostics.some((item) => item.message.includes("truncated"))).toBe(true);
  });

  it("resolves discovered configuration for a path", () => {
    const result = discover({
      root: ROOT,
      fs: memoryFileSystem({
        "/repo/AGENTS.md": "# Root",
        "/repo/apps/mobile/AGENTS.md": "# Mobile",
        "/repo/.claude/rules/api.md": '---\npaths: ["src/api/**"]\n---\n\nAPI rules',
      }),
    });

    const mobile = resolveForPath(result.configuration, "apps/mobile/src/Login.tsx");
    expect(mobile.instructions.map((entry) => entry.node.body.trim())).toEqual(["# Root", "# Mobile"]);

    const api = resolveForPath(result.configuration, "src/api/users.ts");
    expect(api.instructions.map((entry) => entry.node.body.trim())).toEqual(["# Root", "API rules"]);
  });

  it("reuses a provided scan instead of walking twice", () => {
    const fs = memoryFileSystem({ "/repo/AGENTS.md": "x" });
    const scan = scanRepository(ROOT, fs);
    const result = discover({ root: ROOT, fs, scan });

    expect(result.scan).toBe(scan);
  });
});

// ─── Symlinked instruction files ────────────────────────────────────────────

describe("symlinked instruction files", () => {
  /** A memory filesystem where CLAUDE.md is a symlink to AGENTS.md. */
  function linkedFs(body: string) {
    const inner = memoryFileSystem({ "/repo/AGENTS.md": body, "/repo/CLAUDE.md": body });
    return {
      ...inner,
      realPath: (path: string) => (path === "/repo/CLAUDE.md" ? "/repo/AGENTS.md" : inner.realPath(path)),
    };
  }

  const body = "- Use pnpm as the package manager, never npm or yarn.\n- Never commit directly to main; open a PR.\n";

  it("marks the link with its real file and keeps both nodes for resolution", () => {
    const result = discover({ root: ROOT, fs: linkedFs(body) });

    const claude = result.configuration.instructions.find((entry) => entry.provenance.file === "CLAUDE.md");
    const agents = result.configuration.instructions.find((entry) => entry.provenance.file === "AGENTS.md");

    expect(claude?.provenance.realFile).toBe("AGENTS.md");
    expect(claude?.provenance.note).toContain("symlink");
    expect(agents?.provenance.realFile).toBeUndefined();
  });

  it("does not report a file as duplicating its own symlink", () => {
    const result = discover({ root: ROOT, fs: linkedFs(body) });
    const overlaps = findInstructionOverlap(result.configuration.instructions);
    expect(overlaps).toHaveLength(0);
  });

  it("counts the shared text once in always-loaded context and derived rules", () => {
    const linked = discover({ root: ROOT, fs: linkedFs(body) });
    const copied = discover({
      root: ROOT,
      fs: memoryFileSystem({ "/repo/AGENTS.md": body, "/repo/CLAUDE.md": body }),
    });

    const linkedAlways = alwaysLoadedContext(linked.configuration);
    const copiedAlways = alwaysLoadedContext(copied.configuration);

    expect(linkedAlways.files).toEqual(["AGENTS.md"]);
    expect(linkedAlways.estimate.characters).toBe(body.length);
    // A genuine copy still counts twice, because a session genuinely loads both.
    expect(copiedAlways.estimate.characters).toBe(body.length * 2);
    expect(linked.configuration.directives.length).toBe(copied.configuration.directives.length / 2);
  });

  it("still reports genuine copies as duplication", () => {
    const result = discover({
      root: ROOT,
      fs: memoryFileSystem({ "/repo/AGENTS.md": body, "/repo/CLAUDE.md": body }),
    });
    expect(findInstructionOverlap(result.configuration.instructions).length).toBeGreaterThan(0);
  });

  it("leaves a symlink alone when its target is not a discovered instruction file", () => {
    const inner = memoryFileSystem({ "/repo/AGENTS.md": body });
    const fs = {
      ...inner,
      realPath: (path: string) => (path === "/repo/AGENTS.md" ? "/somewhere/else/AGENTS.md" : inner.realPath(path)),
    };

    const result = discover({ root: ROOT, fs });
    const agents = result.configuration.instructions.find((entry) => entry.provenance.file === "AGENTS.md");
    expect(agents?.provenance.realFile).toBeUndefined();
  });
});
