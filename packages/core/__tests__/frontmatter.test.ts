import { describe, expect, it } from "vitest";
import {
  booleanField,
  extraFields,
  globListField,
  listField,
  mapField,
  parseAgentFrontmatter,
  parseFrontmatter,
  stringField,
} from "../src/parsers/index.ts";

describe("parseFrontmatter", () => {
  it("splits frontmatter from the body", () => {
    const parsed = parseFrontmatter("SKILL.md", "---\nname: deploy\n---\n\n# Deploy\n");

    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.data).toEqual({ name: "deploy" });
    expect(parsed.body.trim()).toBe("# Deploy");
    expect(parsed.diagnostics).toEqual([]);
  });

  it("reports the line the body starts on", () => {
    expect(parseFrontmatter("a.md", "---\nname: x\ndescription: y\n---\nBody").bodyLine).toBe(5);
  });

  it("treats a file with no frontmatter as all body", () => {
    const parsed = parseFrontmatter("AGENTS.md", "# Just markdown\n");

    expect(parsed.hasFrontmatter).toBe(false);
    expect(parsed.data).toBeUndefined();
    expect(parsed.body).toBe("# Just markdown\n");
  });

  it("does not treat a horizontal rule mid-document as frontmatter", () => {
    const parsed = parseFrontmatter("a.md", "# Title\n\n---\n\nMore text\n");
    expect(parsed.hasFrontmatter).toBe(false);
  });

  it("reports a bare-glob alias (globs: *.py) as a finding instead of crashing", () => {
    // Real Cursor rules in the wild write `globs: *.py`, which YAML reads as an
    // unresolved alias. The scan must survive it.
    const parsed = parseFrontmatter("rule.mdc", "---\nglobs: *.py\nalwaysApply: false\n---\nBody\n");

    expect(parsed.diagnostics.length).toBeGreaterThan(0);
    expect(parsed.diagnostics[0].code).toBe("AGF003");
    expect(parsed.diagnostics[0].suggestion).toContain("Quote the value, or start the pattern");
    expect(parsed.diagnostics[0].location?.line).toBe(2);
    expect(parsed.data).toBeUndefined();
  });

  // The error `toJS` throws for an unresolved alias carries no position, so
  // line 2 was reported for every one of them — right only when the broken key
  // is the first frontmatter line. langwatch/scenario has five of these and two
  // put `globs:` under `description:`, where the finding pointed at the
  // description instead. SARIF turns that into a code-scanning annotation on
  // the wrong line of someone else's file.
  it("points at the alias, not at the first line of the frontmatter", () => {
    const parsed = parseFrontmatter(
      "rule.mdc",
      "---\ndescription: React and TSX component development guidelines\nglobs: *.tsx\nalwaysApply: false\n---\nBody\n",
    );

    expect(parsed.diagnostics[0].code).toBe("AGF003");
    expect(parsed.diagnostics[0].location?.line).toBe(3);
  });

  it("handles an empty frontmatter block", () => {
    const parsed = parseFrontmatter("a.md", "---\n---\nBody");
    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe("Body");
  });

  it("reports an unclosed frontmatter fence", () => {
    const parsed = parseFrontmatter("a.md", "---\nname: x\n\n# Body with no closing fence\n");

    expect(parsed.diagnostics[0].code).toBe("AGF003");
    expect(parsed.diagnostics[0].message).toContain("never closed");
    // The content is still available as body rather than being discarded.
    expect(parsed.body).toContain("# Body with no closing fence");
  });

  it("reports malformed YAML inside the frontmatter", () => {
    const parsed = parseFrontmatter("a.md", "---\nname: [unclosed\n---\nBody");
    expect(parsed.diagnostics[0].code).toBe("AGF003");
  });

  it("anchors a frontmatter parse error to the right line in the file", () => {
    const parsed = parseFrontmatter("a.md", "---\nname: ok\nbad: [unclosed\n---\nBody");
    // Line 1 is the fence, so a problem on frontmatter line 2 is file line 3.
    expect(parsed.diagnostics[0].location?.line).toBeGreaterThanOrEqual(3);
  });

  it("reports frontmatter that is a list rather than a mapping", () => {
    const parsed = parseFrontmatter("a.md", "---\n- one\n- two\n---\nBody");

    expect(parsed.diagnostics[0].code).toBe("AGF001");
    expect(parsed.diagnostics[0].message).toContain("must be a mapping");
  });
});

describe("field readers", () => {
  const data = {
    name: "deploy",
    count: 3,
    enabled: true,
    stringy: "false",
    tools: ["Read", "Bash"],
    inline: "Read, Bash",
    spaced: "Read Bash",
    metadata: { author: "me", version: 1, nested: { no: "pe" } },
  };

  it("reads string fields and ignores non-strings", () => {
    expect(stringField(data, "name")).toBe("deploy");
    expect(stringField(data, "count")).toBeUndefined();
    expect(stringField(undefined, "name")).toBeUndefined();
  });

  it("reads booleans, including the string spellings YAML users write", () => {
    expect(booleanField(data, "enabled")).toBe(true);
    expect(booleanField(data, "stringy")).toBe(false);
    expect(booleanField(data, "name")).toBeUndefined();
  });

  it("reads a list from either a YAML list or a delimited string", () => {
    expect(listField(data, "tools")).toEqual(["Read", "Bash"]);
    expect(listField(data, "inline")).toEqual(["Read", "Bash"]);
    expect(listField(data, "spaced")).toEqual(["Read", "Bash"]);
    expect(listField(data, "missing")).toBeUndefined();
  });

  it("reads a map, coercing scalars and dropping nested objects", () => {
    expect(mapField(data, "metadata")).toEqual({ author: "me", version: "1" });
    expect(mapField(data, "tools")).toBeUndefined();
  });

  it("collects fields outside a known set", () => {
    expect(
      extraFields(data, ["name", "count", "enabled", "stringy", "tools", "inline", "spaced", "metadata"]),
    ).toBeUndefined();
    expect(extraFields({ name: "x", model: "opus" }, ["name"])).toEqual({ model: "opus" });
  });
});

describe("globListField", () => {
  it("reads a YAML list", () => {
    expect(globListField({ paths: ["src/**/*.ts", "lib/**"] }, "paths")).toEqual(["src/**/*.ts", "lib/**"]);
  });

  it("reads a comma-separated string", () => {
    expect(globListField({ applyTo: "**/*.ts,**/*.tsx" }, "applyTo")).toEqual(["**/*.ts", "**/*.tsx"]);
  });

  it("does not break a brace group", () => {
    expect(globListField({ paths: "src/**/*.{ts,tsx}" }, "paths")).toEqual(["src/**/*.{ts,tsx}"]);
  });

  it("returns undefined for an absent or unusable value", () => {
    expect(globListField({}, "paths")).toBeUndefined();
    expect(globListField({ paths: 7 }, "paths")).toBeUndefined();
    expect(globListField({ paths: [] }, "paths")).toBeUndefined();
  });
});

describe("parseAgentFrontmatter", () => {
  // Pinned to Claude Code 2.1.238, observed rather than inferred: each of these
  // files was placed in `.claude/agents`, and `claude -p` listed all of them as
  // available subagent types with their descriptions read correctly.
  it("reads frontmatter that no strict YAML parser accepts", () => {
    const unclosed = parseAgentFrontmatter("a.md", "---\nname: a\ndescription: [unclosed\n---\n\nBody.\n");
    expect(unclosed.diagnostics).toHaveLength(0);
    expect(stringField(unclosed.data, "description")).toBe("[unclosed");

    // PostHog's shape: an unquoted description carrying `Context: `.
    const colon = parseAgentFrontmatter(
      "b.md",
      "---\nname: b\ndescription: Reviews code. Examples: Context: the user asked.\nmodel: opus\n---\n\nBody.\n",
    );
    expect(colon.diagnostics).toHaveLength(0);
    expect(stringField(colon.data, "description")).toBe("Reviews code. Examples: Context: the user asked.");
    expect(stringField(colon.data, "model")).toBe("opus");
  });

  it("still uses the strict parse when it succeeds, so structured fields keep their shape", () => {
    const parsed = parseAgentFrontmatter(
      "c.md",
      "---\nname: c\ndescription: A thing\ntools:\n  - Read\n  - Write\n---\n\nBody.\n",
    );
    expect(parsed.diagnostics).toHaveLength(0);
    expect(parsed.data?.tools).toEqual(["Read", "Write"]);
  });

  it("still reports an unclosed fence, which breaks the file under any reading", () => {
    const parsed = parseAgentFrontmatter("d.md", "---\nname: d\ndescription: A thing\n\nBody.\n");
    expect(parsed.diagnostics.map((x) => x.code)).toEqual(["AGF003"]);
    expect(parsed.hasFrontmatter).toBe(false);
  });

  it("leaves a file with no frontmatter alone", () => {
    const parsed = parseAgentFrontmatter("e.md", "# Just documentation\n");
    expect(parsed.diagnostics).toHaveLength(0);
    expect(parsed.hasFrontmatter).toBe(false);
  });
});
