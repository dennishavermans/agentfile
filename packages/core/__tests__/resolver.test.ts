import { describe, expect, it } from "vitest";
import type { Applicability, ConfigScope, Directive, Instruction, SkillEntry } from "../src/ir/index.ts";
import {
  ALWAYS,
  appliesToDirectory,
  appliesToPaths,
  emptyConfiguration,
  MANUAL,
  MODEL_SELECTED,
  nodeId,
} from "../src/ir/index.ts";
import { explainInstruction, normalizeDirectiveText, resolveForPath, SCOPE_RANK } from "../src/resolver/index.ts";

const ROOT = "/repo";

function instruction(
  id: string,
  file: string,
  applies: Applicability,
  scope: ConfigScope = "project",
  line?: number,
): Instruction {
  return {
    id,
    title: id,
    body: `body of ${id}`,
    applies,
    provenance: { file, line, platform: "agentfile", scope, origin: "declared" },
  };
}

function directive(text: string, file: string, applies: Applicability = ALWAYS, line?: number): Directive {
  return {
    id: `directive:${file}#${text}`,
    text,
    category: "coding",
    applies,
    provenance: { file, line, platform: "agentfile", scope: "project", origin: "declared" },
  };
}

function skill(name: string, applies: Applicability): SkillEntry {
  const provenance = {
    file: `skills/${name}/SKILL.md`,
    platform: "claude" as const,
    scope: "project" as const,
    origin: "declared" as const,
  };
  return {
    id: nodeId("skill", provenance, name),
    name,
    description: `does ${name}`,
    body: "",
    resources: [],
    applies,
    provenance,
  };
}

function configurationWith(overrides: Partial<ReturnType<typeof emptyConfiguration>>) {
  return { ...emptyConfiguration(ROOT), ...overrides };
}

describe("SCOPE_RANK", () => {
  it("orders scopes from broadest to most specific", () => {
    expect(SCOPE_RANK.managed).toBeLessThan(SCOPE_RANK.user);
    expect(SCOPE_RANK.user).toBeLessThan(SCOPE_RANK.project);
    expect(SCOPE_RANK.project).toBeLessThan(SCOPE_RANK.directory);
    expect(SCOPE_RANK.directory).toBeLessThan(SCOPE_RANK.local);
  });
});

describe("applicability", () => {
  it("applies an unconditional instruction to any path", () => {
    const configuration = configurationWith({
      instructions: [instruction("root", "AGENTS.md", ALWAYS)],
    });

    const result = resolveForPath(configuration, "apps/mobile/src/Login.tsx");
    expect(result.instructions.map((entry) => entry.node.id)).toEqual(["root"]);
    expect(result.instructions[0].reason.kind).toBe("always");
  });

  it("applies a directory instruction only inside that directory", () => {
    const configuration = configurationWith({
      instructions: [instruction("mobile", "apps/mobile/AGENTS.md", appliesToDirectory("apps/mobile"))],
    });

    expect(resolveForPath(configuration, "apps/mobile/src/Login.tsx").instructions).toHaveLength(1);
    expect(resolveForPath(configuration, "apps/web/src/Login.tsx").instructions).toHaveLength(0);
  });

  it("explains why a directory instruction was excluded", () => {
    const configuration = configurationWith({
      instructions: [instruction("mobile", "apps/mobile/AGENTS.md", appliesToDirectory("apps/mobile"))],
    });

    const result = resolveForPath(configuration, "apps/web/src/Login.tsx");
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].reason.kind).toBe("outside-directory");
    expect(result.excluded[0].reason.detail).toBe("apps/web/src/Login.tsx is not inside apps/mobile");
  });

  it("applies a glob-scoped instruction to matching paths only", () => {
    const configuration = configurationWith({
      instructions: [instruction("api", ".claude/rules/api.md", appliesToPaths(["src/api/**/*.ts", "lib/**/*.ts"]))],
    });

    const matched = resolveForPath(configuration, "src/api/handlers/users.ts");
    expect(matched.instructions).toHaveLength(1);
    expect(matched.instructions[0].reason).toMatchObject({
      kind: "paths",
      detail: "src/api/handlers/users.ts matches src/api/**/*.ts",
    });

    const missed = resolveForPath(configuration, "src/ui/Button.tsx");
    expect(missed.instructions).toHaveLength(0);
    expect(missed.excluded[0].reason.kind).toBe("no-pattern-match");
  });

  it("records only the matching patterns, not every declared pattern", () => {
    const configuration = configurationWith({
      instructions: [instruction("api", ".claude/rules/api.md", appliesToPaths(["**/*.ts", "src/**", "docs/**"]))],
    });

    const result = resolveForPath(configuration, "src/api/x.ts");
    expect(result.instructions[0].reason).toMatchObject({ patterns: ["**/*.ts", "src/**"] });
  });

  it("ranks a glob-scoped node by its most specific matching pattern", () => {
    const configuration = configurationWith({
      instructions: [instruction("api", ".claude/rules/api.md", appliesToPaths(["**/*.ts", "src/api/**/*.ts"]))],
    });

    expect(resolveForPath(configuration, "src/api/x.ts").instructions[0].rank.pattern).toBe("src/api/**/*.ts");
  });

  it("never applies a manual-only node automatically", () => {
    const configuration = configurationWith({ skills: [skill("deploy", MANUAL)] });
    const result = resolveForPath(configuration, "src/x.ts");

    expect(result.skills).toHaveLength(0);
    expect(result.excluded[0].reason.kind).toBe("manual-only");
  });

  it("makes a model-selected skill available everywhere", () => {
    const configuration = configurationWith({ skills: [skill("review", MODEL_SELECTED)] });
    const result = resolveForPath(configuration, "anything/at/all.md");

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].reason.kind).toBe("model-selected");
  });

  it("narrows a path-scoped skill to matching paths", () => {
    const configuration = configurationWith({ skills: [skill("rn", appliesToPaths(["apps/mobile/**"]))] });

    expect(resolveForPath(configuration, "apps/mobile/src/Login.tsx").skills).toHaveLength(1);
    expect(resolveForPath(configuration, "apps/web/src/Login.tsx").skills).toHaveLength(0);
  });
});

describe("resolution order", () => {
  it("puts a deeper directory after a shallower one", () => {
    const configuration = configurationWith({
      instructions: [
        instruction("deep", "apps/mobile/src/AGENTS.md", appliesToDirectory("apps/mobile/src")),
        instruction("root", "AGENTS.md", ALWAYS),
        instruction("mid", "apps/mobile/AGENTS.md", appliesToDirectory("apps/mobile")),
      ],
    });

    const result = resolveForPath(configuration, "apps/mobile/src/Login.tsx");
    expect(result.instructions.map((entry) => entry.node.id)).toEqual(["root", "mid", "deep"]);
  });

  it("orders by scope before depth", () => {
    const configuration = configurationWith({
      instructions: [
        instruction("local", "ai.override.yaml", ALWAYS, "local"),
        instruction("managed", "policy/AGENTS.md", ALWAYS, "managed"),
        instruction("project", "AGENTS.md", ALWAYS, "project"),
        instruction("user", "user/AGENTS.md", ALWAYS, "user"),
      ],
    });

    const result = resolveForPath(configuration, "src/x.ts");
    expect(result.instructions.map((entry) => entry.node.id)).toEqual(["managed", "user", "project", "local"]);
  });

  it("puts a glob-scoped node after an unconditional one at the same depth", () => {
    const configuration = configurationWith({
      instructions: [
        instruction("scoped", ".claude/rules/api.md", appliesToPaths(["src/**/*.ts"])),
        instruction("always", ".claude/rules/general.md", ALWAYS),
      ],
    });

    // Both live in .claude/rules, so depth ties and the tier decides.
    const result = resolveForPath(configuration, "src/api/x.ts");
    expect(result.instructions.map((entry) => entry.node.id)).toEqual(["always", "scoped"]);
  });

  it("orders two glob-scoped nodes by pattern specificity", () => {
    const configuration = configurationWith({
      instructions: [
        instruction("broad", ".claude/rules/a.md", appliesToPaths(["**/*.ts"])),
        instruction("narrow", ".claude/rules/b.md", appliesToPaths(["src/api/**/*.ts"])),
      ],
    });

    const result = resolveForPath(configuration, "src/api/x.ts");
    expect(result.instructions.map((entry) => entry.node.id)).toEqual(["broad", "narrow"]);
  });

  it("falls back to declaration order so the result is always total", () => {
    const configuration = configurationWith({
      instructions: [instruction("first", "AGENTS.md", ALWAYS), instruction("second", "AGENTS.md", ALWAYS)],
    });

    const result = resolveForPath(configuration, "src/x.ts");
    expect(result.instructions.map((entry) => entry.node.id)).toEqual(["first", "second"]);
  });

  it("is stable regardless of input order", () => {
    const nodes = [
      instruction("root", "AGENTS.md", ALWAYS),
      instruction("mid", "apps/AGENTS.md", appliesToDirectory("apps")),
      instruction("deep", "apps/mobile/AGENTS.md", appliesToDirectory("apps/mobile")),
    ];

    const forward = resolveForPath(configurationWith({ instructions: nodes }), "apps/mobile/x.ts");
    const reversed = resolveForPath(configurationWith({ instructions: [...nodes].reverse() }), "apps/mobile/x.ts");

    expect(forward.instructions.map((entry) => entry.node.id)).toEqual(
      reversed.instructions.map((entry) => entry.node.id),
    );
  });
});

describe("path normalisation at the boundary", () => {
  it("accepts a path with a leading ./ or Windows separators", () => {
    const configuration = configurationWith({
      instructions: [instruction("mobile", "apps/mobile/AGENTS.md", appliesToDirectory("apps/mobile"))],
    });

    expect(resolveForPath(configuration, "./apps/mobile/src/Login.tsx").instructions).toHaveLength(1);
    expect(resolveForPath(configuration, "apps\\mobile\\src\\Login.tsx").instructions).toHaveLength(1);
    expect(resolveForPath(configuration, "apps/mobile/src/Login.tsx").path).toBe("apps/mobile/src/Login.tsx");
  });
});

describe("non-path-scoped node kinds", () => {
  it("passes through kinds that no verified platform scopes by path", () => {
    const configuration = configurationWith({
      subagents: [
        {
          name: "reviewer",
          description: "reviews code",
          body: "",
          provenance: {
            file: ".claude/agents/reviewer.md",
            platform: "claude",
            scope: "project",
            origin: "declared",
          },
        },
      ],
      mcpServers: [
        {
          name: "db",
          transport: "stdio",
          command: "npx",
          provenance: { file: ".mcp.json", platform: "claude", scope: "project", origin: "declared" },
        },
      ],
    });

    const result = resolveForPath(configuration, "src/x.ts");
    expect(result.subagents).toHaveLength(1);
    expect(result.mcpServers).toHaveLength(1);
  });
});

describe("normalizeDirectiveText", () => {
  it("ignores case, whitespace runs, and trailing punctuation", () => {
    expect(normalizeDirectiveText("  Use   PNPM, not npm.  ")).toBe("use pnpm, not npm");
  });

  it("keeps genuinely different statements distinct", () => {
    expect(normalizeDirectiveText("use pnpm")).not.toBe(normalizeDirectiveText("use npm"));
  });
});

describe("duplicate detection (AGF302)", () => {
  it("reports an instruction that reaches a path from two files", () => {
    const configuration = configurationWith({
      directives: [
        directive("Use pnpm", "AGENTS.md", ALWAYS, 4),
        directive("use  pnpm.", "apps/mobile/AGENTS.md", appliesToDirectory("apps/mobile"), 9),
      ],
    });

    const result = resolveForPath(configuration, "apps/mobile/src/Login.tsx");
    expect(result.diagnostics).toHaveLength(1);

    const [found] = result.diagnostics;
    expect(found.code).toBe("AGF302");
    expect(found.severity).toBe("warning");
    expect(found.location).toEqual({ file: "AGENTS.md", line: 4 });
    expect(found.related?.[0].location).toEqual({ file: "apps/mobile/AGENTS.md", line: 9 });
    expect(found.data).toEqual({ text: "Use pnpm", copies: 2, platforms: "agentfile" });
  });

  it("does not report repetition inside a single file", () => {
    const configuration = configurationWith({
      directives: [directive("Use pnpm", "AGENTS.md"), directive("Use pnpm", "AGENTS.md")],
    });

    expect(resolveForPath(configuration, "src/x.ts").diagnostics).toHaveLength(0);
  });

  it("does not report duplicates that never reach the same path", () => {
    const configuration = configurationWith({
      directives: [
        directive("Use pnpm", "apps/mobile/AGENTS.md", appliesToDirectory("apps/mobile")),
        directive("Use pnpm", "apps/web/AGENTS.md", appliesToDirectory("apps/web")),
      ],
    });

    expect(resolveForPath(configuration, "apps/mobile/src/x.ts").diagnostics).toHaveLength(0);
  });

  it("names the platforms when the copies span several, since that is the drift risk", () => {
    const cursor = directive("Use pnpm", ".cursor/rules/main.mdc");
    cursor.provenance.platform = "cursor";
    const copilot = directive("Use pnpm", ".github/copilot-instructions.md");
    copilot.provenance.platform = "copilot";

    const result = resolveForPath(configurationWith({ directives: [cursor, copilot] }), "src/x.ts");
    const [found] = result.diagnostics;

    expect(found.explanation).toContain("maintained separately for copilot, cursor");
    expect(found.data).toMatchObject({ platforms: "copilot,cursor" });
  });

  it("can be switched off", () => {
    const configuration = configurationWith({
      directives: [directive("Use pnpm", "AGENTS.md"), directive("Use pnpm", "apps/AGENTS.md")],
    });

    expect(resolveForPath(configuration, "src/x.ts", { detectDuplicates: false }).diagnostics).toHaveLength(0);
  });
});

describe("explainInstruction", () => {
  const configuration = configurationWith({
    instructions: [
      instruction("root", "AGENTS.md", ALWAYS),
      instruction("mobile", "apps/mobile/AGENTS.md", appliesToDirectory("apps/mobile")),
    ],
  });

  it("explains an applied instruction and what outranks it", () => {
    const result = resolveForPath(configuration, "apps/mobile/src/Login.tsx");
    const explanation = explainInstruction(result, "root");

    expect(explanation?.applies).toBe(true);
    expect(explanation?.reason).toBe("loaded unconditionally");
    expect(explanation?.source.file).toBe("AGENTS.md");
    expect(explanation?.outrankedBy).toEqual(["mobile"]);
  });

  it("explains why an instruction does not apply", () => {
    const result = resolveForPath(configuration, "apps/web/src/Login.tsx");
    const explanation = explainInstruction(result, "mobile");

    expect(explanation?.applies).toBe(false);
    expect(explanation?.reason).toContain("is not inside apps/mobile");
  });

  it("returns undefined for an unknown instruction", () => {
    const result = resolveForPath(configuration, "src/x.ts");
    expect(explainInstruction(result, "nope")).toBeUndefined();
  });
});
