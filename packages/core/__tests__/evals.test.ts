/// <reference types="node" />
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  changedFiles,
  type EvalDefinition,
  evalCacheKey,
  parseEvalDefinition,
  runEval,
  shellQuote,
  temporaryDirectorySandbox,
} from "../src/evals/index.ts";
import { nodeFileSystem } from "../src/fs/index.ts";

// The eval engine executes commands and inspects real state, so these tests use
// real temporary directories — the same isolation the engine itself provides.
const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "agentfile-eval-test-"));
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, relative)), { recursive: true });
    writeFileSync(join(root, relative), content, "utf-8");
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function definition(_root: string, _files: Record<string, string>, overrides: Partial<EvalDefinition>): EvalDefinition {
  return {
    name: "example",
    file: "evals/example.eval.yaml",
    assertions: {},
    ...overrides,
  } as EvalDefinition;
}

function sandboxFor(root: string, files: string[]) {
  return temporaryDirectorySandbox({ root, fs: nodeFileSystem, files });
}

const node = (code: string) => `${shellQuote(process.execPath)} -e ${shellQuote(code)}`;

// ─── Definitions ─────────────────────────────────────────────────────────────

describe("parseEvalDefinition", () => {
  it("parses the REWORK §18 conceptual shape", () => {
    const text = [
      "name: create-react-component",
      "prompt: |",
      "  Create a reusable Button component.",
      "assertions:",
      "  files:",
      "    - src/Button.tsx",
      "  commands:",
      "    - npm test",
      "  contains:",
      "    - accessibility",
      "  forbidden:",
      "    - eval(",
    ].join("\n");

    const parsed = parseEvalDefinition("evals/button.eval.yaml", text);
    expect(parsed.diagnostics).toHaveLength(0);
    expect(parsed.definition?.name).toBe("create-react-component");
    expect(parsed.definition?.assertions.files).toEqual(["src/Button.tsx"]);
    expect(parsed.definition?.file).toBe("evals/button.eval.yaml");
  });

  it("rejects an eval that asserts nothing, because it would pass vacuously", () => {
    const parsed = parseEvalDefinition("e.eval.yaml", "name: empty\nassertions: {}\n");
    expect(parsed.definition).toBeUndefined();
    expect(parsed.diagnostics.some((entry) => entry.message.includes("vacuously"))).toBe(true);
  });

  it("rejects unknown keys instead of ignoring a typo", () => {
    const parsed = parseEvalDefinition(
      "e.eval.yaml",
      "name: typo\nassertion:\n  files: [x]\nassertions:\n  files: [x]\n",
    );
    expect(parsed.definition).toBeUndefined();
    expect(parsed.diagnostics[0]?.code).toBe("AGF001");
  });

  it("locates malformed YAML as AGF003", () => {
    const parsed = parseEvalDefinition("e.eval.yaml", "name: [broken\n");
    expect(parsed.definition).toBeUndefined();
    expect(parsed.diagnostics[0]?.code).toBe("AGF003");
  });

  it("accepts file-pinned text assertions", () => {
    const parsed = parseEvalDefinition(
      "e.eval.yaml",
      ["name: pinned", "assertions:", "  contains:", "    - file: src/a.ts", "      text: hello"].join("\n"),
    );
    expect(parsed.definition?.assertions.contains).toEqual([{ file: "src/a.ts", text: "hello" }]);
  });
});

// ─── Shell quoting ───────────────────────────────────────────────────────────

describe("shellQuote", () => {
  it("keeps a prompt containing quotes and substitutions inert", () => {
    const quoted = shellQuote(`it's $(rm -rf /) \`whoami\``);
    expect(quoted.startsWith("'")).toBe(true);
    expect(quoted.endsWith("'")).toBe(true);
    // The single quote is closed, escaped, reopened — never left raw.
    expect(quoted).toContain(`'\\''`);
  });
});

// ─── Sandbox and change detection ────────────────────────────────────────────

describe("temporaryDirectorySandbox", () => {
  it("seeds the listed files and runs commands inside the copy, not the source", () => {
    const root = fixture({ "src/index.ts": "original\n" });
    const workspace = sandboxFor(root, ["src/index.ts"]).create();

    try {
      expect(workspace.root).not.toBe(root);
      expect(workspace.seeded.has("src/index.ts")).toBe(true);

      const result = workspace.exec(node('require("fs").writeFileSync("src/index.ts", "mutated")'));
      expect(result.exitCode).toBe(0);

      expect(nodeFileSystem.readFile(join(root, "src/index.ts"))).toBe("original\n");
      expect(nodeFileSystem.readFile(join(workspace.root, "src/index.ts"))).toBe("mutated");
    } finally {
      workspace.cleanup();
    }
  });

  it("reports timeouts instead of hanging", () => {
    const root = fixture({});
    const workspace = sandboxFor(root, []).create();

    try {
      const result = workspace.exec(node("setTimeout(() => {}, 60000)"), { timeoutMs: 300 });
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).not.toBe(0);
    } finally {
      workspace.cleanup();
    }
  });
});

describe("changedFiles", () => {
  it("reports created and modified files, not untouched ones", () => {
    const root = fixture({ "keep.txt": "same\n", "edit.txt": "before\n" });
    const workspace = sandboxFor(root, ["keep.txt", "edit.txt"]).create();

    try {
      writeFileSync(join(workspace.root, "edit.txt"), "after\n");
      writeFileSync(join(workspace.root, "new.txt"), "created\n");

      expect(changedFiles(workspace)).toEqual(["edit.txt", "new.txt"]);
    } finally {
      workspace.cleanup();
    }
  });
});

// ─── Runner ──────────────────────────────────────────────────────────────────

describe("runEval", () => {
  it("skips a prompted eval when no agent command is configured, and says why", () => {
    const root = fixture({});
    const result = runEval(definition(root, {}, { prompt: "Do the thing.", assertions: { files: ["out.txt"] } }), {
      sandbox: sandboxFor(root, []),
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("--agent");
  });

  it("runs the agent in the sandbox and judges the state it leaves behind", () => {
    const root = fixture({ "README.md": "seed\n" });
    const agent = node(
      'require("fs").mkdirSync("src", {recursive: true}); require("fs").writeFileSync("src/Button.tsx", "// accessibility first\\n")',
    );

    const result = runEval(
      definition(
        root,
        {},
        {
          prompt: "Create a Button component.",
          assertions: {
            files: ["src/Button.tsx"],
            absent: ["src/Button.js"],
            contains: ["accessibility"],
            forbidden: ["eval("],
            commands: [node("process.exit(0)")],
          },
        },
      ),
      { sandbox: sandboxFor(root, ["README.md"]), agentCommand: agent },
    );

    expect(result.status).toBe("passed");
    expect(result.agent?.exitCode).toBe(0);
    expect(result.changedFiles).toEqual(["src/Button.tsx"]);
    expect(result.assertions.every((assertion) => assertion.passed)).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("delivers the prompt as data even when it contains shell metacharacters", () => {
    const root = fixture({});
    const prompt = `it's "quoted" and $(dangerous)`;
    const agent = node('require("fs").writeFileSync("prompt.txt", process.env.AGENTFILE_EVAL_PROMPT)');

    const result = runEval(
      definition(
        root,
        {},
        {
          prompt,
          assertions: { contains: [{ file: "prompt.txt", text: prompt }] },
        },
      ),
      { sandbox: sandboxFor(root, []), agentCommand: agent },
    );

    expect(result.status).toBe("passed");
  });

  it("fails with AGF602 findings that carry the observation", () => {
    const root = fixture({});
    const result = runEval(
      definition(
        root,
        {},
        {
          assertions: { files: ["missing.txt"], commands: [node("process.exit(3)")] },
        },
      ),
      { sandbox: sandboxFor(root, []) },
    );

    expect(result.status).toBe("failed");
    expect(result.assertions.map((assertion) => assertion.passed)).toEqual([false, false]);
    expect(result.assertions[1].detail).toContain("exit 3");
    expect(result.diagnostics).toHaveLength(2);
    for (const finding of result.diagnostics) {
      expect(finding.code).toBe("AGF602");
      expect(finding.data?.eval).toBe("example");
    }
  });

  it("treats a failing setup command as a harness error, not an eval failure", () => {
    const root = fixture({});
    const result = runEval(
      definition(
        root,
        {},
        {
          setup: [node("process.exit(1)")],
          assertions: { files: ["x"] },
        },
      ),
      { sandbox: sandboxFor(root, []) },
    );

    expect(result.status).toBe("error");
    expect(result.reason).toContain("setup command failed");
    expect(result.assertions).toHaveLength(0);
  });

  it("records a non-zero agent exit but still judges the resulting state", () => {
    const root = fixture({});
    const agent = node('require("fs").writeFileSync("out.txt", "done"); process.exit(1)');

    const result = runEval(definition(root, {}, { prompt: "x", assertions: { files: ["out.txt"] } }), {
      sandbox: sandboxFor(root, []),
      agentCommand: agent,
    });

    expect(result.agent?.exitCode).toBe(1);
    expect(result.status).toBe("passed");
  });

  it("keeps the workspace only when asked", () => {
    const root = fixture({});
    const kept = runEval(definition(root, {}, { assertions: { absent: ["x"] } }), {
      sandbox: sandboxFor(root, []),
      keepWorkspace: true,
    });

    expect(kept.workspaceRoot).toBeDefined();
    expect(nodeFileSystem.isDirectory(kept.workspaceRoot as string)).toBe(true);
    rmSync(kept.workspaceRoot as string, { recursive: true, force: true });

    const cleaned = runEval(definition(root, {}, { assertions: { absent: ["x"] } }), {
      sandbox: sandboxFor(root, []),
    });
    expect(cleaned.workspaceRoot).toBeUndefined();
  });
});

// ─── Cache identity ──────────────────────────────────────────────────────────

describe("evalCacheKey", () => {
  it("changes when any input changes, and only then", () => {
    const base = evalCacheKey("def", "agent", "state");
    expect(evalCacheKey("def", "agent", "state")).toBe(base);
    expect(evalCacheKey("def2", "agent", "state")).not.toBe(base);
    expect(evalCacheKey("def", "agent2", "state")).not.toBe(base);
    expect(evalCacheKey("def", "agent", "state2")).not.toBe(base);
    expect(evalCacheKey("def", undefined, "state")).not.toBe(base);
  });
});
