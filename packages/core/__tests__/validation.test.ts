import { describe, expect, it } from "vitest";
import { allDiagnosticCodes, diagnosticMeta } from "../src/diagnostics/index.ts";
import { discover } from "../src/discovery/index.ts";
import { memoryFileSystem } from "../src/fs/index.ts";
import {
  CHECK_LAYERS,
  findRule,
  IMPLEMENTED_LAYERS,
  LINT_LAYERS,
  RULES,
  runValidation,
  selectRules,
} from "../src/validation/index.ts";

const ROOT = "/repo";

function run(
  files: Record<string, string>,
  options: Parameters<typeof runValidation>[0] extends infer T ? Partial<T> : never = {},
) {
  const fs = memoryFileSystem(files);
  return runValidation({ root: ROOT, fs, ...options });
}

// ─── Registry invariants ───────────────────────────────────────────────────

describe("the rule set", () => {
  it("has unique, kebab-case ids", () => {
    const ids = RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
  });

  it("only claims codes that exist in the registry", () => {
    const registered = new Set<string>(allDiagnosticCodes());
    for (const rule of RULES) {
      for (const code of rule.emits) {
        expect(registered.has(code), `${rule.id} claims unregistered ${code}`).toBe(true);
      }
    }
  });

  it("only claims codes that are active, never reserved ones", () => {
    for (const rule of RULES) {
      for (const code of rule.emits) {
        expect(diagnosticMeta(code).status, `${rule.id} claims reserved ${code}`).toBe("active");
      }
    }
  });

  it("accounts for every active code, so nothing is emitted by no rule", () => {
    const claimed = new Set(RULES.flatMap((rule) => [...rule.emits]));
    const active = allDiagnosticCodes().filter((code) => diagnosticMeta(code).status === "active");

    for (const code of active) {
      expect(claimed.has(code), `${code} is active but no rule emits it`).toBe(true);
    }
  });

  it("assigns every rule to an implemented layer", () => {
    for (const rule of RULES) {
      expect(IMPLEMENTED_LAYERS).toContain(rule.layer);
    }
  });

  it("is findable by id", () => {
    expect(findRule("context-budget")?.layer).toBe("quality");
    expect(findRule("nope")).toBeUndefined();
  });
});

// ─── Selection ─────────────────────────────────────────────────────────────

describe("selectRules", () => {
  it("gives check the structural and resolution layers only", () => {
    const { rules } = selectRules({ layers: CHECK_LAYERS });
    expect(new Set(rules.map((rule) => rule.layer))).toEqual(new Set(["structural", "resolution"]));
  });

  it("gives lint the quality layer only", () => {
    const { rules } = selectRules({ layers: LINT_LAYERS });
    expect(new Set(rules.map((rule) => rule.layer))).toEqual(new Set(["quality"]));
  });

  it("gives validate every implemented layer", () => {
    const { rules } = selectRules({});
    expect(rules).toHaveLength(RULES.length);
  });

  it("returns explicit rule ids in registry order regardless of how they were listed", () => {
    const { rules } = selectRules({ rules: ["context-budget", "configuration-integrity"] });
    expect(rules.map((rule) => rule.id)).toEqual(["configuration-integrity", "context-budget"]);
  });

  it("reports an unknown rule id rather than silently running nothing", () => {
    const { rules, unknownRules } = selectRules({ rules: ["configuration-integrity", "nope"] });
    expect(rules.map((rule) => rule.id)).toEqual(["configuration-integrity"]);
    expect(unknownRules).toEqual(["nope"]);
  });

  it("reports a selected layer that has no rules yet", () => {
    const { rules, emptyLayers } = selectRules({ layers: ["behavioral"] });
    expect(rules).toEqual([]);
    expect(emptyLayers).toEqual(["behavioral"]);
  });
});

// ─── Running ───────────────────────────────────────────────────────────────

describe("runValidation", () => {
  it("finds a duplicate rule maintained for two platforms", () => {
    const line = "- Use pnpm as the package manager, never npm\n";
    const result = run({
      [`${ROOT}/AGENTS.md`]: line,
      [`${ROOT}/.github/copilot-instructions.md`]: line,
    });

    expect(result.diagnostics.map((item) => item.code)).toContain("AGF302");
    expect(result.summary.errors).toBe(0);
    expect(result.summary.warnings).toBeGreaterThan(0);
  });

  it("surfaces structural findings through the rule set, not a side channel", () => {
    const result = run({
      [`${ROOT}/.mcp.json`]: JSON.stringify({ mcpServers: { broken: { url: "https://example.com" } } }),
      [`${ROOT}/AGENTS.md`]: "- Use pnpm as the package manager\n",
    });

    expect(result.rulesRun).toContain("configuration-integrity");
    expect(result.diagnostics.some((item) => item.code === "AGF001")).toBe(true);
    expect(result.summary.errors).toBeGreaterThan(0);
  });

  it("says that compatibility did not run when no target was named", () => {
    const result = run({ [`${ROOT}/AGENTS.md`]: "- Use pnpm as the package manager\n" });

    expect(result.rulesRun).toContain("target-compatibility");
    expect(result.skipped.map((skip) => skip.rule)).toContain("target-compatibility");
    expect(result.diagnostics.some((item) => item.code.startsWith("AGF2"))).toBe(false);
  });

  it("checks compatibility once a target is named", () => {
    const result = run(
      {
        [`${ROOT}/.claude/skills/deploy/SKILL.md`]:
          "---\nname: deploy\ndescription: Deploy when a release is cut\n---\n\nRun it.\n",
      },
      { targets: ["agents-md"] },
    );

    expect(result.skipped.map((skip) => skip.rule)).not.toContain("target-compatibility");
    expect(result.diagnostics.some((item) => item.code === "AGF201")).toBe(true);
  });

  it("promotes warnings to errors under strict, and leaves infos alone", () => {
    const files = {
      [`${ROOT}/CLAUDE.md`]: "- Use pnpm as the package manager, never npm\n",
      [`${ROOT}/AGENTS.md`]: "- Use pnpm as the package manager, never npm\n",
    };

    const relaxed = run(files, { targets: ["cursor"] });
    const strict = run(files, { targets: ["cursor"], strict: true });

    expect(relaxed.summary.warnings).toBeGreaterThan(0);
    expect(relaxed.summary.errors).toBe(0);
    expect(strict.summary.warnings).toBe(0);
    expect(strict.summary.errors).toBe(relaxed.summary.errors + relaxed.summary.warnings);
    // Info-level findings report unverified platform behaviour; a gap in
    // agentfile's own registry must not fail someone's build.
    expect(strict.summary.infos).toBe(relaxed.summary.infos);
  });

  it("honours a caller-supplied context budget", () => {
    const files = { [`${ROOT}/AGENTS.md`]: `# Rules\n\n${"- Keep functions small and focused\n".repeat(40)}` };

    expect(run(files).diagnostics.some((item) => item.code === "AGF401")).toBe(false);
    expect(run(files, { budgetTokens: 10 }).diagnostics.some((item) => item.code === "AGF401")).toBe(true);
  });

  it("returns diagnostics in the documented deterministic order", () => {
    const result = run({
      [`${ROOT}/AGENTS.md`]: "- Use pnpm as the package manager, never npm\n",
      [`${ROOT}/.github/copilot-instructions.md`]: "- Use pnpm as the package manager, never npm\n",
      [`${ROOT}/.claude/rules/dead.md`]: '---\npaths: ["packages/legacy/**"]\n---\n\nFrozen code.\n',
    });

    const keys = result.diagnostics.map((item) => `${item.location?.file}:${item.location?.line ?? 0}:${item.code}`);
    expect(keys).toEqual([...keys].sort());
  });

  it("reuses a discovery pass instead of scanning twice", () => {
    const fs = memoryFileSystem({ [`${ROOT}/AGENTS.md`]: "- Use pnpm as the package manager\n" });
    const discovery = discover({ root: ROOT, fs });

    const result = runValidation({ root: ROOT, fs, discovery });
    expect(result.discovery).toBe(discovery);
  });

  it("runs only the selected rules", () => {
    const result = run({ [`${ROOT}/AGENTS.md`]: "- Use pnpm as the package manager\n" }, { rules: ["context-budget"] });
    expect(result.rulesRun).toEqual(["context-budget"]);
  });

  it("reports nothing for a repository with no agent configuration", () => {
    const result = run({ [`${ROOT}/src/index.ts`]: "export const x = 1;" });
    expect(result.diagnostics).toEqual([]);
    expect(result.discovery.configuration.sources).toEqual([]);
  });
});
