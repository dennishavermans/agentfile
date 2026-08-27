import { describe, expect, it } from "vitest";
import { compatibilityDiagnostics, featuresUsed, groupFeatureUsage } from "../src/capabilities/index.ts";
import {
  ALWAYS,
  appliesToDirectory,
  appliesToPaths,
  emptyConfiguration,
  MODEL_SELECTED,
  nodeId,
} from "../src/ir/index.ts";

function provenance(file: string, platform: string) {
  return { file, platform, scope: "project" as const, origin: "declared" as const };
}

function configuration() {
  const config = emptyConfiguration("/repo");

  const rootProvenance = provenance("AGENTS.md", "agents-md");
  config.instructions.push({
    id: nodeId("instruction", rootProvenance),
    title: "AGENTS.md",
    body: "Root rules.",
    applies: ALWAYS,
    provenance: rootProvenance,
  });
  config.sources.push({ path: "AGENTS.md", platform: "agents-md", scope: "project", kind: "instructions" });

  const nested = provenance("apps/web/AGENTS.md", "agents-md");
  config.instructions.push({
    id: nodeId("instruction", nested),
    title: "apps/web/AGENTS.md",
    body: "Web rules.",
    applies: appliesToDirectory("apps/web"),
    provenance: nested,
  });

  const scoped = provenance(".claude/rules/api.md", "claude");
  config.instructions.push({
    id: nodeId("instruction", scoped),
    title: ".claude/rules/api.md",
    body: "Validate input.",
    applies: appliesToPaths(["src/api/**"]),
    provenance: scoped,
  });

  const imported = provenance("CLAUDE.md", "claude");
  config.instructions.push({
    id: nodeId("instruction", imported),
    title: "CLAUDE.md",
    body: "See @docs/style.md",
    applies: ALWAYS,
    provenance: imported,
    imports: ["docs/style.md"],
  });

  const skill = provenance(".claude/skills/deploy/SKILL.md", "claude");
  config.skills.push({
    id: nodeId("skill", skill, "deploy"),
    name: "deploy",
    description: "Deploy the service when a release is cut",
    body: "",
    resources: [{ path: "scripts/deploy.sh", kind: "script" }],
    allowedTools: ["Bash"],
    applies: MODEL_SELECTED,
    provenance: skill,
  });

  const mcp = provenance(".mcp.json", "claude");
  config.mcpServers.push({ name: "db", transport: "stdio", command: "npx", provenance: mcp });

  return config;
}

describe("featuresUsed", () => {
  it("reads every capability the configuration relies on straight off the IR", () => {
    const features = new Set(featuresUsed(configuration()).map((usage) => usage.feature));

    expect(features).toContain("instructions.root");
    expect(features).toContain("instructions.nested");
    expect(features).toContain("instructions.path-scoped");
    expect(features).toContain("instructions.imports");
    expect(features).toContain("instructions.agents-md");
    expect(features).toContain("skills");
    expect(features).toContain("skills.resources");
    expect(features).toContain("skills.allowed-tools");
    expect(features).toContain("mcp.project-config");
  });

  it("counts a root directory scope as a root instruction, not a nested one", () => {
    const config = emptyConfiguration("/repo");
    const source = provenance("AGENTS.md", "agents-md");
    config.instructions.push({
      id: nodeId("instruction", source),
      body: "Root rules.",
      applies: appliesToDirectory(""),
      provenance: source,
    });

    expect(featuresUsed(config).map((usage) => usage.feature)).toEqual(["instructions.root"]);
  });

  it("gives every usage somewhere to point", () => {
    for (const usage of featuresUsed(configuration())) {
      expect(usage.location?.file).toBeTruthy();
    }
  });

  it("ignores directives derived from prose, which would double-count their instruction", () => {
    const config = emptyConfiguration("/repo");
    const source = { ...provenance(".claude/rules/api.md", "claude"), origin: "derived" as const };
    config.directives.push({
      id: nodeId("directive", source, "derived-0"),
      text: "Validate every input",
      applies: appliesToPaths(["src/api/**"]),
      provenance: source,
    });

    expect(featuresUsed(config)).toEqual([]);
  });
});

describe("groupFeatureUsage", () => {
  it("groups by feature in a stable order", () => {
    const grouped = groupFeatureUsage(featuresUsed(configuration()));
    expect([...grouped.keys()]).toEqual([...grouped.keys()].sort());
  });
});

describe("compatibilityDiagnostics", () => {
  it("reports one finding per target and feature, not one per node", () => {
    const config = emptyConfiguration("/repo");
    for (const name of ["one", "two", "three"]) {
      config.skills.push({
        id: nodeId("skill", provenance(`.claude/skills/${name}/SKILL.md`, "claude"), name),
        name,
        description: `Skill ${name}`,
        body: "",
        resources: [],
        applies: MODEL_SELECTED,
        provenance: provenance(`.claude/skills/${name}/SKILL.md`, "claude"),
      });
    }

    const found = compatibilityDiagnostics(config, ["agents-md"]).filter((item) => item.code === "AGF201");
    expect(found).toHaveLength(1);
    expect(found[0].data?.usages).toBe(3);
    expect(found[0].message).toContain("and 2 more");
  });

  it("reports skills as unsupported on a target that has none, with the source URL", () => {
    const [found] = compatibilityDiagnostics(configuration(), ["agents-md"]).filter(
      (item) => item.data?.feature === "skills",
    );

    expect(found.code).toBe("AGF201");
    expect(found.severity).toBe("error");
    expect(found.explanation).toContain("https://agents.md/");
  });

  it("reports an emulated feature as a warning rather than an error", () => {
    // Claude Code reads CLAUDE.md, not AGENTS.md; the bridge is documented.
    const [found] = compatibilityDiagnostics(configuration(), ["claude"]).filter(
      (item) => item.data?.feature === "instructions.agents-md",
    );

    expect(found.code).toBe("AGF202");
    expect(found.severity).toBe("warning");
  });

  it("reports an unverified combination as info rather than guessing either answer", () => {
    const [found] = compatibilityDiagnostics(configuration(), ["cursor"]).filter(
      (item) => item.data?.feature === "instructions.imports",
    );

    expect(found.code).toBe("AGF203");
    expect(found.severity).toBe("info");
  });

  it("reports nothing for a target that supports everything in use", () => {
    const config = emptyConfiguration("/repo");
    const source = provenance("CLAUDE.md", "claude");
    config.instructions.push({
      id: nodeId("instruction", source),
      body: "Root rules.",
      applies: ALWAYS,
      provenance: source,
    });

    expect(compatibilityDiagnostics(config, ["claude"])).toEqual([]);
  });

  it("checks every named target", () => {
    const targets = new Set(
      compatibilityDiagnostics(configuration(), ["agents-md", "cursor"]).map((item) => item.data?.target),
    );
    expect(targets).toEqual(new Set(["agents-md", "cursor"]));
  });
});
