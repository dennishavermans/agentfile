import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { performance } from "perf_hooks";

import {
  generate,
  renderTemplate,
  type Contract,
  type Override,
  type RenderContext,
} from "../src/index.ts";

type BenchmarkResult = {
  iterations: number;
  totalMs: number;
};

const SKILL_COUNT = 60;
const RULE_COUNT = 12;

function buildContract(): Contract {
  return {
    version: 1,
    project: {
      name: "Benchmark Project",
      stack: ["typescript", "node", "vitest", "yaml"],
    },
    rules: {
      coding: Array.from(
        { length: RULE_COUNT },
        (_, index) => `Coding rule ${index + 1}`,
      ),
      architecture: Array.from(
        { length: RULE_COUNT },
        (_, index) => `Architecture rule ${index + 1}`,
      ),
      testing: Array.from(
        { length: RULE_COUNT },
        (_, index) => `Testing rule ${index + 1}`,
      ),
      naming: Array.from(
        { length: RULE_COUNT },
        (_, index) => `Naming rule ${index + 1}`,
      ),
    },
    skills: Array.from({ length: SKILL_COUNT }, (_, index) => ({
      name: `skill-${index + 1}`,
      description: `Benchmark skill ${index + 1}`,
      context: [`Context ${index + 1}a`, `Context ${index + 1}b`],
      steps: [
        `Inspect input ${index + 1}`,
        `Transform data ${index + 1}`,
        `Validate output ${index + 1}`,
      ],
      expected_output: `Expected output ${index + 1}`,
      examples: [
        {
          input: `example-input-${index + 1}`,
          output: `example-output-${index + 1}`,
        },
      ],
    })),
  };
}

function buildOverride(): Override {
  return {
    blocks: [
      {
        section: "Benchmark Override",
        content: Array.from(
          { length: 20 },
          (_, index) => `Override line ${index + 1}`,
        ).join("\n"),
      },
    ],
  };
}

function createTemplate(): string {
  return `# Instructions\n\n**Project:** \${project.name}\n**Stack:** \${project.stack.join(', ')}\n\n## Coding\n\n\${rules.coding}\n\n## Architecture\n\n\${rules.architecture}\n\n## Testing\n\n\${rules.testing}\n\n## Naming\n\n\${rules.naming}\n\${skills}\n\${override}\n`;
}

function toYamlList(items: string[], indent = 4): string {
  return items.map((item) => `${" ".repeat(indent)}- ${item}`).join("\n");
}

function toBlockLines(items: string[], indent = 8): string {
  return items.map((item) => `${" ".repeat(indent)}- ${item}`).join("\n");
}

function toContractYaml(contract: Contract): string {
  const skills = contract.skills
    .map(
      (skill) => `  - name: ${skill.name}
    description: ${skill.description}
    context:
${toBlockLines(skill.context, 6)}
    steps:
${toBlockLines(skill.steps, 6)}
    expected_output: ${skill.expected_output}
    examples:
      - input: "${skill.examples[0]?.input ?? ""}"
        output: "${skill.examples[0]?.output ?? ""}"`,
    )
    .join("\n");

  return `version: 1

project:
  name: ${contract.project.name}
  stack:
${toYamlList(contract.project.stack)}

rules:
  coding:
${toYamlList(contract.rules.coding)}
  architecture:
${toYamlList(contract.rules.architecture)}
  testing:
${toYamlList(contract.rules.testing)}
  naming:
${toYamlList(contract.rules.naming)}

skills:
${skills}
`;
}

function toOverrideYaml(override: Override): string {
  const blocks = override.blocks
    .map(
      (block) => `  - section: ${block.section}
    content: |
${block.content
  .split("\n")
  .map((line) => `      ${line}`)
  .join("\n")}`,
    )
    .join("\n");

  return `blocks:
${blocks}
`;
}

function writeAgent(
  root: string,
  name: string,
  output: string,
  template: string,
  description: string,
): void {
  const agentDir = join(root, "ai", "agents", name);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "config.yaml"),
    `name: ${name}\noutput: ${output}\ndescription: ${description}\n`,
    "utf-8",
  );
  writeFileSync(join(agentDir, "template.md"), template, "utf-8");
}

function createBenchmarkProject(
  contract: Contract,
  override: Override,
  template: string,
): string {
  const root = mkdtempSync(join(tmpdir(), "agentfile-bench-"));

  mkdirSync(join(root, "ai"), { recursive: true });
  writeFileSync(
    join(root, "ai", "contract.yaml"),
    toContractYaml(contract),
    "utf-8",
  );
  writeFileSync(
    join(root, "ai.override.yaml"),
    toOverrideYaml(override),
    "utf-8",
  );

  writeAgent(
    root,
    "claude",
    "CLAUDE.md",
    template,
    "Claude benchmark template",
  );
  writeAgent(
    root,
    "copilot",
    ".github/copilot-instructions.md",
    template,
    "Copilot benchmark template",
  );
  writeAgent(
    root,
    "cursor",
    ".cursor/rules/main.mdc",
    template,
    "Cursor benchmark template",
  );
  writeAgent(
    root,
    "agents-md",
    "AGENTS.md",
    template,
    "AGENTS benchmark template",
  );

  return root;
}

function benchmark(iterations: number, task: () => void): BenchmarkResult {
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    task();
  }
  return {
    iterations,
    totalMs: performance.now() - start,
  };
}

function printResult(label: string, result: BenchmarkResult): void {
  const avgMs = result.totalMs / result.iterations;
  const opsPerSecond = (result.iterations / result.totalMs) * 1000;
  console.log(
    `${label.padEnd(24)} ${result.iterations.toString().padStart(5)} iterations  ${avgMs.toFixed(3).padStart(8)} ms/op  ${opsPerSecond.toFixed(1).padStart(10)} ops/s`,
  );
}

const contract = buildContract();
const override = buildOverride();
const template = createTemplate();
const ctx: RenderContext = { contract, override };
const root = createBenchmarkProject(contract, override, template);

try {
  renderTemplate(template, ctx, "markdown");
  renderTemplate(template, ctx, "copilot");
  generate({
    root,
    agents: ["claude", "copilot", "cursor", "agents-md"],
    dryRun: true,
  });

  console.log("agentfile core benchmark");
  console.log(
    `dataset: ${contract.skills.length} skills, ${RULE_COUNT} rules/category`,
  );
  console.log("");

  printResult(
    "render markdown",
    benchmark(1000, () => {
      renderTemplate(template, ctx, "markdown");
    }),
  );

  printResult(
    "render copilot",
    benchmark(1000, () => {
      renderTemplate(template, ctx, "copilot");
    }),
  );

  printResult(
    "generate dry-run",
    benchmark(200, () => {
      generate({
        root,
        agents: ["claude", "copilot", "cursor", "agents-md"],
        dryRun: true,
      });
    }),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
