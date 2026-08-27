/**
 * Repository scanning.
 *
 * One traversal, shared by every discovery adapter. Walking the tree repeatedly
 * — once per format — is the obvious way to write this and the wrong way to run
 * it: `agentfile check` is meant for pre-commit hooks, so the file listing is
 * produced once and filtered many times.
 *
 * The scan is bounded. A repository with a huge `vendor/` directory or a symlink
 * loop must degrade into a reported truncation, never a hang.
 */

import { join } from "node:path";
import type { FileSystem } from "../fs/index.js";
import { normalizePath, ROOT_PATH } from "../paths/index.js";

/**
 * Directories never worth scanning for agent configuration.
 *
 * Matched by exact name, not by pattern, and deliberately not "anything starting
 * with a dot": the configuration we are looking for lives in `.claude`,
 * `.cursor`, `.github`, and `.agents`.
 */
export const DEFAULT_IGNORED_DIRECTORIES: readonly string[] = [
  ".agentfile-backup",
  ".cache",
  ".git",
  ".gradle",
  ".idea",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".pytest_cache",
  ".svelte-kit",
  ".terraform",
  ".turbo",
  ".venv",
  ".vs",
  "__pycache__",
  "bower_components",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
  "venv",
];

export interface ScanOptions {
  /** Directory names to skip. Defaults to `DEFAULT_IGNORED_DIRECTORIES`. */
  ignore?: readonly string[];
  /** Maximum directory depth below the root. Default 12. */
  maxDepth?: number;
  /** Maximum files to collect before truncating. Default 20000. */
  maxFiles?: number;
}

export interface RepositoryScan {
  /** Project-relative POSIX paths of every file found, sorted. */
  files: string[];
  /** Project-relative directories that were skipped, sorted. */
  ignored: string[];
  /** True when a limit was hit, so `files` is incomplete. */
  truncated: boolean;
  /** Why the scan truncated, when it did. */
  truncationReason?: string;
}

/** Walks the repository once and returns every candidate file. */
export function scanRepository(root: string, fs: FileSystem, options: ScanOptions = {}): RepositoryScan {
  const ignore = new Set(options.ignore ?? DEFAULT_IGNORED_DIRECTORIES);
  const maxDepth = options.maxDepth ?? 12;
  const maxFiles = options.maxFiles ?? 20_000;

  const files: string[] = [];
  const ignored: string[] = [];
  let truncated = false;
  let truncationReason: string | undefined;

  const walk = (relativeDirectory: string, depth: number): void => {
    if (truncated) return;

    if (depth > maxDepth) {
      truncated = true;
      truncationReason = `Directory nesting exceeded ${maxDepth} levels at ${relativeDirectory}`;
      return;
    }

    const absoluteDirectory = relativeDirectory === ROOT_PATH ? root : join(root, relativeDirectory);

    for (const entry of fs.readDirectory(absoluteDirectory)) {
      if (truncated) return;

      const childPath = relativeDirectory === ROOT_PATH ? entry.name : `${relativeDirectory}/${entry.name}`;

      if (entry.isDirectory) {
        if (ignore.has(entry.name)) {
          ignored.push(childPath);
          continue;
        }
        // Symlinked directories are not followed: a loop would hang the scan,
        // and the target is either inside the repository already or outside it
        // and not ours to read.
        if (entry.isSymbolicLink) {
          ignored.push(childPath);
          continue;
        }
        walk(childPath, depth + 1);
        continue;
      }

      if (files.length >= maxFiles) {
        truncated = true;
        truncationReason = `Stopped after ${maxFiles} files`;
        return;
      }

      files.push(childPath);
    }
  };

  walk(ROOT_PATH, 0);

  files.sort();
  ignored.sort();

  return { files, ignored, truncated, truncationReason };
}

/** Files in the scan whose basename equals `name` (case-sensitive). */
export function filesNamed(scan: RepositoryScan, name: string): string[] {
  return scan.files.filter((path) => path.slice(path.lastIndexOf("/") + 1) === name);
}

/**
 * Files directly inside, or nested under, one of `directories`.
 *
 * `directories` are matched as path segments, so `.claude/skills` matches
 * `.claude/skills/deploy/SKILL.md` and also `apps/web/.claude/skills/...`.
 */
export function filesUnder(scan: RepositoryScan, directories: readonly string[], extension?: string): string[] {
  const normalizedDirectories = directories.map((directory) => normalizePath(directory));

  return scan.files.filter((path) => {
    if (extension && !path.endsWith(extension)) return false;
    return normalizedDirectories.some(
      (directory) => path.startsWith(`${directory}/`) || path.includes(`/${directory}/`),
    );
  });
}
