/**
 * Skill quality analysis.
 *
 * Distinct from `validate.ts`: nothing here violates the specification, so
 * nothing here is an error. These are the ways a specification-compliant skill
 * can still fail to be useful.
 *
 * There is deliberately **no score**. The rework brief is explicit that a
 * scoring system must be explainable and that arbitrary scores are not
 * acceptable, and a single number rolled up from six unrelated signals cannot be
 * explained — it can only be argued with. Each finding stands on its own,
 * carries its own threshold, and says where the threshold came from.
 */

import { analyzeSkillRouting, estimateContext, jaccardSimilarity, tokenize } from "../analysis/index.js";
import { type Diagnostic, diagnostic, type Location } from "../diagnostics/index.js";
import type { AgentConfiguration, SkillEntry } from "../ir/index.js";
import { basenameOf } from "../paths/index.js";
import {
  CLAUDE_EXTENSION_FIELDS,
  CLAUDE_LISTING_LIMIT,
  CURSOR_EXTENSION_FIELDS,
  MAX_RESOURCE_DEPTH,
  RECOMMENDED_BODY_LINES,
  RECOMMENDED_BODY_TOKENS,
  resourceDepth,
} from "./spec.js";

const SPEC_URL = "https://agentskills.io/specification";

/** Similarity at which two skill descriptions stop distinguishing themselves. */
export const AMBIGUOUS_DESCRIPTION_SIMILARITY = 0.6;

/** Longest fenced block a body should carry before it belongs in a resource file. */
export const MAX_INLINE_BLOCK_LINES = 80;

function locationOf(skill: SkillEntry): Location {
  return { file: skill.provenance.file, line: skill.provenance.line };
}

function label(skill: SkillEntry): string {
  return skill.name || basenameOf(skill.provenance.file);
}

// ─── Routing ───────────────────────────────────────────────────────────────

/**
 * AGF103 for descriptions an agent cannot route on.
 *
 * Built from `analyzeSkillRouting`, which is the single judgement of routing
 * quality — a second copy of the same reasoning here is how `doctor` and
 * `validate` would end up disagreeing about the same skill.
 *
 * A missing description is filtered out: that is a specification violation
 * (AGF102), not a quality judgement, and reporting it twice under two codes
 * would make one of them noise.
 *
 * This measures metadata quality and nothing else. A description agentfile
 * considers good does not prove any model will pick the skill; a description
 * this thin makes it unlikely for all of them. The brief is explicit that
 * routing analysis must not claim to predict model behaviour, so neither does
 * the wording.
 */
export function routingDiagnostics(configuration: AgentConfiguration): Diagnostic[] {
  const signals = analyzeSkillRouting(configuration);
  const byFile = new Map(configuration.skills.map((skill) => [skill.provenance.file, skill]));
  const diagnostics: Diagnostic[] = [];

  for (const signal of signals) {
    const problems = signal.problems.filter((problem) => problem.kind !== "missing-description");
    if (!problems.length) continue;

    const skill = byFile.get(signal.file);
    if (!skill) continue;

    diagnostics.push(
      diagnostic({
        code: "AGF103",
        message: `Skill "${label(skill)}" is hard to route on: ${problems[0].message}`,
        explanation: [
          ...problems.map((problem) => `  ${problem.message}`),
          "",
          "Current description:",
          `  ${skill.description.trim()}`,
          "",
          "This measures the metadata, not model behaviour. A good description makes",
          "correct routing likely; it does not guarantee it, and agentfile does not",
          `claim otherwise.\n\nSpecification:\n  ${SPEC_URL}`,
        ].join("\n"),
        suggestion:
          "Rewrite the description to say both what the skill does and the situations it should be used in, naming the specific technologies or tasks involved.",
        location: locationOf(skill),
        data: {
          skill: label(skill),
          descriptionLength: signal.descriptionLength,
          problems: problems.map((problem) => problem.kind).join(","),
        },
      }),
    );
  }

  return diagnostics;
}

/**
 * AGF103 for two skills whose descriptions do not distinguish themselves.
 *
 * This is the one "overly broad description" signal that can be measured rather
 * than guessed: whether a description is broad in the abstract is a judgement
 * agentfile will not fake, but whether two skills in the same repository give an
 * agent any basis to choose between them is a comparison.
 */
export function ambiguousRoutingDiagnostics(configuration: AgentConfiguration): Diagnostic[] {
  const skills = configuration.skills.filter((skill) => skill.description.trim());
  const tokenSets = skills.map((skill) => new Set(tokenize(skill.description.toLowerCase())));
  const diagnostics: Diagnostic[] = [];

  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const similarity = jaccardSimilarity(tokenSets[i], tokenSets[j]);
      if (similarity < AMBIGUOUS_DESCRIPTION_SIMILARITY) continue;

      const percentage = Math.round(similarity * 100);
      diagnostics.push(
        diagnostic({
          code: "AGF103",
          message: `Skills "${label(skills[i])}" and "${label(skills[j])}" have ${percentage}% similar descriptions`,
          explanation: [
            "An agent chooses between skills using their descriptions alone. These two",
            "give it very little to go on:",
            "",
            `  ${label(skills[i])} — ${skills[i].description.trim()}`,
            `  ${label(skills[j])} — ${skills[j].description.trim()}`,
            "",
            "Similarity is measured on words, not meaning. If these are genuinely",
            "different skills, say what separates them in the descriptions.",
          ].join("\n"),
          suggestion:
            "Make each description name what is specific to that skill — the technology, the task, or the situation the other one does not cover.",
          location: locationOf(skills[i]),
          related: [{ location: locationOf(skills[j]), message: `${percentage}% similar description` }],
          data: { skills: `${label(skills[i])},${label(skills[j])}`, similarity },
        }),
      );
    }
  }

  return diagnostics;
}

// ─── Context ───────────────────────────────────────────────────────────────

/** Longest fenced block in a markdown body, in lines. */
function longestFencedBlock(body: string): { lines: number; startLine: number } {
  const lines = body.split("\n");
  let longest = 0;
  let longestStart = 0;
  let fence: string | undefined;
  let start = 0;

  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^\s*(`{3,}|~{3,})/);
    if (!match) continue;

    if (fence && lines[index].trimStart().startsWith(fence)) {
      const length = index - start;
      if (length > longest) {
        longest = length;
        longestStart = start;
      }
      fence = undefined;
    } else if (!fence) {
      fence = match[1];
      start = index;
    }
  }

  return { lines: longest, startLine: longestStart + 1 };
}

/**
 * AGF104 when a skill body is larger than the specification recommends.
 *
 * Skills exist for progressive disclosure: metadata at startup, the body only on
 * activation, resources only on demand. A body large enough to be a document
 * defeats the middle step — everything in it loads the moment the skill is
 * selected, whether or not it is relevant to the request.
 */
export function contextDiagnostics(configuration: AgentConfiguration): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const skill of configuration.skills) {
    const estimate = estimateContext(skill.body);
    const location = locationOf(skill);

    if (estimate.estimatedTokens > RECOMMENDED_BODY_TOKENS || estimate.lines > RECOMMENDED_BODY_LINES) {
      const reasons = [
        estimate.estimatedTokens > RECOMMENDED_BODY_TOKENS
          ? `roughly ${estimate.estimatedTokens.toLocaleString("en-US")} tokens against a recommended ${RECOMMENDED_BODY_TOKENS.toLocaleString("en-US")}`
          : "",
        estimate.lines > RECOMMENDED_BODY_LINES
          ? `${estimate.lines} lines against a recommended ${RECOMMENDED_BODY_LINES}`
          : "",
      ].filter(Boolean);

      diagnostics.push(
        diagnostic({
          code: "AGF104",
          message: `Skill "${label(skill)}" body is ${reasons.join(" and ")}`,
          explanation: [
            "Skills exist for progressive disclosure: metadata loads at startup, the body",
            "only when the skill is selected, and resources only when they are needed. A",
            "body this large defeats the middle step — all of it enters context the moment",
            "the skill is chosen, relevant or not.",
            "",
            "The token figure is estimated from character length, not measured with any",
            `target's tokenizer. Both limits are the specification's recommendations.\n\nSpecification:\n  ${SPEC_URL}`,
          ].join("\n"),
          suggestion:
            "Move reference material into `references/` and detailed procedures into `scripts/`, leaving the body as the instructions the agent needs every time it uses this skill.",
          location,
          data: {
            skill: label(skill),
            estimatedTokens: estimate.estimatedTokens,
            lines: estimate.lines,
            method: estimate.method,
          },
        }),
      );
    }

    const block = longestFencedBlock(skill.body);
    if (block.lines > MAX_INLINE_BLOCK_LINES) {
      diagnostics.push(
        diagnostic({
          code: "AGF104",
          message: `Skill "${label(skill)}" embeds a ${block.lines}-line code block in its body`,
          explanation:
            "A block this size is reference material, and it loads in full every time the skill is selected. " +
            "As a file under `references/` or `scripts/` it would load only when it is actually needed.",
          suggestion: "Move the block into a resource file and link to it from the body.",
          location: { file: skill.provenance.file, line: block.startLine },
          data: { skill: label(skill), blockLines: block.lines },
        }),
      );
    }
  }

  return diagnostics;
}

// ─── Resources ─────────────────────────────────────────────────────────────

/** Relative links and inline paths mentioned in a skill body. */
function referencedPaths(body: string): Set<string> {
  const found = new Set<string>();

  // Markdown links, plus bare paths in prose or inline code.
  for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) found.add(match[1].trim());
  for (const match of body.matchAll(/`([^`\n]+)`/g)) found.add(match[1].trim());
  for (const match of body.matchAll(/(?:^|\s)((?:scripts|references|assets)\/[\w./-]+)/g)) found.add(match[1]);

  return found;
}

/** True when the body mentions a resource by path or by filename. */
function isReferenced(resourcePath: string, references: ReadonlySet<string>, body: string): boolean {
  if (references.has(resourcePath) || references.has(`./${resourcePath}`)) return true;

  const name = basenameOf(resourcePath);
  for (const reference of references) {
    if (reference === name || reference.endsWith(`/${name}`)) return true;
  }

  // A script is often named in prose rather than linked.
  return body.includes(resourcePath) || body.includes(name);
}

/**
 * AGF105 for resource layout.
 *
 * Info severity throughout, deliberately. A platform may list a skill directory
 * rather than following links, so an unreferenced file is not necessarily
 * broken — it is worth knowing about and not worth failing a build over.
 */
export function resourceDiagnostics(configuration: AgentConfiguration): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const skill of configuration.skills) {
    if (!skill.resources.length) continue;

    const deep = skill.resources.filter((resource) => resourceDepth(resource.path) > MAX_RESOURCE_DEPTH);
    if (deep.length) {
      diagnostics.push(
        diagnostic({
          code: "AGF105",
          message: `Skill "${label(skill)}" has ${deep.length} resource${deep.length === 1 ? "" : "s"} nested more than one level deep`,
          explanation: [
            "The specification expects resource references to be relative paths one level",
            "deep. Deeper nesting is not guaranteed to be discovered by every platform.",
            "",
            ...deep.slice(0, 5).map((resource) => `  ${resource.path}`),
            ...(deep.length > 5 ? [`  …and ${deep.length - 5} more`] : []),
            `\nSpecification:\n  ${SPEC_URL}`,
          ].join("\n"),
          suggestion: "Flatten these into `scripts/`, `references/`, or `assets/` directly.",
          location: locationOf(skill),
          data: { skill: label(skill), deepResources: deep.length },
        }),
      );
    }

    // The description counts as pointing at a file, not just the body. It is
    // the part of a skill that is always loaded, and a skill whose description
    // says "see references/setup.md" has pointed at that file as plainly as the
    // body could. Searching only the body reported real, linked resources as
    // orphans — found by verifying agentfile's own findings against PostHog.
    const mentions = `${skill.description}\n${skill.body}`;
    const references = referencedPaths(mentions);
    const unreferenced = skill.resources.filter((resource) => !isReferenced(resource.path, references, mentions));

    if (unreferenced.length) {
      diagnostics.push(
        diagnostic({
          code: "AGF105",
          message: `Skill "${label(skill)}" bundles ${unreferenced.length} file${unreferenced.length === 1 ? "" : "s"} nothing mentions`,
          explanation: [
            "These files ship with the skill and neither its description nor its body",
            "points at them:",
            "",
            ...unreferenced.slice(0, 5).map((resource) => `  ${resource.path} (${resource.kind})`),
            ...(unreferenced.length > 5 ? [`  …and ${unreferenced.length - 5} more`] : []),
            "",
            "A platform may list the skill directory rather than following links, so this",
            "is not necessarily broken — but a file the instructions never mention is more",
            "often left over than deliberate.",
          ].join("\n"),
          suggestion: "Reference each file from the body where it should be used, or remove it.",
          location: locationOf(skill),
          data: { skill: label(skill), unreferenced: unreferenced.length },
        }),
      );
    }
  }

  return diagnostics;
}

// ─── Portability ───────────────────────────────────────────────────────────

/**
 * AGF106 for frontmatter that does not travel.
 *
 * Non-spec keys are not a mistake — Claude Code documents several, and they are
 * useful. They are a constraint: claude.ai uploads and the Skills API reject
 * keys outside the specification, so a skill using them is not portable to those
 * surfaces. Saying which keys and whose extension they are is the difference
 * between a useful warning and a scold.
 */
export function portabilityDiagnostics(configuration: AgentConfiguration): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const skill of configuration.skills) {
    const extensionKeys = Object.keys(skill.extensions ?? {}).sort();
    const location = locationOf(skill);

    if (extensionKeys.length) {
      const attributed = extensionKeys.map((key) => {
        const owners = [
          CLAUDE_EXTENSION_FIELDS.includes(key) ? "Claude Code" : "",
          CURSOR_EXTENSION_FIELDS.includes(key) ? "Cursor" : "",
        ].filter(Boolean);
        return `  ${key}${owners.length ? ` — documented by ${owners.join(" and ")}` : " — not documented by any platform agentfile has verified"}`;
      });

      diagnostics.push(
        diagnostic({
          code: "AGF106",
          message: `Skill "${label(skill)}" uses ${extensionKeys.length} frontmatter field${extensionKeys.length === 1 ? "" : "s"} outside the specification`,
          explanation: [
            ...attributed,
            "",
            "These work where the platform that defines them reads the skill. They are",
            "rejected by claude.ai uploads and the Skills API, which accept only the",
            "specification's fields, so a skill using them cannot be shared through those",
            `surfaces unchanged.\n\nSpecification:\n  ${SPEC_URL}`,
          ].join("\n"),
          suggestion:
            "Keep them if the skill is only ever loaded from this repository. If it needs to be shareable, move the behaviour into the body and drop the extension fields.",
          location,
          data: { skill: label(skill), fields: extensionKeys.join(",") },
        }),
      );
    }

    // Claude Code truncates the skill listing at a documented length; a
    // description plus when_to_use beyond it is silently cut.
    const whenToUse = String(skill.extensions?.when_to_use ?? "");
    const listingLength = skill.description.trim().length + whenToUse.trim().length;
    if (listingLength > CLAUDE_LISTING_LIMIT) {
      diagnostics.push(
        diagnostic({
          code: "AGF106",
          message: `Skill "${label(skill)}" has ${listingLength} characters of routing metadata, over Claude Code's ${CLAUDE_LISTING_LIMIT}-character listing limit`,
          explanation:
            "Claude Code truncates `description` plus `when_to_use` at that length in its skill listing. " +
            "Truncation happens where the limit falls, not where the meaning ends, so the part that decides routing may be the part that is cut.",
          suggestion: "Bring the combined length under the limit, putting the decisive wording first.",
          location,
          data: { skill: label(skill), listingLength, limit: CLAUDE_LISTING_LIMIT },
        }),
      );
    }
  }

  return diagnostics;
}

/** Every quality finding for every skill. */
export function analyzeSkillQuality(configuration: AgentConfiguration): Diagnostic[] {
  return [
    ...routingDiagnostics(configuration),
    ...ambiguousRoutingDiagnostics(configuration),
    ...contextDiagnostics(configuration),
    ...resourceDiagnostics(configuration),
    ...portabilityDiagnostics(configuration),
  ];
}
