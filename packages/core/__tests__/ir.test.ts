import { describe, expect, it } from "vitest";
import type { Directive, Provenance } from "../src/ir/index.ts";
import {
  ALWAYS,
  appliesToDirectory,
  appliesToPaths,
  countNodes,
  emptyConfiguration,
  IR_VERSION,
  MANUAL,
  MODEL_SELECTED,
  mergeConfigurations,
  nodeId,
  slugify,
} from "../src/ir/index.ts";

const provenance: Provenance = {
  file: "ai/contract.yaml",
  line: 11,
  platform: "agentfile",
  scope: "project",
  origin: "declared",
};

describe("emptyConfiguration", () => {
  it("stamps the IR version and the root", () => {
    const configuration = emptyConfiguration("/repo");
    expect(configuration.version).toBe(IR_VERSION);
    expect(configuration.root).toBe("/repo");
  });

  it("starts with every collection empty", () => {
    expect(countNodes(emptyConfiguration("/repo"))).toBe(0);
  });

  it("returns a fresh object each call so callers cannot share state", () => {
    const first = emptyConfiguration("/repo");
    first.directives.push({} as Directive);
    expect(emptyConfiguration("/repo").directives).toEqual([]);
  });
});

describe("nodeId", () => {
  it("encodes kind, file, line, and discriminator", () => {
    expect(nodeId("directive", provenance, "coding-0")).toBe("directive:ai/contract.yaml:11#coding-0");
  });

  it("omits the position when the source has none", () => {
    expect(nodeId("skill", { ...provenance, line: undefined }, "deploy")).toBe("skill:ai/contract.yaml#deploy");
  });

  it("normalises the file path so the same node gets the same id", () => {
    const windows = { ...provenance, file: "ai\\contract.yaml" };
    expect(nodeId("directive", windows, "coding-0")).toBe(nodeId("directive", provenance, "coding-0"));
  });

  it("is stable across calls", () => {
    expect(nodeId("directive", provenance, "coding-0")).toBe(nodeId("directive", provenance, "coding-0"));
  });
});

describe("slugify", () => {
  it("produces a kebab-case slug", () => {
    expect(slugify("Frontend Context")).toBe("frontend-context");
  });

  it("collapses runs of punctuation and trims edges", () => {
    expect(slugify("  Rules // Testing!  ")).toBe("rules-testing");
  });

  it("returns an empty string when nothing usable remains", () => {
    expect(slugify("***")).toBe("");
  });
});

describe("applicability helpers", () => {
  it("exposes the singleton kinds", () => {
    expect(ALWAYS).toEqual({ kind: "always" });
    expect(MODEL_SELECTED).toEqual({ kind: "model-selected" });
    expect(MANUAL).toEqual({ kind: "manual" });
  });

  it("normalises a directory scope", () => {
    expect(appliesToDirectory("apps\\mobile/")).toEqual({ kind: "directory", directory: "apps/mobile" });
  });

  it("copies the pattern list so callers cannot mutate it later", () => {
    const patterns = ["src/**/*.ts"];
    const applies = appliesToPaths(patterns);
    patterns.push("docs/**");
    expect(applies).toEqual({ kind: "paths", patterns: ["src/**/*.ts"] });
  });
});

describe("mergeConfigurations", () => {
  function withDirective(text: string, file: string) {
    const configuration = emptyConfiguration("/repo");
    configuration.directives.push({
      id: `directive:${file}#0`,
      text,
      applies: ALWAYS,
      provenance: { ...provenance, file },
    });
    configuration.sources.push({ path: file, platform: "agentfile", scope: "project", kind: "contract" });
    return configuration;
  }

  it("concatenates nodes in argument order", () => {
    const merged = mergeConfigurations("/repo", withDirective("first", "a.yaml"), withDirective("second", "b.yaml"));

    expect(merged.directives.map((entry) => entry.text)).toEqual(["first", "second"]);
  });

  it("keeps duplicates so they stay reportable instead of silently vanishing", () => {
    const merged = mergeConfigurations(
      "/repo",
      withDirective("use pnpm", "a.yaml"),
      withDirective("use pnpm", "b.yaml"),
    );

    expect(merged.directives).toHaveLength(2);
  });

  it("deduplicates source files by path", () => {
    const merged = mergeConfigurations("/repo", withDirective("x", "a.yaml"), withDirective("y", "a.yaml"));
    expect(merged.sources).toHaveLength(1);
  });

  it("takes the first project name and unions the stack", () => {
    const first = emptyConfiguration("/repo");
    first.project = { name: "Mobile", stack: ["typescript", "react-native"] };

    const second = emptyConfiguration("/repo");
    second.project = { name: "Monorepo", stack: ["typescript", "react"] };

    expect(mergeConfigurations("/repo", first, second).project).toEqual({
      name: "Mobile",
      stack: ["typescript", "react-native", "react"],
    });
  });

  it("fills in a missing project name from a later source", () => {
    const first = emptyConfiguration("/repo");
    const second = emptyConfiguration("/repo");
    second.project = { name: "Monorepo", stack: [] };

    expect(mergeConfigurations("/repo", first, second).project.name).toBe("Monorepo");
  });

  it("returns an empty configuration when given nothing", () => {
    expect(countNodes(mergeConfigurations("/repo"))).toBe(0);
  });

  it("does not mutate its inputs", () => {
    const first = withDirective("first", "a.yaml");
    mergeConfigurations("/repo", first, withDirective("second", "b.yaml"));
    expect(first.directives).toHaveLength(1);
  });
});

describe("countNodes", () => {
  it("counts across every node collection", () => {
    const configuration = emptyConfiguration("/repo");
    configuration.directives.push({ id: "d", text: "x", applies: ALWAYS, provenance });
    configuration.docs.push({ name: "DoD", file: "docs/dod.md", token: "dod", provenance });
    expect(countNodes(configuration)).toBe(2);
  });
});
