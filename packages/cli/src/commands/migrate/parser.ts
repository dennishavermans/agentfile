/// <reference types="node" />
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { ParsedFile, ParsedSkill, RuleCategory, Section } from "./types.js";

const RULE_HEADING_PATTERNS: [RegExp, RuleCategory][] = [
  [/^coding(\s+(rules?|standards?))?$/i, "coding"],
  [/^architecture(\s+rules?)?$/i, "architecture"],
  [/^testing(\s+(rules?|standards?))?$/i, "testing"],
  [/^naming(\s+(rules?|conventions?))?$/i, "naming"],
];

const SKILL_CONTAINER_PATTERNS = [
  /^skills?$/i,
  /^skills?\s+\/\s+workflows?$/i,
  /^shared\s+skills?$/i,
  /^workflows?$/i,
  /^agent\s+(skills?|commands?)$/i,
];

function matchRuleCategory(heading: string): RuleCategory | null {
  for (const [pattern, category] of RULE_HEADING_PATTERNS) {
    if (pattern.test(heading.trim())) return category;
  }
  return null;
}

function isSkillContainer(heading: string): boolean {
  return SKILL_CONTAINER_PATTERNS.some((pattern) => pattern.test(heading.trim()));
}

function getHeadingLevel(line: string): number {
  const match = line.match(/^(#+)\s/);
  return match ? match[1].length : 0;
}

function extractHeadingText(line: string): string {
  return line.replace(/^#+\s*/, "").trim();
}

function extractBullets(lines: string[]): string[] {
  const bullets: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s+(.+)/);
    if (match) bullets.push(match[1].trim());
  }
  return bullets;
}

function extractNumberedList(lines: string[]): string[] {
  const items: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*\d+[.)]\s+(.+)/);
    if (match) items.push(match[1].trim());
  }
  return items;
}

function parseSections(lines: string[]): Section[] {
  const sections: Section[] = [];
  const stack: Section[] = [];

  for (const line of lines) {
    const level = getHeadingLevel(line);
    if (level > 0) {
      const section: Section = {
        level,
        heading: extractHeadingText(line),
        lines: [],
        children: [],
      };

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        sections.push(section);
      } else {
        stack[stack.length - 1].children.push(section);
      }

      stack.push(section);
    } else if (stack.length > 0) {
      stack[stack.length - 1].lines.push(line);
    }
  }

  return sections;
}

function looksLikeSkill(section: Section): boolean {
  const allText = [...section.lines, ...section.children.map((c) => c.heading)].join(" ");
  return (
    /steps?|expected\s+output|workflow/i.test(allText) ||
    extractNumberedList(section.lines).length >= 2 ||
    section.children.some((c) => /steps?|output|example/i.test(c.heading))
  );
}

function skillNameFromHeading(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function parseSkillFromSection(section: Section): ParsedSkill {
  const name = skillNameFromHeading(section.heading) || section.heading;

  const descLines: string[] = [];
  const stepLines: string[] = [];
  const outputLines: string[] = [];
  const contextLines: string[] = [];

  type Mode = "desc" | "steps" | "output" | "context";
  let mode: Mode = "desc";

  for (const line of section.lines) {
    const trimmed = line.trim();
    const boldLabel = trimmed.match(/^\*\*(.+?):\*\*\s*(.*)/);

    if (boldLabel) {
      const label = boldLabel[1].toLowerCase();
      const rest = boldLabel[2];
      if (/^steps?$/.test(label)) {
        mode = "steps";
        if (rest) stepLines.push(rest);
      } else if (/expected\s+output/.test(label)) {
        mode = "output";
        if (rest) outputLines.push(rest);
      } else if (/^context$/.test(label)) {
        mode = "context";
        if (rest) contextLines.push(rest);
      } else if (rest) {
        if (mode === "desc") descLines.push(rest);
        else if (mode === "steps") stepLines.push(rest);
      }
      continue;
    }

    if (mode === "desc") descLines.push(line);
    else if (mode === "steps") stepLines.push(line);
    else if (mode === "output") outputLines.push(line);
    else if (mode === "context") contextLines.push(line);
  }

  for (const child of section.children) {
    const label = child.heading.toLowerCase();
    if (/^steps?$/.test(label)) stepLines.push(...child.lines);
    else if (/expected\s+output/.test(label)) outputLines.push(...child.lines);
    else if (/^context$/.test(label)) contextLines.push(...child.lines);
  }

  const description = descLines
    .filter((line) => line.trim())
    .join(" ")
    .trim();

  const steps = [...extractNumberedList(stepLines), ...extractBullets(stepLines)].filter(Boolean);

  const context = [...extractBullets(contextLines)].filter(Boolean);

  const expected_output = outputLines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, ""))
    .join(" ")
    .trim();

  return {
    name,
    description: description || section.heading,
    context,
    steps: steps.length ? steps : ["Describe the steps for this skill"],
    expected_output,
    examples: [],
  };
}

function processSections(sections: Section[], result: ParsedFile): void {
  for (const section of sections) {
    const category = matchRuleCategory(section.heading);
    if (category) {
      result.rules[category].push(...extractBullets(section.lines));
      for (const child of section.children) {
        result.rules[category].push(...extractBullets(child.lines));
      }
      continue;
    }

    if (isSkillContainer(section.heading)) {
      for (const child of section.children) {
        result.skills.push(parseSkillFromSection(child));
      }

      for (const bullet of extractBullets(section.lines)) {
        const compact = bullet.match(/^\*\*(.+?)\*\*:\s*(.+)/);
        if (compact) {
          result.skills.push({
            name: skillNameFromHeading(compact[1]),
            description: compact[2].trim(),
            context: [],
            steps: ["Describe the steps for this skill"],
            expected_output: "",
            examples: [],
          });
        }
      }
      continue;
    }

    if (section.level >= 2 && looksLikeSkill(section)) {
      result.skills.push(parseSkillFromSection(section));
      continue;
    }

    if (section.children.length > 0) {
      processSections(section.children, result);
      continue;
    }

    const lineCount = section.lines.filter((line) => line.trim()).length;
    if (lineCount > 0) {
      result.unrecognized.push({ heading: section.heading, lineCount });
    }
  }
}

export function parseAgentFile(filePath: string): ParsedFile {
  const source = basename(filePath);
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  const result: ParsedFile = {
    source,
    rules: { coding: [], architecture: [], testing: [], naming: [] },
    skills: [],
    unrecognized: [],
  };

  for (const line of lines.slice(0, 20)) {
    const nameMatch = line.match(/\*\*(?:project|app(?:lication)?)(?::\*\*|\*\*:)\s*(.+)/i);
    if (nameMatch && !result.projectName) {
      result.projectName = nameMatch[1].trim();
    }

    const stackMatch = line.match(/\*\*stack(?::\*\*|\*\*:)\s*(.+)/i);
    if (stackMatch && !result.stack) {
      result.stack = stackMatch[1]
        .split(/[,/]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  processSections(parseSections(lines), result);
  return result;
}
