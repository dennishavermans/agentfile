import { describe, expect, it } from "vitest";
import {
  ALWAYS,
  appliesToDirectory,
  appliesToPaths,
  emptyConfiguration,
  MANUAL,
  MODEL_SELECTED,
  nodeId,
} from "../src/ir/index.ts";
import { describeApplicability, explainTarget, findExplainTargets, verdictAt } from "../src/resolver/index.ts";

function provenance(file: string, platform: string, line?: number) {
  return { file, line, platform, scope: "project" as const, origin: "declared" as const };
}

function fixture() {
  const config = emptyConfiguration("/repo");

  const rootSource = provenance("AGENTS.md", "agents-md");
  config.instructions.push({
    id: nodeId("instruction", rootSource),
    title: "AGENTS.md",
    body: "Always validate input at the API boundary before trusting it\nUse pnpm as the package manager",
    applies: ALWAYS,
    provenance: rootSource,
  });

  const cursorSource = provenance(".cursor/rules/api.mdc", "cursor");
  config.instructions.push({
    id: nodeId("instruction", cursorSource),
    title: ".cursor/rules/api.mdc",
    body: "Always validate input at the API boundary before trusting it",
    applies: appliesToPaths(["src/api/**"]),
    provenance: cursorSource,
  });

  const ruleSource = provenance("ai/contract.yaml", "agentfile", 11);
  config.directives.push({
    id: nodeId("directive", ruleSource, "coding-0"),
    text: "Use pnpm as the package manager",
    category: "coding",
    applies: ALWAYS,
    provenance: ruleSource,
  });

  const copySource = provenance("apps/web/ai/contract.yaml", "agentfile", 9);
  config.directives.push({
    id: nodeId("directive", copySource, "coding-0"),
    text: "Use pnpm as the package manager.",
    applies: appliesToDirectory("apps/web"),
    provenance: copySource,
  });

  const skillSource = provenance(".claude/skills/deploy/SKILL.md", "claude");
  config.skills.push({
    id: nodeId("skill", skillSource, "deploy"),
    name: "deploy",
    description: "Deploy the service when a release is cut",
    body: "",
    resources: [],
    applies: MODEL_SELECTED,
    provenance: skillSource,
  });

  const mcpSource = provenance(".mcp.json", "claude");
  config.mcpServers.push({ name: "db", transport: "stdio", command: "npx", provenance: mcpSource });

  const hookSource = provenance(".claude/settings.json", "claude");
  config.hooks.push({ event: "PreToolUse", command: "./scripts/guard.sh", provenance: hookSource });

  return config;
}

describe("describeApplicability", () => {
  it("phrases every variant in terms of when configuration loads", () => {
    expect(describeApplicability(ALWAYS)).toContain("every session");
    expect(describeApplicability(appliesToDirectory("apps/web"))).toContain("inside apps/web/");
    expect(describeApplicability(appliesToDirectory(""))).toContain("every session");
    expect(describeApplicability(appliesToPaths(["src/**"]))).toContain("src/**");
    expect(describeApplicability(MODEL_SELECTED)).toContain("agent decides");
    expect(describeApplicability(MANUAL)).toContain("invoked explicitly");
  });

  it("says so plainly for node kinds no platform scopes by path", () => {
    expect(describeApplicability(undefined)).toContain("whole repository");
  });
});

describe("findExplainTargets", () => {
  it("finds every node a source file contributes", () => {
    const found = findExplainTargets(fixture(), "AGENTS.md");
    expect(found).toHaveLength(1);
    expect(found[0].matchedBy).toBe("file");
    expect(found[0].kind).toBe("instruction");
  });

  it("finds a skill by name", () => {
    const [found] = findExplainTargets(fixture(), "deploy");
    expect(found.kind).toBe("skill");
    expect(found.matchedBy).toBe("name");
  });

  it("finds a rule by part of its text", () => {
    const found = findExplainTargets(fixture(), "pnpm");
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((target) => target.matchedBy === "text")).toBe(true);
  });

  it("finds an MCP server and a hook", () => {
    expect(findExplainTargets(fixture(), "db")[0].kind).toBe("mcp-server");
    expect(findExplainTargets(fixture(), "PreToolUse")[0].kind).toBe("hook");
  });

  it("prefers a precise match over a broad one", () => {
    // A file query must not also behave as a substring search, or the answer
    // would be buried in coincidental matches.
    const found = findExplainTargets(fixture(), ".cursor/rules/api.mdc");
    expect(found).toHaveLength(1);
    expect(found[0].matchedBy).toBe("file");
  });

  it("restricts to one kind when asked", () => {
    const found = findExplainTargets(fixture(), "pnpm", { kind: "rule" });
    expect(found.every((target) => target.kind === "rule")).toBe(true);
  });

  it("returns nothing for a query that matches nothing, rather than guessing", () => {
    expect(findExplainTargets(fixture(), "nothing like this exists")).toEqual([]);
    expect(findExplainTargets(fixture(), "   ")).toEqual([]);
  });

  it("is case-insensitive for names and text", () => {
    expect(findExplainTargets(fixture(), "DEPLOY")[0].kind).toBe("skill");
    expect(findExplainTargets(fixture(), "PNPM").length).toBeGreaterThan(0);
  });
});

describe("verdictAt", () => {
  it("reports the resolver's own reason when it applies", () => {
    const config = fixture();
    const [target] = findExplainTargets(config, ".cursor/rules/api.mdc");

    const verdict = verdictAt(config, target, "src/api/handler.ts");
    expect(verdict.applies).toBe(true);
    expect(verdict.reason).toContain("matches src/api/**");
    expect(verdict.rank?.pattern).toBe("src/api/**");
  });

  it("reports the resolver's own reason when it does not apply", () => {
    const config = fixture();
    const [target] = findExplainTargets(config, ".cursor/rules/api.mdc");

    const verdict = verdictAt(config, target, "apps/web/index.ts");
    expect(verdict.applies).toBe(false);
    expect(verdict.reason).toContain("matches none of");
    expect(verdict.rank).toBeUndefined();
  });

  it("names what outranks it, least specific first", () => {
    const config = fixture();
    const [target] = findExplainTargets(config, "AGENTS.md");

    const verdict = verdictAt(config, target, "src/api/handler.ts");
    expect(verdict.outrankedBy).toEqual([".cursor/rules/api.mdc"]);
  });

  it("has nothing outranking the most specific node", () => {
    const config = fixture();
    const [target] = findExplainTargets(config, ".cursor/rules/api.mdc");
    expect(verdictAt(config, target, "src/api/handler.ts").outrankedBy).toEqual([]);
  });

  it("says an MCP server is available everywhere, because no platform scopes one by path", () => {
    const config = fixture();
    const [target] = findExplainTargets(config, "db");

    const verdict = verdictAt(config, target, "src/api/handler.ts");
    expect(verdict.applies).toBe(true);
    expect(verdict.reason).toContain("not scoped by path");
  });

  it("distinguishes two nodes that share a label but not a source", () => {
    // Matching on id rather than label is what makes this exact.
    const config = emptyConfiguration("/repo");
    const a = provenance("a/AGENTS.md", "agents-md");
    const b = provenance("b/AGENTS.md", "agents-md");

    config.instructions.push({
      id: nodeId("instruction", a),
      title: "AGENTS.md",
      body: "A",
      applies: appliesToDirectory("a"),
      provenance: a,
    });
    config.instructions.push({
      id: nodeId("instruction", b),
      title: "AGENTS.md",
      body: "B",
      applies: appliesToDirectory("b"),
      provenance: b,
    });

    const [targetA] = findExplainTargets(config, "a/AGENTS.md");
    expect(verdictAt(config, targetA, "a/index.ts").applies).toBe(true);
    expect(verdictAt(config, targetA, "b/index.ts").applies).toBe(false);
  });
});

describe("explainTarget", () => {
  it("finds the other files that declare the same rule, ignoring punctuation", () => {
    const config = fixture();
    const [target] = findExplainTargets(config, "Use pnpm as the package manager", { kind: "rule" });

    const explanation = explainTarget(config, target);
    expect(explanation.alsoDeclaredIn.map((entry) => entry.file)).toEqual(["apps/web/ai/contract.yaml"]);
  });

  it("finds the other instruction files that share text", () => {
    const config = fixture();
    const [target] = findExplainTargets(config, "AGENTS.md");

    const explanation = explainTarget(config, target);
    expect(explanation.alsoDeclaredIn.map((entry) => entry.file)).toEqual([".cursor/rules/api.mdc"]);
  });

  it("omits the path verdict when no path was given", () => {
    const config = fixture();
    const [target] = findExplainTargets(config, "deploy");
    expect(explainTarget(config, target).at).toBeUndefined();
  });

  it("includes the path verdict when one was", () => {
    const config = fixture();
    const [target] = findExplainTargets(config, "deploy");
    expect(explainTarget(config, target, { at: "src/api/handler.ts" })?.at?.applies).toBe(true);
  });

  it("reports nothing related for a node kind that has no copies", () => {
    const config = fixture();
    const [target] = findExplainTargets(config, "PreToolUse");
    expect(explainTarget(config, target).alsoDeclaredIn).toEqual([]);
  });
});
