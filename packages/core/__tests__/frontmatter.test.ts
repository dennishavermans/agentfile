import { describe, expect, it } from "vitest";
import {
  booleanField,
  extraFields,
  globListField,
  listField,
  mapField,
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
