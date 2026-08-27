import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allDiagnosticCodes, diagnosticMeta } from "../src/diagnostics/index.ts";

/**
 * Diagnostic codes are a public contract, so the reference documentation has to
 * stay in step with the registry. Checking it here is cheaper and more reliable
 * than remembering: adding a code without documenting it fails the build.
 */

const docsPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "diagnostics.md");
const docs = readFileSync(docsPath, "utf-8");

describe("docs/diagnostics.md", () => {
  it("documents every registered code", () => {
    for (const code of allDiagnosticCodes()) {
      expect(docs, `${code} is missing from docs/diagnostics.md`).toContain(`\`${code}\``);
    }
  });

  it("documents each code with its slug, severity, and status", () => {
    for (const code of allDiagnosticCodes()) {
      const meta = diagnosticMeta(code);
      const heading = `\`${code}\` ${meta.name} · ${meta.defaultSeverity} · ${meta.status}`;
      expect(docs, `heading for ${code} does not match the registry`).toContain(heading);
    }
  });

  it("does not document codes that are not registered", () => {
    const documented = [...docs.matchAll(/`(AGF\d{3})`/g)].map((match) => match[1]);
    const registered = new Set<string>(allDiagnosticCodes());

    for (const code of new Set(documented)) {
      expect(registered.has(code), `${code} is documented but not registered`).toBe(true);
    }
  });

  it("documents every band", () => {
    for (const code of allDiagnosticCodes()) {
      expect(docs).toContain(diagnosticMeta(code).band);
    }
  });
});
