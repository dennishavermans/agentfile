import { describe, it, expect } from "vitest";
import {
  renderTemplate,
  renderSkillMarkdown,
  renderSkillMdc,
  renderSkillCopilot,
  extractPreservedZones,
  buildArtifactTokens,
  buildAggregateArtifactTokens,
  renderArtifactTemplate,
  buildDocsTokens,
} from "../src/renderer.ts";
import {
  ContractSchema,
  SkillSchema,
  OverrideSchema,
  ArtifactSchema,
  ArtifactTemplateSchema,
  DocReferenceSchema,
} from "../src/schema.ts";
import type {
  Contract,
  Skill,
  Override,
  Artifact,
  RenderContext,
} from "../src/index.ts";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const baseContract: Contract = ContractSchema.parse({
  version: 1,
  project: { name: "Test Project", stack: ["typescript", "react"] },
  rules: {
    coding: ["Prefer small functions"],
    architecture: ["Feature-based folder structure"],
    testing: ["Unit test business logic"],
    naming: ["Use descriptive names"],
  },
  skills: [
    {
      name: "create-component",
      description: "Creates a React component",
      steps: ["Create file", "Create test", "Export"],
    },
  ],
});

const baseSkill: Skill = SkillSchema.parse({
  name: "create-component",
  description: "Creates a React component with tests",
  context: ["Components live in /src/components/"],
  steps: ["Create component file", "Create test file", "Export from index"],
  expected_output: "A typed component with tests",
  examples: [
    { input: "create UserCard", output: "UserCard.tsx, UserCard.test.tsx" },
  ],
});

const ctx: RenderContext = { contract: baseContract, override: null };

// ─── renderTemplate ────────────────────────────────────────────────────────

describe("renderTemplate", () => {
  it("replaces project.name token", () => {
    expect(renderTemplate("Project: ${project.name}", ctx)).toBe(
      "Project: Test Project\n",
    );
  });

  it("replaces project.stack token", () => {
    expect(renderTemplate("Stack: ${project.stack.join(', ')}", ctx)).toBe(
      "Stack: typescript, react\n",
    );
  });

  it("renders a rule list as markdown bullets", () => {
    expect(renderTemplate("${rules.coding}", ctx)).toBe(
      "- Prefer small functions\n",
    );
  });

  it("renders empty rule category as placeholder", () => {
    const emptyCtx: RenderContext = {
      contract: {
        ...baseContract,
        rules: { coding: [], architecture: [], testing: [], naming: [] },
      },
      override: null,
    };
    expect(renderTemplate("${rules.coding}", emptyCtx)).toBe(
      "_None defined._\n",
    );
  });

  it("renders skills section in markdown format", () => {
    const result = renderTemplate("${skills}", ctx);
    expect(result).toContain("## Skills");
    expect(result).toContain("### create-component");
  });

  it("renders skills in copilot format", () => {
    const result = renderTemplate("${skills}", ctx, "copilot");
    expect(result).toContain("## Available Workflows");
    expect(result).toContain("**create-component**");
  });

  it("renders nothing for override when null", () => {
    expect(renderTemplate("Rules\n${override}", ctx).trim()).toBe("Rules");
  });

  it("injects override blocks when present", () => {
    const override: Override = OverrideSchema.parse({
      blocks: [{ section: "Frontend Context", content: "Use RSC by default." }],
    });
    const result = renderTemplate("${override}", {
      contract: baseContract,
      override,
    });
    expect(result).toContain("## Frontend Context");
    expect(result).toContain("Use RSC by default.");
  });

  it("trims and adds single trailing newline", () => {
    expect(renderTemplate("  hello  ", ctx)).toBe("hello\n");
  });
});

// ─── renderSkillMarkdown ───────────────────────────────────────────────────

describe("renderSkillMarkdown", () => {
  it("renders skill name as h3", () => {
    expect(renderSkillMarkdown(baseSkill)).toContain("### create-component");
  });

  it("renders description", () => {
    expect(renderSkillMarkdown(baseSkill)).toContain(
      "Creates a React component with tests",
    );
  });

  it("renders context as bullets", () => {
    expect(renderSkillMarkdown(baseSkill)).toContain(
      "- Components live in /src/components/",
    );
  });

  it("renders steps as numbered list", () => {
    const result = renderSkillMarkdown(baseSkill);
    expect(result).toContain("1. Create component file");
    expect(result).toContain("2. Create test file");
  });

  it("renders expected output", () => {
    expect(renderSkillMarkdown(baseSkill)).toContain(
      "A typed component with tests",
    );
  });

  it("renders examples", () => {
    const result = renderSkillMarkdown(baseSkill);
    expect(result).toContain("create UserCard");
    expect(result).toContain("UserCard.tsx");
  });
});

// ─── renderSkillMdc ────────────────────────────────────────────────────────

describe("renderSkillMdc", () => {
  it("includes frontmatter", () => {
    const result = renderSkillMdc(baseSkill);
    expect(result).toContain("---");
    expect(result).toContain("alwaysApply: false");
  });

  it("includes description in frontmatter", () => {
    expect(renderSkillMdc(baseSkill)).toContain(
      "description: Creates a React component with tests",
    );
  });

  it("renders steps as numbered list", () => {
    expect(renderSkillMdc(baseSkill)).toContain("1. Create component file");
  });
});

// ─── renderSkillCopilot ────────────────────────────────────────────────────

describe("renderSkillCopilot", () => {
  it("renders as a single compact bullet", () => {
    const result = renderSkillCopilot(baseSkill);
    expect(result).toContain("**create-component**");
    expect(result.startsWith("-")).toBe(true);
  });

  it("includes steps inline", () => {
    expect(renderSkillCopilot(baseSkill)).toContain("Create component file");
  });
});

// ─── ContractSchema ────────────────────────────────────────────────────────

describe("ContractSchema", () => {
  it("accepts a valid contract with skills", () => {
    expect(() =>
      ContractSchema.parse({
        version: 1,
        project: { name: "Test", stack: ["node"] },
        skills: [
          {
            name: "my-skill",
            description: "Does something",
            steps: ["Step one"],
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects a contract without skills", () => {
    expect(() =>
      ContractSchema.parse({
        version: 1,
        project: { name: "Test", stack: ["node"] },
        skills: [],
      }),
    ).toThrow();
  });

  it("rejects missing skills field entirely", () => {
    expect(() =>
      ContractSchema.parse({
        version: 1,
        project: { name: "Test", stack: ["node"] },
      }),
    ).toThrow();
  });

  it("rejects unsupported version", () => {
    expect(() =>
      ContractSchema.parse({
        version: 2,
        project: { name: "Test", stack: ["node"] },
        skills: [{ name: "x", description: "y", steps: ["z"] }],
      }),
    ).toThrow();
  });

  it("rejects empty project name", () => {
    expect(() =>
      ContractSchema.parse({
        version: 1,
        project: { name: "", stack: ["node"] },
        skills: [{ name: "x", description: "y", steps: ["z"] }],
      }),
    ).toThrow();
  });

  it("rejects empty stack", () => {
    expect(() =>
      ContractSchema.parse({
        version: 1,
        project: { name: "Test", stack: [] },
        skills: [{ name: "x", description: "y", steps: ["z"] }],
      }),
    ).toThrow();
  });

  it("defaults missing rule categories to empty arrays", () => {
    const result = ContractSchema.parse({
      version: 1,
      project: { name: "Test", stack: ["node"] },
      skills: [{ name: "x", description: "y", steps: ["z"] }],
    });
    expect(result.rules.coding).toEqual([]);
    expect(result.rules.architecture).toEqual([]);
  });
});

// ─── extractPreservedZones ─────────────────────────────────────────────────

describe("extractPreservedZones", () => {
  it("returns an empty Map when no preserve markers are present", () => {
    const zones = extractPreservedZones("# Hello\n\nNo markers here.\n");
    expect(zones.size).toBe(0);
  });

  it("extracts a single zone by id", () => {
    const content = [
      "## Coding",
      "- Use strict types",
      "",
      '<!-- agentfile:preserve id="ide-registration" -->',
      "<agents><agent><name>dev</name></agent></agents>",
      "<!-- agentfile:end-preserve -->",
    ].join("\n");

    const zones = extractPreservedZones(content);
    expect(zones.size).toBe(1);
    expect(zones.get("ide-registration")).toContain("<agents>");
    expect(zones.get("ide-registration")).toContain("dev");
  });

  it("extracts multiple zones with different ids", () => {
    const content = [
      '<!-- agentfile:preserve id="skills-block" -->',
      "<skills>...</skills>",
      "<!-- agentfile:end-preserve -->",
      "",
      '<!-- agentfile:preserve id="agents-block" -->',
      "<agents>...</agents>",
      "<!-- agentfile:end-preserve -->",
    ].join("\n");

    const zones = extractPreservedZones(content);
    expect(zones.size).toBe(2);
    expect(zones.get("skills-block")).toContain("<skills>");
    expect(zones.get("agents-block")).toContain("<agents>");
  });

  it("preserves whitespace inside a zone verbatim", () => {
    const inner = "\n  line one\n  line two\n";
    const content = `<!-- agentfile:preserve id="z" -->${inner}<!-- agentfile:end-preserve -->`;
    const zones = extractPreservedZones(content);
    expect(zones.get("z")).toBe(inner);
  });
});

// ─── renderTemplate — preserve zones ──────────────────────────────────────

describe("renderTemplate — preserve zones", () => {
  const template = [
    "## Coding",
    "${rules.coding}",
    "",
    '<!-- agentfile:preserve id="ide-registration" -->',
    "<!-- agentfile:end-preserve -->",
  ].join("\n");

  it("renders preserve markers with empty inner content on first sync (no zones)", () => {
    const result = renderTemplate(template, ctx);
    expect(result).toContain(
      '<!-- agentfile:preserve id="ide-registration" -->',
    );
    expect(result).toContain("<!-- agentfile:end-preserve -->");
  });

  it("re-injects preserved content on subsequent sync", () => {
    const preserved = "\n<agents><agent><name>dev</name></agent></agents>\n";
    const zones = new Map([["ide-registration", preserved]]);
    const result = renderTemplate(template, ctx, "markdown", zones);
    expect(result).toContain("<agents>");
    expect(result).toContain("dev");
  });

  it("refreshes generated content while keeping preserved zone intact", () => {
    const zones = new Map([
      ["ide-registration", "\n<agents>custom</agents>\n"],
    ]);
    const result = renderTemplate(template, ctx, "markdown", zones);
    // Generated rule is refreshed
    expect(result).toContain("- Prefer small functions");
    // Preserved zone is kept
    expect(result).toContain("<agents>custom</agents>");
  });

  it("keeps template default when no matching zone is supplied", () => {
    const templateWithDefault = [
      '<!-- agentfile:preserve id="my-zone" -->',
      "default content here",
      "<!-- agentfile:end-preserve -->",
    ].join("\n");

    // Empty zones map — nothing to re-inject
    const result = renderTemplate(
      templateWithDefault,
      ctx,
      "markdown",
      new Map(),
    );
    expect(result).toContain("default content here");
  });

  it("handles multiple preserve zones in one template independently", () => {
    const multiTemplate = [
      '<!-- agentfile:preserve id="alpha" --><!-- agentfile:end-preserve -->',
      '<!-- agentfile:preserve id="beta" --><!-- agentfile:end-preserve -->',
    ].join("\n");

    const zones = new Map([
      ["alpha", "ALPHA_CONTENT"],
      ["beta", "BETA_CONTENT"],
    ]);

    const result = renderTemplate(multiTemplate, ctx, "markdown", zones);
    expect(result).toContain("ALPHA_CONTENT");
    expect(result).toContain("BETA_CONTENT");
  });

  it("round-trips: extracting zones from a rendered file and re-rendering produces identical output", () => {
    const zones = new Map([
      [
        "ide-registration",
        "\n<agents><agent><name>dev</name></agent></agents>\n",
      ],
    ]);
    const firstRender = renderTemplate(template, ctx, "markdown", zones);
    const extracted = extractPreservedZones(firstRender);
    const secondRender = renderTemplate(template, ctx, "markdown", extracted);
    expect(secondRender).toBe(firstRender);
  });
});

// ─── ArtifactSchema ───────────────────────────────────────────────────────

describe("ArtifactSchema", () => {
  it("accepts a minimal artifact", () => {
    expect(() =>
      ArtifactSchema.parse({
        name: "developer",
        type: "agent",
      }),
    ).not.toThrow();
  });

  it("accepts a fully specified artifact", () => {
    expect(() =>
      ArtifactSchema.parse({
        name: "developer",
        type: "agent",
        description: "Implements stories end-to-end",
        content_file: "ai/agents/developer.md",
        metadata: {
          model: "claude-sonnet",
          tools: ["ado", "figma"],
          argumentHint: "A story ID or URL",
        },
      }),
    ).not.toThrow();
  });

  it("rejects a missing name", () => {
    expect(() => ArtifactSchema.parse({ type: "agent" })).toThrow();
  });

  it("rejects a missing type", () => {
    expect(() => ArtifactSchema.parse({ name: "x" })).toThrow();
  });

  it("defaults metadata to empty object", () => {
    const artifact = ArtifactSchema.parse({ name: "x", type: "y" });
    expect(artifact.metadata).toEqual({});
  });

  it("defaults description to empty string", () => {
    const artifact = ArtifactSchema.parse({ name: "x", type: "y" });
    expect(artifact.description).toBe("");
  });

  it("accepts any string as type (not an enum)", () => {
    expect(() =>
      ArtifactSchema.parse({ name: "x", type: "custom-widget" }),
    ).not.toThrow();
  });
});

// ─── ArtifactTemplateSchema ───────────────────────────────────────────────

describe("ArtifactTemplateSchema", () => {
  it("accepts a minimal template config", () => {
    expect(() =>
      ArtifactTemplateSchema.parse({
        output_pattern: ".github/agents/${name}.agent.md",
        template: "agent.md",
      }),
    ).not.toThrow();
  });

  it("defaults aggregate to false", () => {
    const config = ArtifactTemplateSchema.parse({
      output_pattern: "out/${name}.md",
      template: "tmpl.md",
    });
    expect(config.aggregate).toBe(false);
  });

  it("accepts aggregate: true", () => {
    const config = ArtifactTemplateSchema.parse({
      output_pattern: "mcp.json",
      template: "mcp.json.md",
      aggregate: true,
    });
    expect(config.aggregate).toBe(true);
  });

  it("rejects missing output_pattern", () => {
    expect(() =>
      ArtifactTemplateSchema.parse({ template: "agent.md" }),
    ).toThrow();
  });

  it("rejects missing template", () => {
    expect(() =>
      ArtifactTemplateSchema.parse({
        output_pattern: ".github/agents/${name}.agent.md",
      }),
    ).toThrow();
  });
});

// ─── ContractSchema — artifacts & docs ─────────────────────────────────────

describe("ContractSchema — artifacts & docs", () => {
  const minimal = {
    version: 1 as const,
    project: { name: "Test", stack: ["node"] },
    skills: [{ name: "x", description: "y", steps: ["z"] }],
  };

  it("accepts a contract with artifacts[]", () => {
    expect(() =>
      ContractSchema.parse({
        ...minimal,
        artifacts: [
          {
            name: "developer",
            type: "agent",
            description: "Implements stories",
            metadata: { model: "claude-sonnet", tools: ["ado"] },
          },
        ],
      }),
    ).not.toThrow();
  });

  it("accepts a contract with docs[]", () => {
    expect(() =>
      ContractSchema.parse({
        ...minimal,
        docs: [
          {
            name: "definition-of-done",
            file: ".definitions/DEFINITION_OF_DONE.md",
            token: "DOD",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("defaults artifacts and docs to empty arrays when absent", () => {
    const contract = ContractSchema.parse(minimal);
    expect(contract.artifacts).toEqual([]);
    expect(contract.docs).toEqual([]);
  });

  it("supports mixed artifact types in one contract", () => {
    const contract = ContractSchema.parse({
      ...minimal,
      artifacts: [
        { name: "developer", type: "agent", description: "Agent" },
        { name: "write-tests", type: "command", description: "Command" },
        {
          name: "ado",
          type: "mcp-server",
          metadata: { transport: "stdio", command: "npx" },
        },
      ],
    });
    expect(contract.artifacts).toHaveLength(3);
    expect(contract.artifacts.map((a: Artifact) => a.type)).toEqual([
      "agent",
      "command",
      "mcp-server",
    ]);
  });
});

// ─── buildArtifactTokens ──────────────────────────────────────────────────

describe("buildArtifactTokens", () => {
  const artifact: Artifact = ArtifactSchema.parse({
    name: "developer",
    type: "agent",
    description: "Implements stories",
    metadata: { model: "claude-sonnet", tools: ["ado", "figma"] },
  });

  it("includes name, type, description, and body", () => {
    const tokens = buildArtifactTokens(artifact, "System prompt body.");
    expect(tokens.name).toBe("developer");
    expect(tokens.type).toBe("agent");
    expect(tokens.description).toBe("Implements stories");
    expect(tokens.body).toBe("System prompt body.");
  });

  it("flattens metadata keys with metadata. prefix", () => {
    const tokens = buildArtifactTokens(artifact, "");
    expect(tokens["metadata.model"]).toBe("claude-sonnet");
  });

  it("joins array metadata values with commas", () => {
    const tokens = buildArtifactTokens(artifact, "");
    expect(tokens["metadata.tools"]).toBe("ado, figma");
  });

  it("handles empty metadata", () => {
    const simple = ArtifactSchema.parse({ name: "x", type: "y" });
    const tokens = buildArtifactTokens(simple, "body");
    expect(tokens.name).toBe("x");
    expect(
      Object.keys(tokens).filter((k) => k.startsWith("metadata.")),
    ).toEqual([]);
  });

  it("stringifies object metadata as JSON", () => {
    const a = ArtifactSchema.parse({
      name: "x",
      type: "y",
      metadata: { config: { key: "val" } },
    });
    const tokens = buildArtifactTokens(a, "");
    expect(tokens["metadata.config"]).toBe('{"key":"val"}');
  });
});

// ─── buildAggregateArtifactTokens ─────────────────────────────────────────

describe("buildAggregateArtifactTokens", () => {
  it("produces artifacts_json and artifacts_count", () => {
    const artifacts = [
      ArtifactSchema.parse({ name: "a", type: "mcp-server" }),
      ArtifactSchema.parse({ name: "b", type: "mcp-server" }),
    ];
    const bodies = new Map<string, string>();
    const tokens = buildAggregateArtifactTokens(artifacts, bodies);
    expect(tokens.artifacts_count).toBe("2");
    const parsed = JSON.parse(tokens.artifacts_json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("a");
    expect(parsed[1].name).toBe("b");
  });

  it("includes body content from the bodies map", () => {
    const artifacts = [ArtifactSchema.parse({ name: "a", type: "agent" })];
    const bodies = new Map([["a", "Body content"]]);
    const tokens = buildAggregateArtifactTokens(artifacts, bodies);
    const parsed = JSON.parse(tokens.artifacts_json);
    expect(parsed[0].body).toBe("Body content");
  });

  it("uses empty string for missing body", () => {
    const artifacts = [ArtifactSchema.parse({ name: "a", type: "agent" })];
    const tokens = buildAggregateArtifactTokens(artifacts, new Map());
    const parsed = JSON.parse(tokens.artifacts_json);
    expect(parsed[0].body).toBe("");
  });
});

// ─── renderArtifactTemplate ───────────────────────────────────────────────

describe("renderArtifactTemplate", () => {
  it("replaces tokens in template", () => {
    const template = "---\ndescription: ${description}\n---\n\n${body}";
    const tokens = { description: "My agent", body: "Do the thing." };
    const result = renderArtifactTemplate(template, tokens);
    expect(result).toContain("description: My agent");
    expect(result).toContain("Do the thing.");
  });

  it("leaves unreferenced tokens in place", () => {
    const template = "Name: ${name}, Other: ${unknown}";
    const tokens = { name: "dev" };
    const result = renderArtifactTemplate(template, tokens);
    expect(result).toContain("Name: dev");
    expect(result).toContain("${unknown}");
  });

  it("handles metadata. prefixed tokens", () => {
    const template = "Model: ${metadata.model}\nTools: ${metadata.tools}";
    const tokens = {
      "metadata.model": "claude-sonnet",
      "metadata.tools": "ado, figma",
    };
    const result = renderArtifactTemplate(template, tokens);
    expect(result).toContain("Model: claude-sonnet");
    expect(result).toContain("Tools: ado, figma");
  });

  it("trims and adds single trailing newline", () => {
    const result = renderArtifactTemplate("  hello  ", {});
    expect(result).toBe("hello\n");
  });

  it("end-to-end: artifact → tokens → rendered template", () => {
    const artifact: Artifact = ArtifactSchema.parse({
      name: "developer",
      type: "agent",
      description: "Implements stories",
      metadata: { model: "claude-sonnet", tools: ["ado"] },
    });
    const template = [
      "---",
      "description: ${description}",
      "model: ${metadata.model}",
      "tools: ${metadata.tools}",
      "---",
      "",
      "${body}",
    ].join("\n");

    const tokens = buildArtifactTokens(artifact, "Follow the workflow.");
    const result = renderArtifactTemplate(template, tokens);
    expect(result).toContain("description: Implements stories");
    expect(result).toContain("model: claude-sonnet");
    expect(result).toContain("tools: ado");
    expect(result).toContain("Follow the workflow.");
  });
});

// ─── buildDocsTokens ──────────────────────────────────────────────────────

describe("buildDocsTokens", () => {
  it("returns an empty object for an empty docs array", () => {
    expect(buildDocsTokens([])).toEqual({});
  });

  it("maps token to file path using the token field", () => {
    const doc = DocReferenceSchema.parse({
      name: "definition-of-done",
      file: ".definitions/DEFINITION_OF_DONE.md",
      token: "DOD",
    });
    const tokens = buildDocsTokens([doc]);
    expect(tokens["docs.DOD"]).toBe(".definitions/DEFINITION_OF_DONE.md");
  });

  it("falls back to name when token is absent", () => {
    const doc = DocReferenceSchema.parse({
      name: "definition-of-ready",
      file: ".definitions/DOR.md",
    });
    const tokens = buildDocsTokens([doc]);
    expect(tokens["docs.definition-of-ready"]).toBe(".definitions/DOR.md");
  });
});

// ─── renderTemplate — docs token injection ────────────────────────────────

describe("renderTemplate — docs token injection", () => {
  it("resolves ${docs.<token>} to the doc file path in templates", () => {
    const contractWithDocs = ContractSchema.parse({
      version: 1,
      project: { name: "Test", stack: ["node"] },
      skills: [{ name: "x", description: "y", steps: ["z"] }],
      docs: [
        {
          name: "definition-of-done",
          file: ".definitions/DEFINITION_OF_DONE.md",
          token: "DOD",
        },
      ],
    });
    const docsCtx: RenderContext = {
      contract: contractWithDocs,
      override: null,
    };
    const result = renderTemplate(
      "Refer to ${docs.DOD} for acceptance criteria.",
      docsCtx,
    );
    expect(result).toContain(".definitions/DEFINITION_OF_DONE.md");
    expect(result).not.toContain("${docs.DOD}");
  });

  it("resolves ${docs.<name>} when no explicit token is set", () => {
    const contractWithDocs = ContractSchema.parse({
      version: 1,
      project: { name: "Test", stack: ["node"] },
      skills: [{ name: "x", description: "y", steps: ["z"] }],
      docs: [{ name: "my-doc", file: "docs/my-doc.md" }],
    });
    const docsCtx: RenderContext = {
      contract: contractWithDocs,
      override: null,
    };
    const result = renderTemplate("See ${docs.my-doc}.", docsCtx);
    expect(result).toContain("docs/my-doc.md");
  });
});
