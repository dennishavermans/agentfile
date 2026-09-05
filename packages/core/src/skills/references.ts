/**
 * Links in a skill body that point at nothing.
 *
 * A skill promising `see references/api.md` and shipping without that file does
 * not fail — the agent looks, finds nothing, and carries on with less
 * information than the skill said it would have. Nothing reports it, which is
 * exactly the class of silent failure this project exists to surface.
 *
 * Reported as AGF004, the same code as any other broken reference: it is the
 * same problem, and consumers matching on the code should not have to learn a
 * second one for skills.
 */

import { join } from "node:path";
import { type Diagnostic, diagnostic } from "../diagnostics/index.js";
import type { FileSystem } from "../fs/index.js";
import type { AgentConfiguration, SkillEntry } from "../ir/index.js";
import { basenameOf, normalizePath } from "../paths/index.js";

/**
 * A GitHub web URL written without its origin.
 *
 * `../blob/master/CONTRIBUTING.md` is not a path in the repository, it is a
 * link that resolves correctly once GitHub renders it: from a pull request at
 * `/owner/repo/pull/123`, `../` reaches `/owner/repo/` and the rest lands on
 * the file's web page. n8n writes five of these inside canned review replies
 * that the agent posts as comments, and reading them as repository paths
 * reported five broken links in a skill whose links all work.
 *
 * Scoped tightly to the three segment names GitHub uses for this, each of
 * which must be followed by a ref, so an ordinary directory called `blob` is
 * unaffected.
 */
const WEB_URL_SHAPE = /(^|\/)(blob|tree|raw)\/[^/]+\//;

/** A link that is a path inside the repository, rather than a URL or an anchor. */
function isLocalPath(target: string): boolean {
  if (!target) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false; // http:, mailto:, file:
  if (target.startsWith("#")) return false;
  if (target.startsWith("/")) return false; // absolute: not ours to resolve
  // A placeholder is a shape to fill in, not a file: `tmp/review-<repo>-<number>.md`
  // names a file the skill will create at run time. Angle brackets cannot appear
  // in a real link target unencoded, so this costs nothing.
  if (target.includes("<") || target.includes(">")) return false;
  if (WEB_URL_SHAPE.test(target)) return false;
  return true;
}

/**
 * The body with code removed, and every line still in its original position.
 *
 * A link inside a code span is being shown, not followed: n8n documents image
 * syntax as `` `![description](url)` `` and ruff documents a permalink as
 * `` `[project file.py:123](permalink)` ``. Reading those as links reported
 * `url` and `permalink` as missing files. Import detection already ignores
 * code for the same reason; this is the same rule applied to links.
 *
 * Lines are blanked rather than deleted so the reported line number still
 * points at the link.
 */
function withoutCode(body: string): string[] {
  const lines = body.split("\n");
  const output: string[] = [];
  let fence: string | undefined;

  for (const line of lines) {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})/);

    if (fence) {
      // Inside a fenced block: the closing fence must be at least as long.
      if (delimiter && delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = undefined;
      output.push("");
      continue;
    }

    if (delimiter) {
      fence = delimiter[1];
      output.push("");
      continue;
    }

    output.push(line.replace(/`[^`\n]*`/g, ""));
  }

  return output;
}

/** Resolves a relative link against a directory, collapsing `.` and `..`. */
function resolveRelative(directory: string, target: string): string | undefined {
  const segments = directory ? directory.split("/") : [];

  for (const segment of target.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return undefined; // escapes the repository root
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.join("/");
}

/**
 * The paths a link could mean, in the order an agent would find them.
 *
 * `./api.md` and `../../tools/x.md` are explicitly relative and have exactly
 * one reading. A bare path like `services/mcp/src/lib/x.ts` has two: relative
 * to the skill, which is what Markdown says, and relative to the repository
 * root, which is how people actually write paths in a document *about* a
 * repository. PostHog has one of each in the same skill directory.
 *
 * Both are tried before a link is called broken. Reporting the Markdown
 * reading as missing while the file sits at the root is a false error on
 * configuration that works, which is worse than saying nothing.
 */
function candidatePaths(directory: string, target: string): string[] {
  const explicitlyRelative = target.startsWith("./") || target.startsWith("../");
  const paths = [resolveRelative(directory, target)];
  if (!explicitlyRelative) paths.push(resolveRelative("", target));

  return [...new Set(paths.filter((path): path is string => path !== undefined))];
}

interface BodyLink {
  target: string;
  line: number;
}

/** Markdown links in a body, with the line each sits on. */
function bodyLinks(skill: SkillEntry): BodyLink[] {
  const lines = withoutCode(skill.body);
  const startLine = 1;
  const links: BodyLink[] = [];

  for (let offset = 0; offset < lines.length; offset++) {
    for (const match of lines[offset].matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      links.push({ target: match[1].trim(), line: startLine + offset });
    }
  }

  return links;
}

/**
 * AGF004 for every skill link that resolves to no file.
 *
 * A link is only reported when the repository contains it under none of its
 * plausible readings — see candidatePaths — and a link pointing outside the
 * repository is skipped rather than guessed at.
 */
export interface SkillReferenceOptions {
  /** Absolute project root. */
  root: string;
  fs: FileSystem;
}

export function checkSkillReferences(
  configuration: AgentConfiguration,
  files: readonly string[],
  options?: SkillReferenceOptions,
): Diagnostic[] {
  const present = new Set(files.map(normalizePath));
  const diagnostics: Diagnostic[] = [];

  /**
   * Whether a resolved path exists.
   *
   * The scan is bounded — it stops after 20,000 files so a huge repository
   * degrades into a reported truncation rather than a hang — which means the
   * file list proves presence and never proves absence. Concluding "missing"
   * from it reported 65 phantom broken links in PostHog, whose 47,010 files do
   * not fit, and every one of them was really there.
   *
   * So absence is settled against the disk. Presence in the list is still
   * checked first, because it is free and answers most cases.
   */
  const exists = (path: string): boolean => {
    if (present.has(path)) return true;
    if ([...present].some((file) => file.startsWith(`${path}/`))) return true;
    if (!options) return false;
    return options.fs.exists(join(options.root, path));
  };

  for (const skill of configuration.skills) {
    const directory = skill.directory;
    if (!directory) continue;

    for (const link of bodyLinks(skill)) {
      if (!isLocalPath(link.target)) continue;

      // Strip a fragment: `references/api.md#errors` points at the file.
      const target = link.target.split("#")[0];
      if (!target) continue;

      const candidates = candidatePaths(directory, target);
      if (!candidates.length) continue; // escapes the root; not ours to check
      if (candidates.some(exists)) continue;

      const resolved = candidates[0];
      const where =
        candidates.length > 1
          ? `Checked ${candidates[0]} (relative to the skill) and ${candidates[1]} (relative to the repository root), and neither is in the repository. `
          : `Resolved to ${resolved}, and no such file is in the repository. `;

      diagnostics.push(
        diagnostic({
          code: "AGF004",
          message: `Skill "${skill.name || basenameOf(skill.provenance.file)}" links to ${target}, which does not exist`,
          explanation:
            where +
            "The agent will follow the link, find nothing, and continue with less information than the skill said it would have — without reporting anything.",
          suggestion: `Add ${resolved}, or correct the link.`,
          location: { file: skill.provenance.file, line: link.line },
          data: { skill: skill.name, target, resolved, checked: candidates.join(", ") },
        }),
      );
    }
  }

  return diagnostics;
}
