import { describe, expect, it } from "vitest";
import {
  allDiagnosticCodes,
  buildReport,
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_REPORT_VERSION,
  type Diagnostic,
  diagnostic,
  diagnosticMeta,
  formatHuman,
  formatJson,
  hasErrors,
  sortDiagnostics,
  summarize,
} from "../src/diagnostics/index.ts";

describe("code registry", () => {
  it("uses the AGFnnn code shape throughout", () => {
    for (const code of allDiagnosticCodes()) {
      expect(code).toMatch(/^AGF\d{3}$/);
    }
  });

  it("gives every code complete metadata", () => {
    for (const code of allDiagnosticCodes()) {
      const meta = diagnosticMeta(code);
      expect(meta.name).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(meta.title.length).toBeGreaterThan(0);
      expect(["error", "warning", "info"]).toContain(meta.defaultSeverity);
      expect(["active", "reserved", "retired"]).toContain(meta.status);
    }
  });

  it("keeps slugs unique so they can be used in docs URLs", () => {
    const names = allDiagnosticCodes().map((code) => diagnosticMeta(code).name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("places each code in the band its number implies", () => {
    const bandForDigit: Record<string, string> = {
      "0": "configuration",
      "1": "skills",
      "2": "targets",
      "3": "resolution",
      "4": "context",
      "5": "security",
      "6": "evaluation",
    };

    for (const code of allDiagnosticCodes()) {
      expect(diagnosticMeta(code).band).toBe(bandForDigit[code.charAt(3)]);
    }
  });

  it("keeps the codes named in the rework brief at their documented meaning", () => {
    expect(DIAGNOSTIC_CODES.AGF001.name).toBe("invalid-configuration");
    expect(DIAGNOSTIC_CODES.AGF101.name).toBe("invalid-skill");
    expect(DIAGNOSTIC_CODES.AGF102.name).toBe("missing-skill-metadata");
    expect(DIAGNOSTIC_CODES.AGF201.name).toBe("unsupported-target-feature");
    expect(DIAGNOSTIC_CODES.AGF301.name).toBe("conflicting-instructions");
    expect(DIAGNOSTIC_CODES.AGF302.name).toBe("duplicate-instruction");
    expect(DIAGNOSTIC_CODES.AGF401.name).toBe("context-overload");
    expect(DIAGNOSTIC_CODES.AGF501.name).toBe("security-issue");
    expect(DIAGNOSTIC_CODES.AGF601.name).toBe("behavioral-regression");
  });
});

describe("diagnostic", () => {
  it("applies the code's default severity", () => {
    expect(diagnostic({ code: "AGF001", message: "bad" }).severity).toBe("error");
    expect(diagnostic({ code: "AGF302", message: "dupe" }).severity).toBe("warning");
    expect(diagnostic({ code: "AGF203", message: "unknown" }).severity).toBe("info");
  });

  it("lets an emitter override severity", () => {
    expect(diagnostic({ code: "AGF001", message: "bad", severity: "warning" }).severity).toBe("warning");
  });
});

const sample: Diagnostic[] = [
  diagnostic({ code: "AGF302", message: "duplicate", location: { file: "b.yaml", line: 2 } }),
  diagnostic({ code: "AGF001", message: "invalid", location: { file: "a.yaml", line: 10, column: 3 } }),
  diagnostic({ code: "AGF203", message: "unverified" }),
];

describe("summarize and hasErrors", () => {
  it("counts by severity", () => {
    expect(summarize(sample)).toEqual({ errors: 1, warnings: 1, infos: 1, total: 3 });
  });

  it("detects errors", () => {
    expect(hasErrors(sample)).toBe(true);
    expect(hasErrors([sample[0]])).toBe(false);
  });

  it("reports an empty list as clean", () => {
    expect(summarize([])).toEqual({ errors: 0, warnings: 0, infos: 0, total: 0 });
    expect(hasErrors([])).toBe(false);
  });
});

describe("sortDiagnostics", () => {
  it("orders by file, then line, then column, then code", () => {
    const ordered = sortDiagnostics(sample).map((item) => `${item.location?.file ?? ""}:${item.code}`);
    expect(ordered).toEqual([":AGF203", "a.yaml:AGF001", "b.yaml:AGF302"]);
  });

  it("does not mutate the input", () => {
    const input = [...sample];
    sortDiagnostics(input);
    expect(input).toEqual(sample);
  });
});

describe("formatHuman", () => {
  const rich = diagnostic({
    code: "AGF302",
    message: 'Duplicate instruction: "use pnpm"',
    explanation: "The same instruction reaches this path from 2 different files.",
    suggestion: "Keep the instruction in one place.",
    location: { file: "AGENTS.md", line: 4 },
    related: [{ location: { file: "apps/mobile/AGENTS.md", line: 9 }, message: "also declared here" }],
  });

  it("leads with severity, code, and message", () => {
    expect(formatHuman([rich])).toContain('warning AGF302: Duplicate instruction: "use pnpm"');
  });

  it("lists every source location involved", () => {
    const output = formatHuman([rich]);
    expect(output).toContain("AGENTS.md:4");
    expect(output).toContain("apps/mobile/AGENTS.md:9 — also declared here");
  });

  it("renders the explanation and the suggested fix", () => {
    const output = formatHuman([rich]);
    expect(output).toContain("The same instruction reaches this path");
    expect(output).toContain("Suggested fix:");
    expect(output).toContain("Keep the instruction in one place.");
  });

  it("summarises the run", () => {
    expect(formatHuman(sample)).toContain("3 problems (1 error, 1 warning, 1 info)");
  });

  it("says so plainly when there is nothing to report", () => {
    expect(formatHuman([])).toBe("No problems found.");
  });

  it("can omit codes and the summary", () => {
    const output = formatHuman([rich], { showCodes: false, showSummary: false });
    expect(output).not.toContain("AGF302");
    expect(output).not.toContain("problem");
  });
});

describe("formatJson", () => {
  it("emits a versioned envelope with a summary", () => {
    const report = buildReport(sample);
    expect(report.version).toBe(DIAGNOSTIC_REPORT_VERSION);
    expect(report.summary.total).toBe(3);
  });

  it("denormalises registry metadata onto each entry", () => {
    const [first] = buildReport([sample[1]]).diagnostics;
    expect(first.code).toBe("AGF001");
    expect(first.name).toBe("invalid-configuration");
    expect(first.band).toBe("configuration");
  });

  it("is deterministic for the same input", () => {
    expect(formatJson(sample)).toBe(formatJson([...sample].reverse()));
  });

  it("produces parseable JSON with a trailing newline", () => {
    const text = formatJson(sample);
    expect(text.endsWith("\n")).toBe(true);
    expect(() => JSON.parse(text)).not.toThrow();
  });
});
