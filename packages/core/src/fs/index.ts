/**
 * Filesystem port.
 *
 * The v2 layers take a `FileSystem` rather than calling `node:fs` directly, so
 * that resolution, adapters, and discovery can be tested against fixture
 * repositories held in memory — no temp directories, no cleanup, no
 * cross-platform path surprises.
 *
 * Deliberately minimal: exactly the operations the current callers need.
 * Grow it when a caller needs more, not in anticipation.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";

export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  /** True for a symlink. Discovery declines to follow these. */
  isSymbolicLink: boolean;
}

export interface FileSystem {
  /** Reads a UTF-8 file. Throws if it cannot be read. Paths are absolute. */
  readFile(path: string): string;
  /** True when the path exists. Must not throw. */
  exists(path: string): boolean;
  /** Lists a directory. Returns an empty array when it cannot be read. */
  readDirectory(path: string): DirectoryEntry[];
  /** True when the path exists and is a directory. Must not throw. */
  isDirectory(path: string): boolean;
  /**
   * Resolves symlinks to the real path. Returns the input unchanged when the
   * path does not exist or cannot be resolved. Must not throw.
   */
  realPath(path: string): string;
}

/** The real filesystem. */
export const nodeFileSystem: FileSystem = {
  readFile(path) {
    return readFileSync(path, "utf-8");
  },
  exists(path) {
    return existsSync(path);
  },
  readDirectory(path) {
    try {
      return readdirSync(path, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isSymbolicLink: entry.isSymbolicLink(),
      }));
    } catch {
      // An unreadable directory is not exceptional during a repository scan —
      // a permission-denied node should skip, not abort the whole run.
      return [];
    }
  },
  isDirectory(path) {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  realPath(path) {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  },
};

/**
 * An in-memory filesystem for tests and dry analysis.
 *
 * Keys are absolute file paths, normalised to forward slashes. Directories are
 * inferred from the file paths, so a fixture is just a map of files.
 */
export function memoryFileSystem(files: Readonly<Record<string, string>>): FileSystem {
  const normalized = new Map<string, string>();
  for (const [path, content] of Object.entries(files)) {
    normalized.set(path.replaceAll("\\", "/").replace(/\/+$/, ""), content);
  }

  const directories = new Set<string>();
  for (const path of normalized.keys()) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index++) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }

  const clean = (path: string): string => path.replaceAll("\\", "/").replace(/\/+$/, "");

  return {
    readFile(path) {
      const key = clean(path);
      const content = normalized.get(key);
      if (content === undefined) throw new Error(`File not found in memory filesystem: ${key}`);
      return content;
    },
    exists(path) {
      const key = clean(path);
      return normalized.has(key) || directories.has(key);
    },
    isDirectory(path) {
      return directories.has(clean(path));
    },
    readDirectory(path) {
      const prefix = `${clean(path)}/`;
      const seen = new Map<string, DirectoryEntry>();

      const consider = (candidate: string, isDirectory: boolean): void => {
        if (!candidate.startsWith(prefix)) return;
        const remainder = candidate.slice(prefix.length);
        if (!remainder) return;

        const name = remainder.split("/")[0];
        const nested = remainder.includes("/");
        if (seen.has(name)) return;

        seen.set(name, { name, isDirectory: nested || isDirectory, isSymbolicLink: false });
      };

      for (const candidate of normalized.keys()) consider(candidate, false);
      for (const candidate of directories) consider(candidate, true);

      return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    // The memory filesystem has no symlinks, so every path is already real.
    realPath(path) {
      return clean(path);
    },
  };
}
