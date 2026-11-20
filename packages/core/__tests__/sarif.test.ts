import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  allDiagnosticCodes,
  buildSarif,
  diagnostic,
  docsUrlFor,
  formatSarif,
  githubAnchor,
} from "../src/diagnostics/index.ts";

function log(diagnostics: Parameters<typeof buildSarif>[0]) {
  const built = buildSarif(diagnostics, { version: "9.9.9" }) as {
    version: string;
    runs: Array<{
      tool: { driver: { name: string; version?: string; rules: Array<Record<string, unknown>> } };
      results: Array<Record<string, unknown>>;
    }>;
  };
  return built;
}

describe("buildSarif", () => {
  it("declares the format and the tool", () => {
    const built = log([]);
    expect(built.version).toBe("2.1.0");
    expect(built.runs[0].tool.driver.name).toBe("agentfile");
    expect(built.runs[0].tool.driver.version).toBe("9.9.9");
  });

  it("declares every registered code, not only the ones that fired", () => {
    const built = log([diagnostic({ code: "AGF302", message: "duplicate" })]);
    expect(built.runs[0].tool.driver.rules).toHaveLength(allDiagnosticCodes().length);
  });

  it("gives every rule a documentation link", () => {
    for (const rule of log([]).runs[0].tool.driver.rules) {
      expect(String(rule.helpUri)).toMatch(/^https:\/\/.*diagnostics\.md#agf\d{3}-[a-z-]+$/);
    }
  });

  it("maps severities onto SARIF levels", () => {
    const built = log([
      diagnostic({ code: "AGF001", message: "e", location: { file: "a.md" } }),
      diagnostic({ code: "AGF302", message: "w", location: { file: "b.md" } }),
      diagnostic({ code: "AGF203", message: "i", location: { file: "c.md" } }),
    ]);

    const levels = built.runs[0].results.map((result) => result.level);
    expect(new Set(levels)).toEqual(new Set(["error", "warning", "note"]));
  });

  it("locates a finding with its line", () => {
    const built = log([diagnostic({ code: "AGF302", message: "d", location: { file: "AGENTS.md", line: 3 } })]);
    const location = built.runs[0].results[0].locations as Array<{
      physicalLocation: { artifactLocation: { uri: string }; region?: { startLine: number } };
    }>;

    expect(location[0].physicalLocation.artifactLocation.uri).toBe("AGENTS.md");
    expect(location[0].physicalLocation.region?.startLine).toBe(3);
  });

  it("starts a finding about a whole file on its first line, since GitHub requires a startLine", () => {
    const built = log([diagnostic({ code: "AGF302", message: "d", location: { file: "AGENTS.md" } })]);
    const location = built.runs[0].results[0].locations as Array<{
      physicalLocation: { region?: { startLine: number } };
    }>;
    expect(location[0].physicalLocation.region).toEqual({ startLine: 1 });
  });

  it("uses only GitHub's problem.severity vocabulary", () => {
    const values = new Set(
      log([]).runs[0].tool.driver.rules.map((rule) => (rule.properties as Record<string, unknown>)["problem.severity"]),
    );
    for (const value of values) expect(["error", "warning", "recommendation"]).toContain(value);
    expect(values.has("recommendation")).toBe(true);
  });

  it("gives every rule the description and help text GitHub marks required", () => {
    for (const rule of log([]).runs[0].tool.driver.rules) {
      const fields = rule as { fullDescription?: { text: string }; help?: { text: string; markdown: string } };
      expect(fields.fullDescription?.text.length).toBeGreaterThan(0);
      expect(fields.fullDescription?.text.length).toBeLessThanOrEqual(1024);
      expect(fields.help?.text).toContain(String(rule.helpUri));
      expect(fields.help?.markdown).toContain(String(rule.helpUri));
    }
  });

  it("rates the security band, and only it, so those results become security alerts", () => {
    for (const rule of log([]).runs[0].tool.driver.rules) {
      const properties = rule.properties as Record<string, unknown>;
      const rating = properties["security-severity"];
      if (properties.band === "security") {
        expect(properties.tags).toContain("security");
        // GitHub's buckets: 7.0-8.9 high, 4.0-6.9 medium, 0.1-3.9 low; nothing claims critical.
        expect(Number(rating)).toBeGreaterThanOrEqual(0.1);
        expect(Number(rating)).toBeLessThan(9);
      } else {
        expect(rating).toBeUndefined();
      }
    }
  });

  it("still produces a location for a finding that has none", () => {
    const built = log([diagnostic({ code: "AGF002", message: "nothing found" })]);
    const location = built.runs[0].results[0].locations as Array<{
      physicalLocation: { artifactLocation: { uri: string } };
    }>;

    // Code scanning rejects a result with no location, so a finding about the
    // configuration as a whole is attached to the repository root.
    expect(location).toHaveLength(1);
    expect(location[0].physicalLocation.artifactLocation.uri).toBe(".");
    expect((location[0].physicalLocation as { region?: unknown }).region).toBeUndefined();
  });

  it("carries related locations", () => {
    const built = log([
      diagnostic({
        code: "AGF302",
        message: "d",
        location: { file: "AGENTS.md", line: 1 },
        related: [{ location: { file: "CLAUDE.md", line: 4 }, message: "also here" }],
      }),
    ]);

    const related = built.runs[0].results[0].relatedLocations as Array<{ message: { text: string } }>;
    expect(related).toHaveLength(1);
    expect(related[0].message.text).toBe("also here");
  });

  it("puts the explanation and the fix in the message", () => {
    const built = log([
      diagnostic({ code: "AGF302", message: "d", explanation: "why it matters", suggestion: "do this" }),
    ]);

    const text = (built.runs[0].results[0].message as { text: string }).text;
    expect(text).toContain("why it matters");
    expect(text).toContain("Suggested fix: do this");
  });

  it("fingerprints a finding without its line, so moving it down the file keeps its identity", () => {
    const at = (line: number) =>
      log([diagnostic({ code: "AGF302", message: "d", location: { file: "AGENTS.md", line } })]).runs[0].results[0]
        .partialFingerprints as { agentfileDiagnostic: string };

    expect(at(3).agentfileDiagnostic).toBe(at(40).agentfileDiagnostic);
  });

  it("gives different findings different fingerprints", () => {
    const built = log([
      diagnostic({ code: "AGF302", message: "one", location: { file: "AGENTS.md" } }),
      diagnostic({ code: "AGF302", message: "two", location: { file: "AGENTS.md" } }),
    ]);

    const [first, second] = built.runs[0].results.map(
      (result) => (result.partialFingerprints as { agentfileDiagnostic: string }).agentfileDiagnostic,
    );
    expect(first).not.toBe(second);
  });

  it("is deterministic", () => {
    const findings = [
      diagnostic({ code: "AGF501", message: "b", location: { file: "b.md" } }),
      diagnostic({ code: "AGF302", message: "a", location: { file: "a.md" } }),
    ];

    expect(formatSarif(findings)).toBe(formatSarif(findings));
  });

  it("emits parseable JSON ending in a newline", () => {
    const text = formatSarif([diagnostic({ code: "AGF302", message: "d" })]);
    expect(text.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe("docsUrlFor", () => {
  it("anchors on the code and its slug", () => {
    expect(docsUrlFor("AGF302")).toContain("#agf302-duplicate-instruction");
  });

  it("every anchor resolves to a real heading in the reference documentation", () => {
    const docs = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "diagnostics.md"),
      "utf-8",
    );

    // The anchors GitHub will actually generate for the headings in the file.
    const available = new Set(
      [...docs.matchAll(/^#{2,4} (.+)$/gm)].map((match) => githubAnchor(match[1].replace(/`/g, ""))),
    );

    for (const code of allDiagnosticCodes()) {
      const anchor = docsUrlFor(code).split("#")[1];
      expect(available.has(anchor), `${code}: help link points at #${anchor}, which is not a heading`).toBe(true);
    }
  });
});
