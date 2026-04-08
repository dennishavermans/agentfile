import type { ParsedRules, ParsedSkill, RuleCategory } from "./types.js";

function yamlStr(value: string): string {
  if (!value.trim()) return "''";

  if (/[:#[\]{}&*?|<>=!%@`,]/.test(value) || value.includes("\n")) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  return value;
}

function yamlList(items: string[], indent: number): string {
  const padding = " ".repeat(indent);
  if (!items.length) return `${padding}[]\n`;
  return `${items.map((item) => `${padding}- ${yamlStr(item)}`).join("\n")}\n`;
}

function serializeSkill(skill: ParsedSkill, indent: number): string {
  const padding = " ".repeat(indent);
  const childPadding = " ".repeat(indent + 2);

  let output = `${padding}- name: ${yamlStr(skill.name)}\n`;
  output += `${childPadding}description: ${yamlStr(skill.description)}\n`;

  if (skill.context.length) {
    output += `${childPadding}context:\n`;
    output += yamlList(skill.context, indent + 4);
  } else {
    output += `${childPadding}context: []\n`;
  }

  output += `${childPadding}steps:\n`;
  output += yamlList(skill.steps, indent + 4);

  if (skill.expected_output) {
    output += `${childPadding}expected_output: ${yamlStr(skill.expected_output)}\n`;
  } else {
    output += `${childPadding}expected_output: ''\n`;
  }

  output += `${childPadding}examples: []\n`;
  return output;
}

export function buildContractYaml(
  projectName: string,
  stack: string[],
  rules: ParsedRules,
  skills: ParsedSkill[],
): string {
  const ruleSection = (category: RuleCategory, label: string): string => {
    const items = rules[category];
    if (!items.length) return `  ${label}:\n    - Add ${label} rules here\n`;
    return `  ${label}:\n${yamlList(items, 4)}`;
  };

  const skillsYaml = skills.length
    ? skills.map((skill) => serializeSkill(skill, 2)).join("\n")
    : `  - name: example-skill\n    description: Replace with your first shared workflow\n    context: []\n    steps:\n      - Describe the first step\n    expected_output: ''\n    examples: []\n`;

  const stackList = stack.map((item) => `    - ${item}`).join("\n");

  return `version: 1

project:
  name: ${yamlStr(projectName)}
  stack:
${stackList}

rules:

${ruleSection("coding", "coding")}
${ruleSection("architecture", "architecture")}
${ruleSection("testing", "testing")}
${ruleSection("naming", "naming")}
skills:

${skillsYaml}`;
}
