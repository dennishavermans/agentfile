/**
 * Structural validation of skills.
 *
 * Everything checked here is a specification requirement with a source, so the
 * findings carry a citation rather than an opinion. Severity, though, follows
 * what the programs do rather than what the specification says: a violation
 * that a loader shrugs off is a warning, however clearly the spec forbids it.
 * Quality judgements live in `quality.ts`.
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
 * Neither absence breaks the skill. Measured on Claude Code 2.1.238: a
 * SKILL.md with no frontmatter at all still loads, is listed with its first
 * heading standing in for the description, and resolves when invoked by name.
 * What a missing description costs is discovery — the description is what an
 * agent weighs when deciding to load a skill unprompted, and a stand-in
 * heading carries far less than a written one.
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
          "The skill still loads and can be invoked by name, but the description is what an agent weighs when deciding to load it unprompted, so without one the skill is rarely chosen. " +
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

  // Name problems are specification violations, not load failures. Measured
  // on Claude Code 2.1.238: a skill named `n8n:create-pr` in a `create-pr/`
  // directory loads and is invoked as `create-pr`; a skill in a directory
  // named `My_Weird.Skill` loads and is invoked as exactly that. The directory
  // is the identity regardless of what the frontmatter says or whether either
  // satisfies the specification's grammar — so a wrong name misleads readers
  // and cross-references rather than breaking the skill, and reporting it at
  // error severity would fail CI over configuration that works.
  const problems = checkName(skill.name, skillDirectoryName(skill));
  const mismatch = problems.some((problem) => problem.kind === "directory-mismatch");

  for (const problem of problems) {
    // An absent name is AGF102's job; this is about a name that is present and wrong.
    if (problem.kind === "empty") continue;

    // A name that both breaks the grammar and differs from its directory is
    // one fact, not two: the declared name is not what the skill loads as.
    if (problem.kind === "invalid-characters" && mismatch) continue;

    const decorative = problem.kind === "invalid-characters" || problem.kind === "directory-mismatch";

    diagnostics.push(
      diagnostic({
        code: "AGF101",
        severity: decorative ? "warning" : undefined,
        message: `Skill "${skill.name}": ${describeNameProblem(skill.name, problem)}`,
        explanation:
          problem.kind === "directory-mismatch"
            ? `Platforms locate a skill by its directory, so the skill will load as "${problem.directory}" while its own frontmatter calls it "${skill.name}". The skill works; anything referring to it by the frontmatter name will not find it.\n\nSpecification:\n  ${SPEC_URL}`
            : problem.kind === "invalid-characters"
              ? `The skill still loads — platforms take the identity from the directory, not from this field — but a stricter loader may reject it, and the specification's grammar exists so a name works everywhere.\n\nSpecification:\n  ${SPEC_URL}`
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
