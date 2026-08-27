/**
 * Structural validation of skills.
 *
 * Everything checked here is a specification requirement with a source, so the
 * findings are errors rather than opinions. Quality judgements live in
 * `quality.ts` and are warnings.
 */

import { type Diagnostic, diagnostic, type Location } from "../diagnostics/index.js";
import type { AgentConfiguration, SkillEntry } from "../ir/index.js";
import { basenameOf } from "../paths/index.js";
import { checkName, describeNameProblem, MAX_COMPATIBILITY_LENGTH, MAX_DESCRIPTION_LENGTH } from "./spec.js";

const SPEC_URL = "https://agentskills.io/specification";

function locationOf(skill: SkillEntry): Location {
  return { file: skill.provenance.file, line: skill.provenance.line };
}

/** Directory name a skill's `name` is required to match, when it has one. */
export function skillDirectoryName(skill: SkillEntry): string | undefined {
  if (!skill.directory) return undefined;
  const name = basenameOf(skill.directory);
  return name || undefined;
}

/**
 * AGF102 for the two fields the specification requires.
 *
 * A skill with no description is not a weak skill, it is an unusable one: the
 * description is the only thing an agent sees before deciding whether to load
 * it, so without one the skill can never be selected.
 */
function checkRequiredFields(skill: SkillEntry): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const location = locationOf(skill);

  if (!skill.name.trim()) {
    diagnostics.push(
      diagnostic({
        code: "AGF102",
        message: "Skill has no name",
        explanation: `The specification requires \`name\`. Without it the skill has no identity to be referenced by.\n\nSpecification:\n  ${SPEC_URL}`,
        suggestion: "Add a `name` to the frontmatter, matching the skill's directory name.",
        location,
      }),
    );
  }

  if (!skill.description.trim()) {
    diagnostics.push(
      diagnostic({
        code: "AGF102",
        message: `Skill "${skill.name || basenameOf(skill.provenance.file)}" has no description`,
        explanation:
          "The description is the only thing an agent sees before deciding whether to load a skill, so a skill without one can never be selected. " +
          `The specification requires it.\n\nSpecification:\n  ${SPEC_URL}`,
        suggestion: "Add a `description` saying what the skill does and when to use it.",
        location,
        data: { skill: skill.name },
      }),
    );
  }

  return diagnostics;
}

/** AGF101 for values that violate a specification constraint. */
function checkConstraints(skill: SkillEntry): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const location = locationOf(skill);

  for (const problem of checkName(skill.name, skillDirectoryName(skill))) {
    // An absent name is AGF102's job; this is about a name that is present and wrong.
    if (problem.kind === "empty") continue;

    diagnostics.push(
      diagnostic({
        code: "AGF101",
        message: `Skill "${skill.name}": ${describeNameProblem(skill.name, problem)}`,
        explanation:
          problem.kind === "directory-mismatch"
            ? `Platforms locate a skill by its directory, so the skill will load as "${problem.directory}" while its own frontmatter calls it "${skill.name}". Anything referring to it by the frontmatter name will not find it.\n\nSpecification:\n  ${SPEC_URL}`
            : `Specification:\n  ${SPEC_URL}`,
        suggestion:
          problem.kind === "directory-mismatch"
            ? `Rename the directory to "${skill.name}", or change \`name\` to "${problem.directory}".`
            : "Correct the name to satisfy the specification.",
        location,
        data: { skill: skill.name, problem: problem.kind },
      }),
    );
  }

  const description = skill.description.trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    diagnostics.push(
      diagnostic({
        code: "AGF101",
        message: `Skill "${skill.name}": description is ${description.length} characters, over the specification's ${MAX_DESCRIPTION_LENGTH}-character limit`,
        explanation: `A description over the limit may be rejected or truncated, and truncation happens where the platform decides rather than where the meaning ends.\n\nSpecification:\n  ${SPEC_URL}`,
        suggestion:
          "Shorten the description to what the agent needs in order to choose the skill, and move the detail into the body.",
        location,
        data: { skill: skill.name, length: description.length, limit: MAX_DESCRIPTION_LENGTH },
      }),
    );
  }

  const compatibility = skill.compatibility?.trim();
  if (compatibility && compatibility.length > MAX_COMPATIBILITY_LENGTH) {
    diagnostics.push(
      diagnostic({
        code: "AGF101",
        message: `Skill "${skill.name}": compatibility is ${compatibility.length} characters, over the specification's ${MAX_COMPATIBILITY_LENGTH}-character limit`,
        explanation: `Specification:\n  ${SPEC_URL}`,
        suggestion: "Shorten the `compatibility` value.",
        location,
        data: { skill: skill.name, length: compatibility.length, limit: MAX_COMPATIBILITY_LENGTH },
      }),
    );
  }

  return diagnostics;
}

/**
 * Two skills sharing a name.
 *
 * Which one an agent loads depends on directory precedence the platforms
 * document differently, so a duplicate name means the answer differs per tool.
 */
function checkDuplicateNames(skills: readonly SkillEntry[]): Diagnostic[] {
  const byName = new Map<string, SkillEntry[]>();

  for (const skill of skills) {
    const name = skill.name.trim();
    if (!name) continue;
    const group = byName.get(name);
    if (group) group.push(skill);
    else byName.set(name, [skill]);
  }

  const diagnostics: Diagnostic[] = [];

  for (const [name, group] of byName) {
    if (group.length < 2) continue;

    const [first, ...rest] = group;
    diagnostics.push(
      diagnostic({
        code: "AGF101",
        message: `${group.length} skills are named "${name}"`,
        explanation:
          "Which one loads depends on directory precedence, and the platforms do not document that the same way, so the answer differs per tool. " +
          `Nothing will report the collision at load time.\n\nSpecification:\n  ${SPEC_URL}`,
        suggestion: "Give each skill a distinct name and directory.",
        location: locationOf(first),
        related: rest.map((skill) => ({
          location: locationOf(skill),
          message: `also named "${name}"`,
        })),
        data: { skill: name, copies: group.length },
      }),
    );
  }

  return diagnostics;
}

/** Every structural finding for every skill in a configuration. */
export function validateSkills(configuration: AgentConfiguration): Diagnostic[] {
  return [
    ...configuration.skills.flatMap(checkRequiredFields),
    ...configuration.skills.flatMap(checkConstraints),
    ...checkDuplicateNames(configuration.skills),
  ];
}
