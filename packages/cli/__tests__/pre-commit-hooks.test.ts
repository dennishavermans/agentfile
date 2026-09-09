import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The pre-commit hooks pin the CLI to a published version, and the README tells
 * a consumer to pin `rev` to the matching tag. Both drift silently: a release
 * that forgets them leaves the documented configuration pointing at a version
 * that does not exist, or at a tag that does not carry the hooks file. That
 * happened once, so it is checked here rather than remembered.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const version = JSON.parse(readFileSync(join(root, "packages", "cli", "package.json"), "utf-8")).version;
const hooks = readFileSync(join(root, ".pre-commit-hooks.yaml"), "utf-8");
const readme = readFileSync(join(root, "README.md"), "utf-8");
const pluginHook = readFileSync(join(root, "plugin", "hooks", "after_config_edit.py"), "utf-8");
const pluginManifest = JSON.parse(readFileSync(join(root, "plugin", ".claude-plugin", "plugin.json"), "utf-8"));

describe(".pre-commit-hooks.yaml", () => {
  it("pins every hook to the current CLI version", () => {
    const pinned = [...hooks.matchAll(/@agentfile\/cli@(\S+)/g)].map((match) => match[1]);
    expect(pinned.length, "no pinned entry found").toBeGreaterThan(0);
    for (const pin of pinned) expect(pin, "hook pin is behind packages/cli").toBe(version);
  });

  it("tells the README to pin the tag that carries this file", () => {
    expect(readme, "README rev does not match the current version").toContain(`rev: v${version}`);
  });

  it("keeps --strict on the audit hook, which exits 0 on warnings without it", () => {
    expect(hooks).toContain("--strict");
  });
});

/**
 * The Claude Code plugin carries the same two drift points as the pre-commit
 * hooks: a pinned CLI version and a version of its own. Same failure, same
 * guard.
 */
describe("plugin/", () => {
  it("pins the hook to the current CLI version", () => {
    const pinned = [...pluginHook.matchAll(/@agentfile\/cli@(\S+?)"/g)].map((match) => match[1]);
    expect(pinned.length, "no pinned entry found in the plugin hook").toBeGreaterThan(0);
    for (const pin of pinned) expect(pin, "plugin hook pin is behind packages/cli").toBe(version);
  });

  it("keeps the plugin manifest version in step", () => {
    expect(pluginManifest.version, "plugin.json is behind packages/cli").toBe(version);
  });
});
