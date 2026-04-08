import type { MergeResult, ParsedFile, RuleCategory } from "./types.js";

const RULE_CATEGORIES: RuleCategory[] = ["coding", "architecture", "testing", "naming"];

export function mergeFiles(files: ParsedFile[]): MergeResult {
  const result: MergeResult = {
    rules: { coding: [], architecture: [], testing: [], naming: [] },
    skills: [],
    conflicts: [],
  };

  for (const file of files) {
    for (const category of RULE_CATEGORIES) {
      for (const rule of file.rules[category]) {
        if (!result.rules[category].includes(rule)) {
          result.rules[category].push(rule);
        }
      }
    }
  }

  for (const file of files) {
    for (const skill of file.skills) {
      const existing = result.skills.find((item) => item.name === skill.name);
      if (!existing) {
        result.skills.push(skill);
      } else if (skill.description && existing.description !== skill.description) {
        result.conflicts.push(
          `Skill "${skill.name}" has differing descriptions between source files — kept first, review manually`,
        );
      }
    }
  }

  return result;
}
