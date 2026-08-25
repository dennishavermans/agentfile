import { describe, expect, it } from "vitest";
import { ALWAYS, appliesToPaths, emptyConfiguration, nodeId } from "../src/ir/index.ts";
import { deadPatterns, unreachableDiagnostics } from "../src/resolver/index.ts";

function configurationWith(patterns: string[], file = ".claude/rules/api.md") {
  const configuration = emptyConfiguration("/repo");
  const provenance = { file, line: 2, platform: "claude", scope: "project" as const, origin: "declared" as const };

  configuration.instructions.push({
    id: nodeId("instruction", provenance),
    title: file,
    body: "Validate every input.",
    applies: patterns.length ? appliesToPaths(patterns) : ALWAYS,
    provenance,
  });

  return configuration;
}

describe("deadPatterns", () => {
  it("returns the patterns nothing matches", () => {
    expect(deadPatterns(["src/**", "packages/legacy/**"], ["src/index.ts"])).toEqual(["packages/legacy/**"]);
  });

  it("returns nothing when every pattern matches", () => {
    expect(deadPatterns(["src/**"], ["src/index.ts"])).toEqual([]);
  });

  it("uses the same matcher as the resolver, including its dot-directory rule", () => {
    // A leading * does not match a leading dot, which is documented behaviour
    // pinned by the path tests. Reachability must agree with it.
    expect(deadPatterns(["**/*.md"], [".claude/rules/api.md"])).toEqual(["**/*.md"]);
  });
});

describe("unreachableDiagnostics", () => {
  it("reports configuration whose every pattern is dead", () => {
    const [found] = unreachableDiagnostics(configurationWith(["packages/legacy/**"]), {
      files: ["src/index.ts", ".claude/rules/api.md"],
    });

    expect(found.code).toBe("AGF303");
    expect(found.severity).toBe("warning");
    expect(found.message).toContain("never applies");
    expect(found.location).toEqual({ file: ".claude/rules/api.md", line: 2 });
    expect(found.data?.deadPatterns).toBe("packages/legacy/**");
  });

  it("distinguishes a partly dead pattern list from one that never applies", () => {
    const [found] = unreachableDiagnostics(configurationWith(["src/**", "packages/legacy/**"]), {
      files: ["src/index.ts"],
    });

    expect(found.message).toContain("a pattern that matches no file");
    expect(found.message).not.toContain("never applies");
    expect(found.explanation).toContain("still match");
  });

  it("says that the scan skips generated directories, so the reader is not left guessing", () => {
    const [found] = unreachableDiagnostics(configurationWith(["dist/**"]), { files: ["src/index.ts"] });
    expect(found.explanation).toContain("skips generated and vendored directories");
  });

  it("reports nothing for configuration that is not glob-scoped", () => {
    expect(unreachableDiagnostics(configurationWith([]), { files: ["src/index.ts"] })).toEqual([]);
  });

  it("reports nothing when the patterns match", () => {
    expect(unreachableDiagnostics(configurationWith(["src/**"]), { files: ["src/index.ts"] })).toEqual([]);
  });

  it("reports a skill whose path scope matches nothing", () => {
    const configuration = emptyConfiguration("/repo");
    const provenance = {
      file: "apps/legacy/ai/contract.yaml",
      platform: "agentfile",
      scope: "directory" as const,
      origin: "declared" as const,
    };
    configuration.skills.push({
      id: nodeId("skill", provenance, "migrate-legacy"),
      name: "migrate-legacy",
      description: "Migrate a legacy screen",
      body: "",
      resources: [],
      applies: appliesToPaths(["apps/legacy/**"]),
      provenance,
    });

    const [found] = unreachableDiagnostics(configuration, { files: ["apps/web/index.ts"] });
    expect(found.code).toBe("AGF303");
    expect(found.message).toContain('skill "migrate-legacy"');
  });

  it("does not repeat a finding once per derived bullet", () => {
    const configuration = configurationWith(["packages/legacy/**"]);
    const provenance = {
      file: ".claude/rules/api.md",
      line: 4,
      platform: "claude",
      scope: "project" as const,
      origin: "derived" as const,
    };
    configuration.directives.push({
      id: nodeId("directive", provenance, "derived-0"),
      text: "Validate every input",
      applies: appliesToPaths(["packages/legacy/**"]),
      provenance,
    });

    expect(unreachableDiagnostics(configuration, { files: ["src/index.ts"] })).toHaveLength(1);
  });
});
