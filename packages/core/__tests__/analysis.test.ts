import { describe, expect, it } from "vitest";
import {
  alwaysLoadedContext,
  analyzeSkillRouting,
  CHARACTERS_PER_TOKEN,
  contextBudgetDiagnostics,
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  deriveDirectives,
  estimateContext,
  findInstructionOverlap,
  isAlwaysLoaded,
  normalizeInstructionLine,
  overlapDiagnostics,
} from "../src/analysis/index.ts";
import type { AgentConfiguration, Instruction, PlatformId, SkillEntry } from "../src/ir/index.ts";
import { ALWAYS, appliesToDirectory, appliesToPaths, emptyConfiguration, MODEL_SELECTED } from "../src/ir/index.ts";

const ROOT = "/repo";

function instruction(
  file: string,
  body: string,
  options: { applies?: Instruction["applies"]; platform?: PlatformId; bodyLine?: number } = {},
): Instruction {
  return {
    id: `instruction:${file}`,
    title: file,
    body,
    bodyLine: options.bodyLine,
    applies: options.applies ?? ALWAYS,
    provenance: {
      file,
      platform: options.platform ?? "agents-md",
      scope: "project",
      origin: "declared",
    },
  };
}

function configurationWith(overrides: Partial<AgentConfiguration>): AgentConfiguration {
  return { ...emptyConfiguration(ROOT), ...overrides };
}

// ─── Context estimates ─────────────────────────────────────────────────────

describe("estimateContext", () => {
  it("measures characters and lines exactly", () => {
    const estimate = estimateContext("one\ntwo\nthree");
    expect(estimate.characters).toBe(13);
    expect(estimate.lines).toBe(3);
  });

  it("labels the token figure as an estimate and says how it was derived", () => {
    const estimate = estimateContext("x".repeat(400));
    expect(estimate.estimatedTokens).toBe(400 / CHARACTERS_PER_TOKEN);
    expect(estimate.method).toBe("characters-per-token-heuristic");
    expect(estimate.charactersPerToken).toBe(CHARACTERS_PER_TOKEN);
  });

  it("sums across several pieces of text", () => {
    expect(estimateContext(["abc", "de"]).characters).toBe(5);
  });

  it("handles empty input", () => {
    expect(estimateContext("")).toMatchObject({ characters: 0, lines: 0, estimatedTokens: 0 });
    expect(estimateContext([])).toMatchObject({ characters: 0, lines: 0 });
  });
});

describe("isAlwaysLoaded", () => {
  it("counts unconditional instructions", () => {
    expect(isAlwaysLoaded(instruction("AGENTS.md", "x"))).toBe(true);
  });

  it("counts a root-directory scope, whose subtree is the whole repository", () => {
    expect(isAlwaysLoaded(instruction("AGENTS.md", "x", { applies: appliesToDirectory("") }))).toBe(true);
  });

  it("does not count a subdirectory scope", () => {
    expect(isAlwaysLoaded(instruction("apps/web/AGENTS.md", "x", { applies: appliesToDirectory("apps/web") }))).toBe(
      false,
    );
  });

  it("does not count a glob scope", () => {
    expect(isAlwaysLoaded(instruction("r.md", "x", { applies: appliesToPaths(["src/**"]) }))).toBe(false);
  });
});

describe("alwaysLoadedContext", () => {
  it("sums only what loads in every session", () => {
    const always = alwaysLoadedContext(
      configurationWith({
        instructions: [
          instruction("AGENTS.md", "always loaded"),
          instruction("apps/web/AGENTS.md", "scoped away", { applies: appliesToDirectory("apps/web") }),
        ],
      }),
    );

    expect(always.files).toEqual(["AGENTS.md"]);
    expect(always.estimate.characters).toBe("always loaded".length);
  });

  it("counts rules that apply everywhere", () => {
    const always = alwaysLoadedContext(
      configurationWith({
        directives: [
          {
            id: "a",
            text: "Use pnpm",
            applies: ALWAYS,
            provenance: { file: "ai/contract.yaml", platform: "agentfile", scope: "project", origin: "declared" },
          },
          {
            id: "b",
            text: "Mobile only",
            applies: appliesToDirectory("apps/mobile"),
            provenance: { file: "m/contract.yaml", platform: "agentfile", scope: "directory", origin: "declared" },
          },
        ],
      }),
    );

    expect(always.alwaysLoadedDirectives).toBe(1);
  });

  it("deduplicates files", () => {
    const always = alwaysLoadedContext(
      configurationWith({ instructions: [instruction("AGENTS.md", "a"), instruction("AGENTS.md", "b")] }),
    );
    expect(always.files).toEqual(["AGENTS.md"]);
  });
});

// ─── Skill routing ─────────────────────────────────────────────────────────

function skill(name: string, description: string): SkillEntry {
  return {
    name,
    description,
    body: "",
    resources: [],
    applies: MODEL_SELECTED,
    provenance: { file: `.claude/skills/${name}/SKILL.md`, platform: "claude", scope: "project", origin: "declared" },
  };
}

describe("analyzeSkillRouting", () => {
  it("accepts a description that says what and when", () => {
    const [signal] = analyzeSkillRouting(
      configurationWith({
        skills: [
          skill(
            "pdf",
            "Extracts text and tables from PDF files. Use when the user mentions PDFs or document extraction.",
          ),
        ],
      }),
    );

    expect(signal.problems).toEqual([]);
  });

  it("flags a missing description", () => {
    const [signal] = analyzeSkillRouting(configurationWith({ skills: [skill("deploy", "")] }));
    expect(signal.problems[0]).toContain("no description");
  });

  it("flags a description too short to distinguish the skill", () => {
    const [signal] = analyzeSkillRouting(configurationWith({ skills: [skill("deploy", "Deploys stuff.")] }));
    expect(signal.problems.some((problem) => problem.includes("too short"))).toBe(true);
  });

  it("flags a description that never says when to use the skill", () => {
    const [signal] = analyzeSkillRouting(
      configurationWith({
        skills: [skill("deploy", "Deploys the application to production and then notifies the team channel.")],
      }),
    );

    expect(signal.problems.some((problem) => problem.includes("not when to use it"))).toBe(true);
  });

  it("flags a description over the specification limit", () => {
    const [signal] = analyzeSkillRouting(configurationWith({ skills: [skill("big", `Use when ${"x".repeat(1100)}`)] }));

    expect(signal.problems.some((problem) => problem.includes("1024-character"))).toBe(true);
  });
});

// ─── Derivation ────────────────────────────────────────────────────────────

describe("deriveDirectives", () => {
  it("extracts bullets as directives", () => {
    const derived = deriveDirectives(
      instruction("AGENTS.md", "- Use pnpm as the package manager\n- Prefer small composable functions"),
    );

    expect(derived.map((entry) => entry.text)).toEqual([
      "Use pnpm as the package manager",
      "Prefer small composable functions",
    ]);
  });

  it("marks derived directives as derived, never declared", () => {
    const [derived] = deriveDirectives(instruction("AGENTS.md", "- Use pnpm as the package manager"));
    expect(derived.provenance.origin).toBe("derived");
    expect(derived.provenance.note).toContain("derived from a bullet");
  });

  it("uses the nearest heading as the category", () => {
    const derived = deriveDirectives(
      instruction(
        "AGENTS.md",
        "## Coding\n\n- Use pnpm as the package manager\n\n## Testing\n\n- Run tests before push",
      ),
    );

    expect(derived.map((entry) => entry.category)).toEqual(["coding", "testing"]);
  });

  it("records the line each bullet came from", () => {
    const derived = deriveDirectives(instruction("AGENTS.md", "# Title\n\n- Use pnpm as the package manager"));
    expect(derived[0].provenance.line).toBe(3);
  });

  it("offsets lines by the body start, so frontmatter does not shift positions", () => {
    const derived = deriveDirectives(instruction("r.md", "- Use pnpm as the package manager", { bodyLine: 5 }));
    expect(derived[0].provenance.line).toBe(5);
  });

  it("ignores bullets inside code blocks", () => {
    const derived = deriveDirectives(
      instruction("AGENTS.md", "```\n- Use pnpm as the package manager\n```\n- Real rule about formatting here"),
    );

    expect(derived.map((entry) => entry.text)).toEqual(["Real rule about formatting here"]);
  });

  it("ignores bullets that are just links or paths", () => {
    const derived = deriveDirectives(
      instruction("AGENTS.md", "- [the handbook](https://example.com/handbook)\n- docs/architecture.md"),
    );

    expect(derived).toEqual([]);
  });

  it("ignores fragments too short to be a rule", () => {
    expect(deriveDirectives(instruction("AGENTS.md", "- see below"))).toEqual([]);
  });

  it("strips a bold label prefix, which is structure rather than instruction", () => {
    const [derived] = deriveDirectives(instruction("AGENTS.md", "- **Package manager:** use pnpm and never npm"));
    expect(derived.text).toBe("use pnpm and never npm");
  });

  it("extracts numbered items too", () => {
    const derived = deriveDirectives(instruction("AGENTS.md", "1. Create the component file first\n2) Then its test"));
    expect(derived).toHaveLength(2);
  });

  it("inherits the instruction's applicability", () => {
    const [derived] = deriveDirectives(
      instruction("apps/web/AGENTS.md", "- Use pnpm as the package manager", {
        applies: appliesToDirectory("apps/web"),
      }),
    );

    expect(derived.applies).toEqual({ kind: "directory", directory: "apps/web" });
  });

  it("gives derived directives unique ids", () => {
    const derived = deriveDirectives(
      instruction("AGENTS.md", "- Use pnpm as the package manager\n- Prefer small composable functions"),
    );
    expect(new Set(derived.map((entry) => entry.id)).size).toBe(2);
  });
});

// ─── Overlap ───────────────────────────────────────────────────────────────

describe("normalizeInstructionLine", () => {
  it("ignores list markers, emphasis, case, and trailing punctuation", () => {
    expect(normalizeInstructionLine("- **Use PNPM** as the package manager.")).toBe("use pnpm as the package manager");
    expect(normalizeInstructionLine("1. use   pnpm as the package manager")).toBe("use pnpm as the package manager");
  });

  it("keeps different statements distinct", () => {
    expect(normalizeInstructionLine("- use pnpm")).not.toBe(normalizeInstructionLine("- use npm"));
  });
});

describe("findInstructionOverlap", () => {
  it("finds text shared between two files", () => {
    const overlaps = findInstructionOverlap([
      instruction("AGENTS.md", "- Use pnpm as the package manager"),
      instruction(".github/copilot-instructions.md", "Use pnpm as the package manager", { platform: "copilot" }),
    ]);

    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].files).toEqual([".github/copilot-instructions.md", "AGENTS.md"]);
    expect(overlaps[0].platforms).toEqual(["agents-md", "copilot"]);
  });

  it("ignores text that appears in only one file", () => {
    expect(
      findInstructionOverlap([
        instruction("AGENTS.md", "- Use pnpm as the package manager"),
        instruction("CLAUDE.md", "- Prefer small composable functions", { platform: "claude" }),
      ]),
    ).toEqual([]);
  });

  it("does not treat a file repeating itself as cross-file duplication", () => {
    expect(
      findInstructionOverlap([
        instruction("AGENTS.md", "- Use pnpm as the package manager\n- Use pnpm as the package manager"),
      ]),
    ).toEqual([]);
  });

  it("ignores headings and structural lines", () => {
    expect(
      findInstructionOverlap([
        instruction("AGENTS.md", "## Coding Standards And Conventions\n---\n| a | b |"),
        instruction("CLAUDE.md", "## Coding Standards And Conventions\n---\n| a | b |", { platform: "claude" }),
      ]),
    ).toEqual([]);
  });

  it("ignores lines too short to be a meaningful match", () => {
    expect(
      findInstructionOverlap([
        instruction("AGENTS.md", "- be nice"),
        instruction("CLAUDE.md", "- be nice", { platform: "claude" }),
      ]),
    ).toEqual([]);
  });

  it("groups many shared lines between the same files into one finding", () => {
    const body = [
      "- Use pnpm as the package manager",
      "- Prefer small composable functions everywhere",
      "- Run the full test suite before pushing",
    ].join("\n");

    const overlaps = findInstructionOverlap([
      instruction("AGENTS.md", body),
      instruction("CLAUDE.md", body, { platform: "claude" }),
    ]);

    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].sharedLines).toHaveLength(3);
  });

  it("separates findings when different file sets are involved", () => {
    const overlaps = findInstructionOverlap([
      instruction("a.md", "- Use pnpm as the package manager"),
      instruction("b.md", "- Use pnpm as the package manager", { platform: "claude" }),
      instruction("c.md", "- Run the full test suite before pushing", { platform: "cursor" }),
      instruction("d.md", "- Run the full test suite before pushing", { platform: "copilot" }),
    ]);

    expect(overlaps.map((overlap) => overlap.files)).toEqual([
      ["a.md", "b.md"],
      ["c.md", "d.md"],
    ]);
  });
});

describe("overlapDiagnostics", () => {
  const overlaps = findInstructionOverlap([
    instruction("AGENTS.md", "- Use pnpm as the package manager"),
    instruction(".cursor/rules/main.mdc", "Use pnpm as the package manager", { platform: "cursor", bodyLine: 4 }),
  ]);

  it("reports AGF302 with the quoted instruction, marker stripped", () => {
    const [found] = overlapDiagnostics(overlaps);

    expect(found.code).toBe("AGF302");
    expect(found.severity).toBe("warning");
    expect(found.message).toContain('"Use pnpm as the package manager"');
    expect(found.message).not.toContain('"- Use');
  });

  it("points at each file's own copy, never one file's name with another's line", () => {
    const [found] = overlapDiagnostics(overlaps);
    const locations = [found.location, ...(found.related ?? []).map((entry) => entry.location)];

    for (const location of locations) {
      expect(location?.line, `${location?.file} has no line`).toBeGreaterThan(0);
    }

    const cursor = locations.find((location) => location?.file === ".cursor/rules/main.mdc");
    expect(cursor?.line).toBe(4);
  });

  it("says the rules are maintained per platform, which is the drift risk", () => {
    const [found] = overlapDiagnostics(overlaps);
    expect(found.explanation).toContain("maintained separately for agents-md, cursor");
    expect(found.suggestion).toContain("one source");
  });

  it("summarises rather than quoting every line when there are many", () => {
    const body = Array.from({ length: 9 }, (_, index) => `- Rule number ${index} about formatting`).join("\n");
    const [found] = overlapDiagnostics(
      findInstructionOverlap([instruction("a.md", body), instruction("b.md", body, { platform: "claude" })]),
    );

    expect(found.message).toContain("9 duplicated instruction lines");
    expect(found.explanation).toContain("and 4 more lines");
  });

  it("carries machine-readable counts", () => {
    const [found] = overlapDiagnostics(overlaps);
    expect(found.data).toMatchObject({ sharedLines: 1, platforms: "agents-md,cursor" });
  });
});

// ─── Context budget ────────────────────────────────────────────────────────

describe("contextBudgetDiagnostics", () => {
  function configurationOfSize(characters: number, file = "AGENTS.md"): AgentConfiguration {
    const configuration = emptyConfiguration(ROOT);
    configuration.instructions.push(instruction(file, "x".repeat(characters)));
    return configuration;
  }

  it("reports nothing while always-loaded context is inside the budget", () => {
    expect(contextBudgetDiagnostics(configurationOfSize(100))).toEqual([]);
  });

  it("reports AGF401 once the budget is exceeded", () => {
    const overBudget = (DEFAULT_CONTEXT_BUDGET_TOKENS + 100) * CHARACTERS_PER_TOKEN;
    const [found] = contextBudgetDiagnostics(configurationOfSize(overBudget));

    expect(found.code).toBe("AGF401");
    expect(found.severity).toBe("warning");
    expect(found.data?.budgetTokens).toBe(DEFAULT_CONTEXT_BUDGET_TOKENS);
  });

  it("honours a caller-supplied budget", () => {
    expect(contextBudgetDiagnostics(configurationOfSize(400), { budgetTokens: 10 })).toHaveLength(1);
    expect(contextBudgetDiagnostics(configurationOfSize(400), { budgetTokens: 10_000 })).toEqual([]);
  });

  it("names the largest contributors, since a total alone is not actionable", () => {
    const configuration = emptyConfiguration(ROOT);
    configuration.instructions.push(instruction("small.md", "x".repeat(200)));
    configuration.instructions.push(instruction("huge.md", "x".repeat(40_000)));

    const [found] = contextBudgetDiagnostics(configuration);
    expect(found.explanation).toContain("huge.md");
    // Largest first.
    expect(found.explanation?.indexOf("huge.md")).toBeLessThan(found.explanation?.indexOf("small.md") ?? -1);
  });

  it("says the figure is an estimate and the budget is not a platform limit", () => {
    const [found] = contextBudgetDiagnostics(configurationOfSize(40_000));
    expect(found.explanation).toContain("estimated from character length");
    expect(found.explanation).toContain("not a limit imposed by");
    expect(found.data?.method).toBe("characters-per-token-heuristic");
  });

  it("ignores context that only loads for specific paths", () => {
    const configuration = emptyConfiguration(ROOT);
    configuration.instructions.push(
      instruction("scoped.md", "x".repeat(40_000), { applies: appliesToPaths(["src/**"]) }),
    );

    expect(contextBudgetDiagnostics(configuration)).toEqual([]);
  });
});
