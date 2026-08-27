import { describe, expect, it } from "vitest";
import { applySuppressions, diagnostic, parseSuppressions } from "../src/diagnostics/index.ts";
import { memoryFileSystem } from "../src/fs/index.ts";

const ROOT = "/repo";

function finding(code: "AGF302" | "AGF501" | "AGF401", file: string, line?: number) {
  return diagnostic({ code, message: `${code} in ${file}`, location: { file, line } });
}

describe("parseSuppressions", () => {
  it("reads the three comment styles", () => {
    const directives = parseSuppressions(
      [
        "<!-- agentfile-disable-next-line AGF302 -->",
        "# agentfile-disable-line AGF501",
        "// agentfile-disable AGF401",
      ].join("\n"),
    );

    expect(directives.map((entry) => entry.scope)).toEqual(["next-line", "line", "file"]);
    expect(directives.map((entry) => entry.codes)).toEqual([["AGF302"], ["AGF501"], ["AGF401"]]);
  });

  it("treats a directive with no codes as silencing everything", () => {
    const [directive] = parseSuppressions("<!-- agentfile-disable-next-line -->");
    expect(directive.codes).toEqual(["*"]);
  });

  it("reads several codes and keeps the trailing text as a reason", () => {
    const [directive] = parseSuppressions("# agentfile-disable-next-line AGF302, AGF401 mirrored for the audit trail");

    expect(directive.codes).toEqual(["AGF302", "AGF401"]);
    expect(directive.reason).toBe("mirrored for the audit trail");
  });

  it("accepts a separator before the reason and drops the comment terminator", () => {
    const [directive] = parseSuppressions("<!-- agentfile-disable-next-line AGF302 -- reviewed 2026-08 -->");
    expect(directive.reason).toBe("reviewed 2026-08");
  });

  it("records the line a directive governs", () => {
    const directives = parseSuppressions(["one", "<!-- agentfile-disable-next-line AGF302 -->", "three"].join("\n"));
    expect(directives[0]).toMatchObject({ line: 2, targetLine: 3 });
  });

  it("ignores prose that merely mentions the keyword", () => {
    expect(parseSuppressions("Use agentfile-disable-next-line to silence a finding.")).toEqual([]);
  });
});

describe("applySuppressions", () => {
  it("silences the named code on the next line and nothing else", () => {
    const fs = memoryFileSystem({
      "/repo/AGENTS.md": [
        "intro",
        "<!-- agentfile-disable-next-line AGF302 -->",
        "duplicated rule",
        "another rule",
      ].join("\n"),
    });

    const result = applySuppressions([finding("AGF302", "AGENTS.md", 3), finding("AGF302", "AGENTS.md", 4)], {
      root: ROOT,
      fs,
    });

    expect(result.suppressed).toHaveLength(1);
    expect(result.diagnostics.map((item) => item.location?.line)).toEqual([4]);
  });

  it("does not silence a different code on the covered line", () => {
    const fs = memoryFileSystem({
      "/repo/AGENTS.md": ["<!-- agentfile-disable-next-line AGF302 -->", "rule"].join("\n"),
    });

    const result = applySuppressions([finding("AGF501", "AGENTS.md", 2)], { root: ROOT, fs });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.suppressed).toHaveLength(0);
  });

  it("silences every code when the directive names none", () => {
    const fs = memoryFileSystem({
      "/repo/AGENTS.md": ["<!-- agentfile-disable-next-line -->", "rule"].join("\n"),
    });

    const result = applySuppressions([finding("AGF501", "AGENTS.md", 2)], { root: ROOT, fs });
    expect(result.suppressed).toHaveLength(1);
  });

  it("applies a file-scoped directive to every line, including findings with none", () => {
    const fs = memoryFileSystem({
      "/repo/AGENTS.md": ["<!-- agentfile-disable AGF302 -->", "a", "b"].join("\n"),
    });

    const result = applySuppressions(
      [finding("AGF302", "AGENTS.md", 2), finding("AGF302", "AGENTS.md", 99), finding("AGF302", "AGENTS.md")],
      { root: ROOT, fs },
    );

    expect(result.diagnostics).toHaveLength(0);
    expect(result.suppressed).toHaveLength(3);
  });

  it("never silences a finding in another file", () => {
    const fs = memoryFileSystem({
      "/repo/AGENTS.md": "<!-- agentfile-disable AGF302 -->",
      "/repo/CLAUDE.md": "rule",
    });

    const result = applySuppressions([finding("AGF302", "CLAUDE.md", 1)], { root: ROOT, fs });
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps the suppressed finding with the directive that silenced it", () => {
    const fs = memoryFileSystem({
      "/repo/AGENTS.md": ["<!-- agentfile-disable-next-line AGF302 deliberate -->", "rule"].join("\n"),
    });

    const result = applySuppressions([finding("AGF302", "AGENTS.md", 2)], { root: ROOT, fs });

    expect(result.suppressed[0].file).toBe("AGENTS.md");
    expect(result.suppressed[0].diagnostic.code).toBe("AGF302");
    expect(result.suppressed[0].directive.reason).toBe("deliberate");
  });

  it("reports a directive that silenced nothing", () => {
    const fs = memoryFileSystem({
      "/repo/AGENTS.md": ["<!-- agentfile-disable-next-line AGF302 -->", "clean line"].join("\n"),
    });

    const result = applySuppressions([], { root: ROOT, fs, files: ["AGENTS.md"] });

    expect(result.unused).toHaveLength(1);
    expect(result.unused[0].code).toBe("AGF005");
    expect(result.unused[0].location).toEqual({ file: "AGENTS.md", line: 1 });
  });

  it("reports a stale directive in a file that produced no findings at all", () => {
    const fs = memoryFileSystem({
      "/repo/AGENTS.md": "rule",
      "/repo/.cursorrules": ["# agentfile-disable-next-line AGF302", "rule"].join("\n"),
    });

    const result = applySuppressions([finding("AGF501", "AGENTS.md", 1)], {
      root: ROOT,
      fs,
      files: ["AGENTS.md", ".cursorrules"],
    });

    expect(result.unused.map((item) => item.location?.file)).toEqual([".cursorrules"]);
  });

  it("does not report a directive that did its job", () => {
    const fs = memoryFileSystem({
      "/repo/AGENTS.md": ["<!-- agentfile-disable-next-line AGF302 -->", "rule"].join("\n"),
    });

    const result = applySuppressions([finding("AGF302", "AGENTS.md", 2)], { root: ROOT, fs, files: ["AGENTS.md"] });
    expect(result.unused).toHaveLength(0);
  });

  it("can be asked not to report unused directives", () => {
    const fs = memoryFileSystem({ "/repo/AGENTS.md": "<!-- agentfile-disable AGF302 -->" });

    const result = applySuppressions([], { root: ROOT, fs, files: ["AGENTS.md"], reportUnused: false });
    expect(result.unused).toHaveLength(0);
  });

  it("survives a file it cannot read", () => {
    const fs = memoryFileSystem({});
    const result = applySuppressions([finding("AGF302", "gone.md", 1)], { root: ROOT, fs, files: ["gone.md"] });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.unused).toHaveLength(0);
  });

  it("leaves findings with no file alone", () => {
    const fs = memoryFileSystem({ "/repo/AGENTS.md": "<!-- agentfile-disable AGF302 -->" });
    const global = diagnostic({ code: "AGF302", message: "no location" });

    const result = applySuppressions([global], { root: ROOT, fs });
    expect(result.diagnostics).toEqual([global]);
  });
});
