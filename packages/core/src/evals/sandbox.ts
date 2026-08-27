/// <reference types="node" />

/**
 * The sandbox.
 *
 * REWORK §21 draws the line this module exists to enforce: SAFE TO ANALYZE is
 * not SAFE TO EXECUTE. Everything an eval executes — setup commands, the agent,
 * assertion commands — runs inside a workspace seeded into a temporary
 * directory, never in the user's working tree. The user's files are inputs; they
 * are not the venue.
 *
 * The abstraction is deliberately replaceable (`Sandbox` is an interface, and
 * the runner takes one): a Docker or seatbelt/bubblewrap implementation slots in
 * without touching the runner or the assertions. What this first implementation
 * honestly provides is filesystem isolation, timeouts, and output caps. What it
 * does not provide — network isolation, resource limits beyond time — is stated
 * here rather than implied away.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { FileSystem } from "../fs/index.js";

export interface ExecResult {
  /** Exit code, or null when the process was killed (timeout). */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface ExecOptions {
  timeoutMs?: number;
  /** Extra environment variables, on top of the inherited environment. */
  env?: Record<string, string>;
}

export interface Workspace {
  /** Absolute path of the isolated copy. */
  root: string;
  /** Relative path → content hash of every file seeded in, for change detection. */
  seeded: ReadonlyMap<string, string>;
  /** Runs a shell command inside the workspace. Never in the user's tree. */
  exec(command: string, options?: ExecOptions): ExecResult;
  /** Removes the workspace. Safe to call twice. */
  cleanup(): void;
}

export interface Sandbox {
  /** What this sandbox does and does not isolate, shown to the user. */
  description: string;
  create(): Workspace;
}

const MAX_OUTPUT_BYTES = 1024 * 1024;

export function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Seeds a temporary directory with the given project-relative files.
 *
 * Files come from the caller (`git ls-files` for a repository, the discovery
 * scan otherwise) so the seed matches what the project actually versions —
 * `node_modules` and other ignored trees stay out, and `setup` commands
 * reconstruct what a build needs.
 */
export const NO_POSIX_SHELL = [
  "No POSIX shell was found, so this command was not run.",
  "",
  "Eval commands and agent templates are quoted for a POSIX shell, which is what",
  "`sh` provides everywhere except Windows. Git for Windows ships `bash`; with it",
  "on PATH, evals run the same way they do everywhere else.",
].join("\n");

/**
 * The shell eval commands run in.
 *
 * `true` means Node's default, which is `/bin/sh` on POSIX and `cmd.exe` on
 * Windows. cmd.exe is not an option here: every command and every agent
 * template is quoted by `shellQuote`, which emits POSIX single-quoting, and
 * cmd.exe does not understand it. Passing a POSIX-quoted command to cmd.exe
 * does not fail cleanly either — it mangles the arguments and runs something
 * else, which is the worst possible outcome for a tool that executes a command
 * a user supplied.
 *
 * So on Windows the shell is `bash`, which Git for Windows installs, and when
 * there is none the command is refused with a reason rather than mis-quoted.
 */
let cachedShell: string | boolean | undefined | null = null;

export function posixShell(): string | boolean | undefined {
  if (process.platform !== "win32") return true;
  if (cachedShell !== null) return cachedShell as string | undefined;

  try {
    const probe = spawnSync("bash", ["-c", "exit 0"], { encoding: "utf-8", timeout: 10_000 });
    cachedShell = probe.error === undefined && probe.status === 0 ? "bash" : undefined;
  } catch {
    cachedShell = undefined;
  }

  return cachedShell as string | undefined;
}

export function temporaryDirectorySandbox(options: {
  root: string;
  files: readonly string[];
  fs: FileSystem;
}): Sandbox {
  return {
    description:
      "temporary directory: filesystem isolation and timeouts. Commands inherit this " +
      "process's environment and network access.",
    create(): Workspace {
      const workspaceRoot = mkdtempSync(join(tmpdir(), "agentfile-eval-"));
      const seeded = new Map<string, string>();

      for (const relative of options.files) {
        const sourcePath = join(options.root, relative);
        if (!options.fs.exists(sourcePath)) continue;

        const destination = join(workspaceRoot, relative);
        try {
          mkdirSync(dirname(destination), { recursive: true });
          cpSync(sourcePath, destination);
          seeded.set(relative, hashContent(readFileSync(destination)));
        } catch {
          // An unreadable file cannot be seeded; the eval sees the tree without it.
        }
      }

      let cleaned = false;

      return {
        root: workspaceRoot,
        seeded,
        exec(command: string, execOptions: ExecOptions = {}): ExecResult {
          const started = Date.now();

          const shell = posixShell();
          if (shell === undefined) {
            return {
              exitCode: 127,
              stdout: "",
              stderr: NO_POSIX_SHELL,
              timedOut: false,
              durationMs: Date.now() - started,
            };
          }

          const result = spawnSync(command, {
            shell,
            cwd: workspaceRoot,
            encoding: "utf-8",
            timeout: execOptions.timeoutMs,
            maxBuffer: MAX_OUTPUT_BYTES,
            env: { ...process.env, ...execOptions.env },
          });

          // How a timeout surfaces is platform-dependent: POSIX sets
          // `error.code` to ETIMEDOUT, Windows has no real signals and reports
          // the kill through `signal` instead. Checking only the first means a
          // hung agent on Windows is reported as an ordinary failure, which
          // hides the one fact that matters about it. Both are only consulted
          // when a timeout was actually requested.
          const timedOut =
            execOptions.timeoutMs !== undefined &&
            ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" || result.signal !== null);

          return {
            exitCode: result.status,
            stdout: result.stdout ?? "",
            stderr: timedOut ? `${result.stderr ?? ""}\n[timed out]`.trim() : (result.stderr ?? ""),
            timedOut,
            durationMs: Date.now() - started,
          };
        },
        cleanup(): void {
          if (cleaned) return;
          cleaned = true;
          rmSync(workspaceRoot, { recursive: true, force: true });
        },
      };
    },
  };
}

/**
 * The files a git repository versions, which is the right seed for a sandbox:
 * tracked plus untracked-but-not-ignored, exactly what a fresh checkout plus
 * work-in-progress looks like. Returns undefined when `root` is not a git
 * repository or git is unavailable.
 */
export function gitSeedFiles(root: string): string[] | undefined {
  try {
    const output = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
      cwd: root,
      encoding: "utf-8",
      maxBuffer: MAX_OUTPUT_BYTES * 16,
    });
    return output.split("\n").filter(Boolean);
  } catch {
    return undefined;
  }
}

/**
 * A stable fingerprint of the repository state, for the eval cache.
 *
 * HEAD, plus the content of every tracked change (`git diff HEAD`), plus the
 * content of every untracked-but-not-ignored file. The porcelain status alone
 * would not do: it names a modified file but does not change when the file is
 * edited again, and a cache that can serve a stale hit is worse than no cache.
 * Undefined outside a git repository — no fingerprint means no caching.
 */
export function gitStateFingerprint(root: string): string | undefined {
  try {
    const run = (args: string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf-8", maxBuffer: MAX_OUTPUT_BYTES * 16 });

    const head = run(["rev-parse", "HEAD"]).trim();
    const tracked = hashContent(run(["diff", "HEAD"]));

    const untracked = run(["ls-files", "--others", "--exclude-standard"])
      .split("\n")
      .filter(Boolean)
      // agentfile's own state (the eval cache, backups) is not repository
      // input — counting it would invalidate the cache it belongs to.
      .filter((relative) => !relative.startsWith(".agentfile"))
      .sort();
    const untrackedHash = createHash("sha256");
    for (const relative of untracked) {
      untrackedHash.update(relative);
      try {
        untrackedHash.update(readFileSync(join(root, relative)));
      } catch {
        untrackedHash.update("unreadable");
      }
    }

    return `${head}:${tracked}:${untrackedHash.digest("hex")}`;
  } catch {
    return undefined;
  }
}
