import { describe, expect, it } from "vitest";
import { describeScope, findScopeMismatches, scopeMismatchDiagnostics, scopeSignature } from "../src/analysis/index.ts";
import {
  ALWAYS,
  type Applicability,
  appliesToDirectory,
  appliesToPaths,
  type Instruction,
  MANUAL,
  MODEL_SELECTED,
  nodeId,
} from "../src/ir/index.ts";

function instruction(file: string, platform: string, applies: Applicability, body: string): Instruction {
  const provenance = { file, platform, scope: "project" as const, origin: "declared" as const };
  return { id: nodeId("instruction", provenance), body, applies, provenance };
}

const RULE = "Always validate input at the API boundary before trusting it";

describe("scopeSignature", () => {
  it("treats an unconditional scope and a root directory scope as the same thing", () => {
    // Everything is inside the repository root, so these are one statement. If
    // they differed, every root AGENTS.md/CLAUDE.md pair would report a
    // mismatch that does not exist.
    expect(scopeSignature(ALWAYS)).toBe(scopeSignature(appliesToDirectory("")));
  });

  it("distinguishes a subtree from the root", () => {
    expect(scopeSignature(appliesToDirectory("apps/web"))).not.toBe(scopeSignature(ALWAYS));
  });

  it("is order-insensitive for glob lists", () => {
    expect(scopeSignature(appliesToPaths(["b/**", "a/**"]))).toBe(scopeSignature(appliesToPaths(["a/**", "b/**"])));
  });

  it("separates model-selected from manual", () => {
    expect(scopeSignature(MODEL_SELECTED)).not.toBe(scopeSignature(MANUAL));
  });
});

describe("describeScope", () => {
  it("phrases every variant for a developer", () => {
    expect(describeScope(ALWAYS)).toBe("applies unconditionally");
    expect(describeScope(appliesToDirectory(""))).toBe("applies unconditionally");
    expect(describeScope(appliesToDirectory("apps/web"))).toBe("applies only under apps/web/");
    expect(describeScope(appliesToPaths(["src/**"]))).toBe("applies only to src/**");
    expect(describeScope(MODEL_SELECTED)).toContain("agent selects it");
    expect(describeScope(MANUAL)).toContain("invoked explicitly");
  });
});

describe("findScopeMismatches", () => {
  it("finds a rule that is unconditional in one file and glob-scoped in another", () => {
    const found = findScopeMismatches([
      instruction("AGENTS.md", "agents-md", ALWAYS, RULE),
      instruction(".cursor/rules/api.mdc", "cursor", appliesToPaths(["src/api/**"]), RULE),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0].scopes.map((scope) => scope.signature).sort()).toEqual(["always", "paths:src/api/**"]);
  });

  it("reports nothing when both copies agree on scope", () => {
    expect(
      findScopeMismatches([
        instruction("AGENTS.md", "agents-md", ALWAYS, RULE),
        instruction("CLAUDE.md", "claude", ALWAYS, RULE),
      ]),
    ).toEqual([]);
  });

  it("does not report a root AGENTS.md against a root directory-scoped file", () => {
    expect(
      findScopeMismatches([
        instruction("AGENTS.md", "agents-md", ALWAYS, RULE),
        instruction("CLAUDE.md", "claude", appliesToDirectory(""), RULE),
      ]),
    ).toEqual([]);
  });

  it("ignores text that appears in only one file", () => {
    expect(
      findScopeMismatches([
        instruction("AGENTS.md", "agents-md", ALWAYS, RULE),
        instruction(".cursor/rules/api.mdc", "cursor", appliesToPaths(["src/**"]), "Something else entirely here"),
      ]),
    ).toEqual([]);
  });

  it("groups several disagreeing lines between the same files into one finding", () => {
    const body = `${RULE}\nRun the full test suite before pushing to a shared branch`;
    const found = findScopeMismatches([
      instruction("AGENTS.md", "agents-md", ALWAYS, body),
      instruction(".cursor/rules/api.mdc", "cursor", appliesToPaths(["src/api/**"]), body),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0].sharedLines).toHaveLength(2);
  });
});

describe("scopeMismatchDiagnostics", () => {
  it("names each file's own scope and points at each file's own line", () => {
    const [found] = scopeMismatchDiagnostics(
      findScopeMismatches([
        instruction("AGENTS.md", "agents-md", ALWAYS, RULE),
        instruction(".cursor/rules/api.mdc", "cursor", appliesToPaths(["src/api/**"]), RULE),
      ]),
    );

    expect(found.code).toBe("AGF304");
    expect(found.severity).toBe("warning");
    expect(found.explanation).toContain("AGENTS.md (agents-md) — applies unconditionally");
    expect(found.explanation).toContain(".cursor/rules/api.mdc (cursor) — applies only to src/api/**");
    expect(found.related?.[0].location.file).toBe(".cursor/rules/api.mdc");
    expect(found.data?.scopes).toContain("always");
  });
});
