/**
 * Discovery of Agent Skills.
 *
 * `SKILL.md` is an external standard (docs/v2-architecture.md §5.3), not an
 * agentfile format. This adapter reads it as specified — the six spec fields
 * kept as first-class data, every other frontmatter key preserved under
 * `extensions` so a portability check can report on it rather than losing it.
 */

import { join } from "node:path";
import type { Diagnostic } from "../diagnostics/index.js";
import type { FileSystem } from "../fs/index.js";
import {
  appliesToPaths,
  MANUAL,
  MODEL_SELECTED,
  type PlatformId,
  type SkillEntry,
  type SkillResource,
  type SkillResourceKind,
  type SourceFile,
} from "../ir/index.js";
import {
  booleanField,
  extraFields,
  globListField,
  listField,
  mapField,
  parseFrontmatter,
  stringField,
} from "../parsers/frontmatter.js";
import { dirnameOf, ROOT_PATH } from "../paths/index.js";
import { filesUnder, type RepositoryScan } from "./scan.js";
import { governedDirectory, provenanceOf } from "./shared.js";

/**
 * Directories skills are discovered from, with the platform each belongs to.
 *
 * `.agents/skills` is a shared convention: both Copilot and Cursor document
 * reading it, so it is attributed to the neutral `generic` platform rather than
 * to either one.
 */
export const SKILL_DIRECTORIES: ReadonlyArray<{ directory: string; platform: PlatformId }> = [
  { directory: ".claude/skills", platform: "claude" },
  { directory: ".cursor/skills", platform: "cursor" },
  { directory: ".github/skills", platform: "copilot" },
  { directory: ".agents/skills", platform: "generic" },
];

/** Fields defined by the Agent Skills specification. */
export const SKILL_SPEC_FIELDS: readonly string[] = [
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
];

export interface DiscoveredSkills {
  skills: SkillEntry[];
  sources: SourceFile[];
  diagnostics: Diagnostic[];
}

function resourceKind(relativePath: string): SkillResourceKind {
  const top = relativePath.split("/")[0];
  if (top === "scripts") return "script";
  if (top === "references") return "reference";
  if (top === "assets") return "asset";
  return "other";
}

function platformFor(file: string): PlatformId {
  for (const entry of SKILL_DIRECTORIES) {
    if (file.startsWith(`${entry.directory}/`) || file.includes(`/${entry.directory}/`)) {
      return entry.platform;
    }
  }
  return "generic";
}

/**
 * Files bundled with a skill, relative to the skill directory.
 *
 * Read from the existing scan rather than re-walking: the skill directory is
 * already in it.
 */
function resourcesFor(scan: RepositoryScan, skillDirectory: string): SkillResource[] {
  const prefix = `${skillDirectory}/`;

  return scan.files
    .filter((path) => path.startsWith(prefix) && path !== `${prefix}SKILL.md`)
    .map((path) => {
      const relativePath = path.slice(prefix.length);
      return { path: relativePath, kind: resourceKind(relativePath) };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Discovers every `SKILL.md` under a known skills directory. */
export function discoverSkills(root: string, scan: RepositoryScan, fs: FileSystem): DiscoveredSkills {
  const result: DiscoveredSkills = { skills: [], sources: [], diagnostics: [] };
  const directories = SKILL_DIRECTORIES.map((entry) => entry.directory);

  for (const file of filesUnder(scan, directories, "SKILL.md")) {
    let text: string;
    try {
      text = fs.readFile(join(root, file));
    } catch {
      continue;
    }

    const parsed = parseFrontmatter(file, text);
    result.diagnostics.push(...parsed.diagnostics);

    const platform = platformFor(file);
    const skillDirectory = dirnameOf(file);
    const directoryName = skillDirectory === ROOT_PATH ? "" : skillDirectory.slice(skillDirectory.lastIndexOf("/") + 1);

    // The spec says `name` must match the parent directory name, so the
    // directory is the reliable identity when frontmatter is absent or wrong.
    const declaredName = stringField(parsed.data, "name");
    const description = stringField(parsed.data, "description");
    const provenance = provenanceOf(file, platform);

    // A nested skills directory serves the subtree it sits in; a top-level one
    // is offered everywhere and the agent chooses from the description.
    const governing = governedDirectory(file);
    const pathsField = globListField(parsed.data, "paths");
    const manualOnly = booleanField(parsed.data, "disable-model-invocation") === true;

    const applies = manualOnly
      ? MANUAL
      : pathsField?.length
        ? appliesToPaths(pathsField)
        : governing === ROOT_PATH
          ? MODEL_SELECTED
          : appliesToPaths([`${governing}/**`]);

    result.skills.push({
      name: declaredName ?? directoryName,
      description: description ?? "",
      license: stringField(parsed.data, "license"),
      compatibility: stringField(parsed.data, "compatibility"),
      metadata: mapField(parsed.data, "metadata"),
      allowedTools: listField(parsed.data, "allowed-tools"),
      body: parsed.body,
      extensions: extraFields(parsed.data, SKILL_SPEC_FIELDS),
      resources: resourcesFor(scan, skillDirectory),
      applies,
      provenance,
      directory: skillDirectory,
    });

    result.sources.push({
      path: file,
      platform,
      scope: provenance.scope,
      kind: "skill",
      bytes: text.length,
    });
  }

  return result;
}
