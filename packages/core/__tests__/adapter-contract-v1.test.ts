import { describe, expect, it } from "vitest";
import {
  checkFileReferences,
  contractToConfiguration,
  loadConfigurationFromContract,
  overrideToInstructions,
} from "../src/adapters/index.ts";
import { memoryFileSystem } from "../src/fs/index.ts";
import { resolveForPath } from "../src/resolver/index.ts";
import { ContractSchema, OverrideSchema } from "../src/schema.ts";

const ROOT = "/repo";

const VALID_CONTRACT = `version: 1

project:
  name: Demo App
  stack:
    - typescript
    - react

rules:
  coding:
    - Prefer small composable functions
    - Avoid unnecessary abstractions
  architecture:
    - Feature-based folder structure

skills:
  - name: create-component
    description: Creates a React component with tests
    context:
      - Components live in src/components/
    steps:
      - Create the component file
      - Create the test file
    expected_output: A typed component with a matching test
`;

function fsWith(files: Record<string, string>) {
  return memoryFileSystem(files);
}

describe("loadConfigurationFromContract — failure cases", () => {
  it("reports a missing contract as AGF002 without throwing", () => {
    const result = loadConfigurationFromContract({ root: ROOT, fs: fsWith({}) });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe("AGF002");
    expect(result.diagnostics[0].location?.file).toBe("ai/contract.yaml");
    expect(result.diagnostics[0].suggestion).toContain("agentfile init");
    // Callers get a usable empty configuration rather than null.
    expect(result.configuration.directives).toEqual([]);
  });

  it("reports malformed YAML as AGF003 with a position", () => {
    const result = loadConfigurationFromContract({
      root: ROOT,
      fs: fsWith({ "/repo/ai/contract.yaml": "version: 1\nproject:\n  name: [unclosed\n" }),
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe("AGF003");
    expect(result.diagnostics[0].location?.line).toBeGreaterThan(0);
  });

  it("reports a schema violation as AGF001 pointing at the offending field", () => {
    const contract = `version: 1

project:
  name: ""
  stack:
    - typescript

skills:
  - name: only
    description: has a description
    steps:
      - a step
`;
    const result = loadConfigurationFromContract({
      root: ROOT,
      fs: fsWith({ "/repo/ai/contract.yaml": contract }),
    });

    expect(result.ok).toBe(false);
    const [found] = result.diagnostics;
    expect(found.code).toBe("AGF001");
    expect(found.message).toContain("project.name");
    expect(found.location).toMatchObject({ file: "ai/contract.yaml", line: 4 });
    expect(found.data).toMatchObject({ path: "project.name" });
  });

  it("reports an unsupported contract version rather than guessing", () => {
    const result = loadConfigurationFromContract({
      root: ROOT,
      fs: fsWith({
        "/repo/ai/contract.yaml": "version: 2\nproject:\n  name: X\n  stack: [ts]\nskills: []\n",
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((item) => item.message.includes("version"))).toBe(true);
  });

  it("reports every schema problem at once, not just the first", () => {
    const result = loadConfigurationFromContract({
      root: ROOT,
      fs: fsWith({ "/repo/ai/contract.yaml": 'version: 1\nproject:\n  name: ""\n  stack: []\nskills: []\n' }),
    });

    expect(result.diagnostics.length).toBeGreaterThan(1);
    expect(result.diagnostics.every((item) => item.code === "AGF001")).toBe(true);
  });
});

describe("loadConfigurationFromContract — mapping", () => {
  const result = loadConfigurationFromContract({
    root: ROOT,
    fs: fsWith({ "/repo/ai/contract.yaml": VALID_CONTRACT }),
  });

  it("loads cleanly", () => {
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("carries project metadata across", () => {
    expect(result.configuration.project).toEqual({ name: "Demo App", stack: ["typescript", "react"] });
  });

  it("maps each rule to its own directive so duplicates stay detectable", () => {
    const texts = result.configuration.directives.map((entry) => entry.text);
    expect(texts).toEqual([
      "Prefer small composable functions",
      "Avoid unnecessary abstractions",
      "Feature-based folder structure",
    ]);
  });

  it("keeps the rule category as an open label", () => {
    const categories = result.configuration.directives.map((entry) => entry.category);
    expect(categories).toEqual(["coding", "coding", "architecture"]);
  });

  it("locates every directive in the source file", () => {
    for (const entry of result.configuration.directives) {
      expect(entry.provenance.file).toBe("ai/contract.yaml");
      expect(entry.provenance.line).toBeGreaterThan(0);
    }

    // The first coding rule is the list item on line 11 of the fixture: the
    // position points at the value, not at the `coding:` key above it.
    expect(result.configuration.directives[0].provenance.line).toBe(11);
  });

  it("records provenance as declared, project-scoped agentfile configuration", () => {
    expect(result.configuration.directives[0].provenance).toMatchObject({
      platform: "agentfile",
      scope: "project",
      origin: "declared",
    });
  });

  it("gives directives stable unique ids", () => {
    const ids = result.configuration.directives.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("maps skills onto the Agent Skills shape with a rendered body", () => {
    const [skill] = result.configuration.skills;
    expect(skill.name).toBe("create-component");
    expect(skill.description).toBe("Creates a React component with tests");
    expect(skill.body).toContain("### create-component");
    expect(skill.body).toContain("Create the test file");
    expect(skill.applies.kind).toBe("model-selected");
  });

  it("preserves v1-only skill fields as extensions rather than dropping them", () => {
    expect(result.configuration.skills[0].extensions).toMatchObject({
      steps: ["Create the component file", "Create the test file"],
      expected_output: "A typed component with a matching test",
    });
  });

  it("records the contract as a source file with its size", () => {
    expect(result.configuration.sources).toEqual([
      {
        path: "ai/contract.yaml",
        platform: "agentfile",
        scope: "project",
        kind: "contract",
        bytes: VALID_CONTRACT.length,
      },
    ]);
  });

  it("produces unconditional directives for a root contract", () => {
    expect(result.configuration.directives.every((entry) => entry.applies.kind === "always")).toBe(true);
  });
});

describe("subdirectory contracts", () => {
  it("scopes a directory contract to that subtree", () => {
    const configuration = contractToConfiguration(
      ContractSchema.parse({
        version: 1,
        project: { name: "Mobile", stack: ["typescript"] },
        rules: { coding: ["Use React Native primitives"] },
        skills: [{ name: "s", description: "d", steps: ["one"] }],
      }),
      { root: ROOT, contractPath: "apps/mobile/ai/contract.yaml", directory: "apps/mobile" },
    );

    expect(configuration.directives[0].applies).toEqual({ kind: "directory", directory: "apps/mobile" });
    expect(configuration.directives[0].provenance.scope).toBe("directory");
  });

  it("keeps a directory contract's skills inside that subtree", () => {
    const configuration = contractToConfiguration(
      ContractSchema.parse({
        version: 1,
        project: { name: "Mobile", stack: ["typescript"] },
        skills: [{ name: "add-screen", description: "adds a screen", steps: ["one"] }],
      }),
      { root: ROOT, contractPath: "apps/mobile/ai/contract.yaml", directory: "apps/mobile" },
    );

    expect(configuration.skills[0].applies).toEqual({ kind: "paths", patterns: ["apps/mobile/**"] });
    expect(resolveForPath(configuration, "apps/mobile/src/Login.tsx").skills).toHaveLength(1);
    expect(resolveForPath(configuration, "apps/web/src/Login.tsx").skills).toHaveLength(0);
  });

  it("offers a root contract's skills everywhere", () => {
    const configuration = contractToConfiguration(
      ContractSchema.parse({
        version: 1,
        project: { name: "Root", stack: ["typescript"] },
        skills: [{ name: "review", description: "reviews code", steps: ["one"] }],
      }),
      { root: ROOT },
    );

    expect(configuration.skills[0].applies.kind).toBe("model-selected");
    expect(resolveForPath(configuration, "anywhere/at/all.ts").skills).toHaveLength(1);
  });
});

describe("file reference checks (AGF004)", () => {
  const contract = `version: 1

project:
  name: Demo
  stack: [typescript]

skills:
  - name: only
    description: a skill
    steps:
      - one

artifacts:
  - name: developer
    type: agent
    description: Developer agent
    content_file: ai/bodies/developer.md

docs:
  - name: Definition of Done
    file: docs/dod.md
    token: dod
`;

  it("reports a content_file that does not exist", () => {
    const result = loadConfigurationFromContract({
      root: ROOT,
      fs: fsWith({ "/repo/ai/contract.yaml": contract, "/repo/docs/dod.md": "# DoD" }),
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(1);

    const [found] = result.diagnostics;
    expect(found.code).toBe("AGF004");
    expect(found.severity).toBe("error");
    expect(found.message).toContain("ai/bodies/developer.md");
    expect(found.location?.file).toBe("ai/contract.yaml");
    expect(found.data).toMatchObject({ field: "content_file" });
  });

  it("reports a missing doc reference", () => {
    const result = loadConfigurationFromContract({
      root: ROOT,
      fs: fsWith({ "/repo/ai/contract.yaml": contract, "/repo/ai/bodies/developer.md": "body" }),
    });

    const [found] = result.diagnostics;
    expect(found.code).toBe("AGF004");
    expect(found.message).toContain("docs/dod.md");
    expect(found.data).toMatchObject({ field: "file" });
  });

  it("stays quiet when every reference resolves", () => {
    const result = loadConfigurationFromContract({
      root: ROOT,
      fs: fsWith({
        "/repo/ai/contract.yaml": contract,
        "/repo/ai/bodies/developer.md": "body",
        "/repo/docs/dod.md": "# DoD",
      }),
    });

    expect(result.diagnostics).toEqual([]);
  });

  it("can be run directly against a configuration", () => {
    const configuration = contractToConfiguration(
      ContractSchema.parse({
        version: 1,
        project: { name: "Demo", stack: ["ts"] },
        skills: [{ name: "s", description: "d", steps: ["one"] }],
        docs: [{ name: "DoR", file: "docs/dor.md" }],
      }),
      { root: ROOT },
    );

    expect(checkFileReferences(configuration, fsWith({})).map((item) => item.code)).toEqual(["AGF004"]);
    expect(checkFileReferences(configuration, fsWith({ "/repo/docs/dor.md": "x" }))).toEqual([]);
  });
});

describe("override files", () => {
  it("maps override blocks to local-scoped instructions", () => {
    const override = OverrideSchema.parse({
      blocks: [{ section: "Frontend Context", content: "Prefer React Server Components." }],
    });

    const [instruction] = overrideToInstructions(override, "ai.override.yaml", "apps/web");

    expect(instruction.title).toBe("Frontend Context");
    expect(instruction.body).toBe("Prefer React Server Components.");
    expect(instruction.applies).toEqual({ kind: "directory", directory: "apps/web" });
    expect(instruction.provenance.scope).toBe("local");
    expect(instruction.id).toContain("frontend-context");
  });

  it("picks up an override file next to the contract", () => {
    const result = loadConfigurationFromContract({
      root: ROOT,
      fs: fsWith({
        "/repo/ai/contract.yaml": VALID_CONTRACT,
        "/repo/ai.override.yaml": "blocks:\n  - section: Local\n    content: My own note.\n",
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.configuration.instructions).toHaveLength(1);
    expect(result.configuration.instructions[0].title).toBe("Local");
    expect(result.configuration.sources.map((source) => source.kind)).toEqual(["contract", "override"]);
  });

  it("reports a malformed override without discarding the contract", () => {
    const result = loadConfigurationFromContract({
      root: ROOT,
      fs: fsWith({
        "/repo/ai/contract.yaml": VALID_CONTRACT,
        "/repo/ai.override.yaml": "blocks:\n  - section: 42\n",
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.configuration.directives).toHaveLength(3);
    expect(result.diagnostics.some((item) => item.code === "AGF001")).toBe(true);
  });
});

describe("contract to resolution, end to end", () => {
  it("resolves the effective configuration for a path", () => {
    const result = loadConfigurationFromContract({
      root: ROOT,
      fs: fsWith({
        "/repo/ai/contract.yaml": VALID_CONTRACT,
        "/repo/ai.override.yaml": "blocks:\n  - section: Web\n    content: RSC by default.\n",
      }),
    });

    const effective = resolveForPath(result.configuration, "src/components/Button.tsx");

    expect(effective.directives).toHaveLength(3);
    expect(effective.instructions.map((entry) => entry.node.title)).toEqual(["Web"]);
    expect(effective.skills.map((entry) => entry.node.name)).toEqual(["create-component"]);
    expect(effective.diagnostics).toEqual([]);
  });

  it("keeps a monorepo package's rules out of a sibling package", () => {
    const root = loadConfigurationFromContract({
      root: ROOT,
      fs: fsWith({ "/repo/ai/contract.yaml": VALID_CONTRACT }),
    }).configuration;

    const mobile = contractToConfiguration(
      ContractSchema.parse({
        version: 1,
        project: { name: "Mobile", stack: ["typescript"] },
        rules: { coding: ["Use React Native primitives"] },
        skills: [{ name: "s", description: "d", steps: ["one"] }],
      }),
      { root: ROOT, contractPath: "apps/mobile/ai/contract.yaml", directory: "apps/mobile" },
    );

    const combined = { ...root, directives: [...root.directives, ...mobile.directives] };

    const inMobile = resolveForPath(combined, "apps/mobile/src/Login.tsx");
    expect(inMobile.directives.map((entry) => entry.node.text)).toContain("Use React Native primitives");

    const inWeb = resolveForPath(combined, "apps/web/src/Login.tsx");
    expect(inWeb.directives.map((entry) => entry.node.text)).not.toContain("Use React Native primitives");
  });

  it("keeps a package's skills out of a sibling package", () => {
    const root = contractToConfiguration(
      ContractSchema.parse({
        version: 1,
        project: { name: "Monorepo", stack: ["typescript"] },
        skills: [{ name: "create-component", description: "shared", steps: ["one"] }],
      }),
      { root: ROOT },
    );

    const mobile = contractToConfiguration(
      ContractSchema.parse({
        version: 1,
        project: { name: "Mobile", stack: ["typescript"] },
        skills: [{ name: "add-screen", description: "mobile only", steps: ["one"] }],
      }),
      { root: ROOT, contractPath: "apps/mobile/ai/contract.yaml", directory: "apps/mobile" },
    );

    const combined = { ...root, skills: [...root.skills, ...mobile.skills] };

    expect(resolveForPath(combined, "apps/mobile/src/Login.tsx").skills.map((e) => e.node.name)).toEqual([
      "create-component",
      "add-screen",
    ]);
    expect(resolveForPath(combined, "apps/web/src/Login.tsx").skills.map((e) => e.node.name)).toEqual([
      "create-component",
    ]);
  });
});
