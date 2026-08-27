import { describe, expect, it } from "vitest";
import { applyConfiguredSeverity, CONFIG_FILE, loadConfig } from "../src/config/index.ts";
import { diagnostic } from "../src/diagnostics/index.ts";
import { memoryFileSystem } from "../src/fs/index.ts";
import { runValidation } from "../src/validation/index.ts";

const ROOT = "/repo";

function load(text?: string) {
  const files: Record<string, string> = {};
  if (text !== undefined) files[`${ROOT}/${CONFIG_FILE}`] = text;
  return loadConfig(ROOT, memoryFileSystem(files));
}

describe("loadConfig", () => {
  it("reports no file as no settings, not as a problem", () => {
    const loaded = load();
    expect(loaded.present).toBe(false);
    expect(loaded.config).toEqual({});
    expect(loaded.diagnostics).toEqual([]);
  });

  it("treats an empty file as no overrides", () => {
    const loaded = load("");
    expect(loaded.present).toBe(true);
    expect(loaded.diagnostics).toEqual([]);
  });

  it("reads every setting", () => {
    const loaded = load(
      [
        "version: 1",
        "ignore:",
        "  - fixtures",
        "severity:",
        "  AGF302: info",
        "budget: 2000",
        "similarity: 0.75",
        "targets: [claude, copilot]",
        "maxWarnings: 5",
        "suppressions: false",
      ].join("\n"),
    );

    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.config).toEqual({
      version: 1,
      ignore: ["fixtures"],
      severity: { AGF302: "info" },
      budget: 2000,
      similarity: 0.75,
      targets: ["claude", "copilot"],
      maxWarnings: 5,
      suppressions: false,
    });
  });

  it("rejects a key nobody recognises rather than ignoring it", () => {
    const loaded = load("sevrity:\n  AGF302: info\n");

    expect(loaded.diagnostics.map((item) => item.code)).toEqual(["AGF001"]);
    expect(loaded.config).toEqual({});
  });

  it("rejects a severity for a code that does not exist", () => {
    const loaded = load("severity:\n  AGF999: info\n");
    expect(loaded.diagnostics.map((item) => item.code)).toEqual(["AGF001"]);
  });

  it("rejects a severity level that is not one", () => {
    const loaded = load("severity:\n  AGF302: loud\n");
    expect(loaded.diagnostics).toHaveLength(1);
  });

  it("locates the problem in the file", () => {
    const loaded = load("budget: -5\n");
    expect(loaded.diagnostics[0].location).toMatchObject({ file: CONFIG_FILE, line: 1 });
  });

  it("uses nothing from a file it rejected", () => {
    const loaded = load("budget: 2000\nnonsense: true\n");

    expect(loaded.diagnostics).toHaveLength(1);
    expect(loaded.config.budget).toBeUndefined();
  });

  it("reports a file that does not parse", () => {
    const loaded = load("severity:\n  - [unclosed\n");
    expect(loaded.diagnostics.length).toBeGreaterThan(0);
    expect(loaded.config).toEqual({});
  });
});

describe("applyConfiguredSeverity", () => {
  const findings = [
    diagnostic({ code: "AGF302", message: "duplicate" }),
    diagnostic({ code: "AGF501", message: "risky" }),
  ];

  it("leaves findings alone when nothing is configured", () => {
    expect(applyConfiguredSeverity(findings, undefined)).toEqual(findings);
  });

  it("replaces the severity of a configured code", () => {
    const result = applyConfiguredSeverity(findings, { AGF302: "info" });
    expect(result.find((item) => item.code === "AGF302")?.severity).toBe("info");
    expect(result.find((item) => item.code === "AGF501")?.severity).toBe("error");
  });

  it("removes a code turned off", () => {
    const result = applyConfiguredSeverity(findings, { AGF302: "off" });
    expect(result.map((item) => item.code)).toEqual(["AGF501"]);
  });
});

describe("configuration through the pipeline", () => {
  const duplicated = "- Use pnpm as the package manager, never npm\n";

  function run(files: Record<string, string>, options: Record<string, unknown> = {}) {
    return runValidation({ root: ROOT, fs: memoryFileSystem(files), ...options });
  }

  it("applies a configured severity to a real finding", () => {
    const result = run({
      [`${ROOT}/AGENTS.md`]: duplicated,
      [`${ROOT}/CLAUDE.md`]: duplicated,
      [`${ROOT}/${CONFIG_FILE}`]: "severity:\n  AGF302: info\n",
    });

    expect(result.diagnostics.find((item) => item.code === "AGF302")?.severity).toBe("info");
    expect(result.summary.warnings).toBe(0);
  });

  it("silences a code turned off repository-wide", () => {
    const result = run({
      [`${ROOT}/AGENTS.md`]: duplicated,
      [`${ROOT}/CLAUDE.md`]: duplicated,
      [`${ROOT}/${CONFIG_FILE}`]: "severity:\n  AGF302: off\n",
    });

    expect(result.diagnostics.map((item) => item.code)).not.toContain("AGF302");
  });

  it("does not let --strict promote a code configured as info", () => {
    const result = run(
      {
        [`${ROOT}/AGENTS.md`]: duplicated,
        [`${ROOT}/CLAUDE.md`]: duplicated,
        [`${ROOT}/${CONFIG_FILE}`]: "severity:\n  AGF302: info\n",
      },
      { strict: true },
    );

    expect(result.summary.errors).toBe(0);
  });

  it("reports a broken settings file rather than running as though it were absent", () => {
    const result = run({
      [`${ROOT}/AGENTS.md`]: duplicated,
      [`${ROOT}/${CONFIG_FILE}`]: "nonsense: true\n",
    });

    expect(result.diagnostics.map((item) => item.code)).toContain("AGF001");
  });

  it("lets an explicit option override the file", () => {
    const files = {
      [`${ROOT}/AGENTS.md`]: duplicated,
      [`${ROOT}/CLAUDE.md`]: duplicated,
      [`${ROOT}/${CONFIG_FILE}`]: "suppressions: false\n",
    };

    expect(run(files, { suppressions: false }).config.suppressions).toBe(false);
    // The flag wins: the file says do not honour directives, the caller says do.
    const withDirective = {
      ...files,
      [`${ROOT}/AGENTS.md`]: `<!-- agentfile-disable AGF302 -->\n${duplicated}`,
    };
    expect(run(withDirective, { suppressions: true }).suppressed.length).toBeGreaterThan(0);
  });

  it("reports the settings in force", () => {
    const result = run({
      [`${ROOT}/AGENTS.md`]: duplicated,
      [`${ROOT}/${CONFIG_FILE}`]: "budget: 1234\n",
    });

    expect(result.config.budget).toBe(1234);
  });
});

describe("instruction size limits", () => {
  const big = `- ${"x".repeat(40 * 1024)}\n`;

  function run(files: Record<string, string>, targets: string[]) {
    return runValidation({ root: ROOT, fs: memoryFileSystem(files), targets, layers: ["compatibility"] });
  }

  it("reports AGENTS.md past what Codex reads", () => {
    const result = run({ [`${ROOT}/AGENTS.md`]: big }, ["codex"]);
    const finding = result.diagnostics.find((item) => item.code === "AGF206");

    expect(finding).toBeDefined();
    expect(finding?.data?.target).toBe("codex");
    expect(finding?.explanation).toContain("truncated");
  });

  it("says nothing when the target with the limit was not named", () => {
    const result = run({ [`${ROOT}/AGENTS.md`]: big }, ["claude"]);
    expect(result.diagnostics.map((item) => item.code)).not.toContain("AGF206");
  });

  it("says nothing about a file under the limit", () => {
    const result = run({ [`${ROOT}/AGENTS.md`]: "- Use pnpm\n" }, ["codex"]);
    expect(result.diagnostics.map((item) => item.code)).not.toContain("AGF206");
  });

  it("measures bytes, not characters", () => {
    // Just under 32 KiB of characters, comfortably over it in UTF-8 bytes.
    const multibyte = `- ${"é".repeat(20 * 1024)}\n`;
    const result = run({ [`${ROOT}/AGENTS.md`]: multibyte }, ["codex"]);
    expect(result.diagnostics.map((item) => item.code)).toContain("AGF206");
  });
});
