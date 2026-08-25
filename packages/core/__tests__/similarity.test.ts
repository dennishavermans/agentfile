import { describe, expect, it } from "vitest";
import {
  findNearDuplicateInstructions,
  hasNegation,
  jaccardSimilarity,
  nearDuplicateDiagnostics,
  tokenize,
} from "../src/analysis/index.ts";
import { ALWAYS, type Instruction, nodeId } from "../src/ir/index.ts";

function instruction(file: string, platform: string, body: string): Instruction {
  const provenance = { file, platform, scope: "project" as const, origin: "declared" as const };
  return { id: nodeId("instruction", provenance), body, applies: ALWAYS, provenance };
}

describe("tokenize", () => {
  it("drops function words but never negations or modality", () => {
    expect(tokenize("always use the pnpm package manager")).toEqual(["always", "use", "pnpm", "package", "manager"]);
    expect(tokenize("do not use npm")).toContain("not");
    expect(tokenize("never commit secrets")).toContain("never");
    expect(tokenize("this must be reviewed")).toContain("must");
  });

  it("treats an apostrophe as part of the word", () => {
    expect(tokenize("dont use npm")).toEqual(tokenize("don't use npm"));
  });
});

describe("jaccardSimilarity", () => {
  it("is 1 for identical sets and 0 for disjoint ones", () => {
    expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(jaccardSimilarity(new Set(["a"]), new Set(["b"]))).toBe(0);
  });

  it("is |intersection| / |union|", () => {
    expect(jaccardSimilarity(new Set(["a", "b", "c"]), new Set(["b", "c", "d"]))).toBeCloseTo(2 / 4);
  });

  it("returns 0 rather than dividing by zero on two empty sets", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });
});

describe("hasNegation", () => {
  it("detects negation with or without an apostrophe", () => {
    expect(hasNegation("do not use npm")).toBe(true);
    expect(hasNegation("dont use npm")).toBe(true);
    expect(hasNegation("never use npm")).toBe(true);
    expect(hasNegation("avoid using npm")).toBe(true);
    expect(hasNegation("always use pnpm")).toBe(false);
  });

  it("does not treat a preference as a negation", () => {
    // "Prefer X" and "Use X" are near-duplicates worth reporting, so a
    // preference marker must not split them into different polarities.
    expect(hasNegation("prefer small composable functions")).toBe(false);
  });
});

describe("findNearDuplicateInstructions", () => {
  it("finds a copy that has been edited in one place only", () => {
    const { pairs } = findNearDuplicateInstructions([
      instruction("AGENTS.md", "agents-md", "- Use pnpm as the package manager, never npm or yarn"),
      instruction(".github/copilot-instructions.md", "copilot", "Use pnpm as the package manager, never npm."),
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].similarity).toBeGreaterThan(0.6);
    expect(pairs[0].a.file).toBe("AGENTS.md");
    expect(pairs[0].b.file).toBe(".github/copilot-instructions.md");
  });

  it("leaves exact duplicates to AGF302", () => {
    const line = "- Run the full test suite before pushing to a shared branch";
    const { pairs } = findNearDuplicateInstructions([
      instruction("AGENTS.md", "agents-md", line),
      instruction("CLAUDE.md", "claude", line),
    ]);

    expect(pairs).toEqual([]);
  });

  it("never pairs two lines that contradict each other", () => {
    // Same words, opposite meaning. Reporting this as a duplicate would send a
    // developer to delete one of them.
    const { pairs } = findNearDuplicateInstructions([
      instruction("AGENTS.md", "agents-md", "Always run the migration script before deploying to production"),
      instruction("CLAUDE.md", "claude", "Never run the migration script before deploying to production"),
    ]);

    expect(pairs).toEqual([]);
  });

  it("does not pair lines that mean the same thing in different words", () => {
    // Documented limitation: similarity is measured on words, not meaning.
    const { pairs } = findNearDuplicateInstructions([
      instruction("AGENTS.md", "agents-md", "Use pnpm as the package manager for every workspace"),
      instruction("CLAUDE.md", "claude", "npm and yarn are forbidden in this repository entirely"),
    ]);

    expect(pairs).toEqual([]);
  });

  it("ignores repetition inside one file by default", () => {
    const { pairs } = findNearDuplicateInstructions([
      instruction(
        "AGENTS.md",
        "agents-md",
        "- Use pnpm as the package manager, never npm\n- Use pnpm as the package manager, never yarn",
      ),
    ]);

    expect(pairs).toEqual([]);
  });

  it("compares within one file when asked", () => {
    const { pairs } = findNearDuplicateInstructions(
      [
        instruction(
          "AGENTS.md",
          "agents-md",
          "- Use pnpm as the package manager, never npm\n- Use pnpm as the package manager, never yarn",
        ),
      ],
      { includeSameFile: true },
    );

    expect(pairs).toHaveLength(1);
  });

  it("does not pair rules that merely share vocabulary", () => {
    const { pairs } = findNearDuplicateInstructions([
      instruction("AGENTS.md", "agents-md", "Use TypeScript strict mode in every package of the workspace"),
      instruction("CLAUDE.md", "claude", "Use TypeScript project references to wire the packages together"),
    ]);

    expect(pairs).toEqual([]);
  });

  it("respects a caller-supplied threshold", () => {
    const instructions = [
      instruction("AGENTS.md", "agents-md", "Run the unit tests and the integration tests before pushing"),
      instruction("CLAUDE.md", "claude", "Run the unit tests before pushing"),
    ];

    expect(findNearDuplicateInstructions(instructions, { threshold: 0.99 }).pairs).toEqual([]);
    expect(findNearDuplicateInstructions(instructions, { threshold: 0.3 }).pairs).toHaveLength(1);
  });

  it("reports when the comparison budget stopped the search", () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      instruction(`file-${index}.md`, "agents-md", `Use pnpm as the package manager in workspace number ${index}`),
    );

    const result = findNearDuplicateInstructions(many, { maxComparisons: 5 });
    expect(result.truncated).toBe(true);
    expect(result.comparisons).toBe(5);
  });

  it("orders pairs strongest first, then by location", () => {
    const { pairs } = findNearDuplicateInstructions([
      instruction("a.md", "agents-md", "Run the unit tests and the integration tests before pushing anything"),
      instruction("b.md", "claude", "Run the unit tests before pushing anything"),
      instruction("c.md", "cursor", "Run the unit tests and the integration tests before pushing"),
    ]);

    expect(pairs.length).toBeGreaterThan(1);
    for (let index = 1; index < pairs.length; index++) {
      expect(pairs[index - 1].similarity).toBeGreaterThanOrEqual(pairs[index].similarity);
    }
  });
});

describe("nearDuplicateDiagnostics", () => {
  it("quotes both copies with their own line numbers and names the platforms", () => {
    const { pairs } = findNearDuplicateInstructions([
      instruction("AGENTS.md", "agents-md", "- Use pnpm as the package manager, never npm or yarn"),
      instruction(".github/copilot-instructions.md", "copilot", "Use pnpm as the package manager, never npm."),
    ]);

    const [found] = nearDuplicateDiagnostics(pairs);

    expect(found.code).toBe("AGF305");
    expect(found.severity).toBe("warning");
    expect(found.location).toEqual({ file: "AGENTS.md", line: 1 });
    expect(found.related?.[0].location.file).toBe(".github/copilot-instructions.md");
    expect(found.explanation).toContain("agents-md and copilot");
    // The honest boundary has to travel with the finding.
    expect(found.explanation).toContain("not meaning");
    expect(found.data?.similarity).toBeGreaterThan(0.6);
  });

  it("strips the list marker from the quoted text", () => {
    const { pairs } = findNearDuplicateInstructions([
      instruction("AGENTS.md", "agents-md", "- Use pnpm as the package manager, never npm or yarn"),
      instruction("CLAUDE.md", "claude", "* Use pnpm as the package manager, never npm"),
    ]);

    const [found] = nearDuplicateDiagnostics(pairs);
    expect(found.message).not.toContain('"- ');
    expect(found.message).not.toContain('"* ');
  });
});
