/**
 * Discovery of subagent definitions and MCP server configuration.
 *
 * Both are treated as untrusted data. Commands are recorded and analysed; they
 * are never executed here or anywhere else in static analysis.
 */

import { join } from "node:path";
import { type Diagnostic, diagnostic } from "../diagnostics/index.js";
import type { FileSystem } from "../fs/index.js";
import type { McpServerEntry, McpTransport, SourceFile, SubagentEntry } from "../ir/index.js";
import { extraFields, listField, parseAgentFrontmatter, stringField } from "../parsers/frontmatter.js";
import { dirnameOf } from "../paths/index.js";
import { filesNamed, filesUnder, type RepositoryScan } from "./scan.js";
import { basenameOf, provenanceOf } from "./shared.js";

// ─── Subagents ─────────────────────────────────────────────────────────────

/** Frontmatter fields documented for subagent definitions. */
const SUBAGENT_FIELDS: readonly string[] = ["name", "description", "tools", "disallowedTools", "model"];

export interface DiscoveredSubagents {
  subagents: SubagentEntry[];
  sources: SourceFile[];
  diagnostics: Diagnostic[];
}

/**
 * `.claude/agents/**\/*.md`.
 *
 * `name` and `description` are required by the format. The subdirectory path
 * does not affect a subagent's identity, so the frontmatter name wins and the
 * filename is only a fallback.
 */
export function discoverSubagents(root: string, scan: RepositoryScan, fs: FileSystem): DiscoveredSubagents {
  const result: DiscoveredSubagents = { subagents: [], sources: [], diagnostics: [] };

  for (const file of filesUnder(scan, [".claude/agents"], ".md")) {
    let text: string;
    try {
      text = fs.readFile(join(root, file));
    } catch {
      continue;
    }

    const parsed = parseAgentFrontmatter(file, text);
    result.diagnostics.push(...parsed.diagnostics);

    const provenance = provenanceOf(file, "claude");
    const fallbackName = basenameOf(file).replace(/\.md$/, "");

    result.subagents.push({
      name: stringField(parsed.data, "name") ?? fallbackName,
      description: stringField(parsed.data, "description") ?? "",
      tools: listField(parsed.data, "tools", /\s*,\s*/),
      disallowedTools: listField(parsed.data, "disallowedTools", /\s*,\s*/),
      model: stringField(parsed.data, "model"),
      body: parsed.body,
      extensions: extraFields(parsed.data, SUBAGENT_FIELDS),
      provenance,
    });

    result.sources.push({
      path: file,
      platform: "claude",
      scope: provenance.scope,
      kind: "subagent",
      bytes: text.length,
    });
  }

  return result;
}

// ─── MCP ───────────────────────────────────────────────────────────────────

export interface DiscoveredMcpServers {
  mcpServers: McpServerEntry[];
  sources: SourceFile[];
  diagnostics: Diagnostic[];
}

const REMOTE_TRANSPORTS: readonly string[] = ["http", "streamable-http", "sse", "ws"];

function normalizeTransport(value: string): McpTransport {
  // The MCP specification names this transport `streamable-http`; the config
  // format accepts it as an alias for `http`, so configurations copied from a
  // server's own documentation work unchanged.
  return value === "streamable-http" ? "http" : (value as McpTransport);
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return Object.keys(result).length ? result : undefined;
}

/**
 * `.mcp.json` at a repository root: `{ "mcpServers": { "<name>": { ... } } }`.
 *
 * Only project-scoped configuration is discoverable. Local and user scopes live
 * in the developer's home directory by design, and are neither committed nor
 * ours to read.
 */
export function discoverMcpServers(root: string, scan: RepositoryScan, fs: FileSystem): DiscoveredMcpServers {
  const result: DiscoveredMcpServers = { mcpServers: [], sources: [], diagnostics: [] };

  for (const file of filesNamed(scan, ".mcp.json")) {
    let text: string;
    try {
      text = fs.readFile(join(root, file));
    } catch {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      result.diagnostics.push(
        diagnostic({
          code: "AGF003",
          message: `${file} is not valid JSON`,
          explanation: (error as Error).message,
          suggestion: "Fix the JSON syntax so the MCP servers can be read.",
          location: { file, line: 1, column: 1 },
        }),
      );
      continue;
    }

    const servers = (parsed as { mcpServers?: unknown } | null)?.mcpServers;
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
      result.diagnostics.push(
        diagnostic({
          code: "AGF001",
          message: `${file} has no "mcpServers" object`,
          explanation: 'MCP configuration is read from a top-level "mcpServers" mapping of server name to definition.',
          suggestion: 'Wrap the server definitions in an "mcpServers" object.',
          location: { file, line: 1, column: 1 },
        }),
      );
      continue;
    }

    const provenance = provenanceOf(file, "claude");

    for (const [name, rawEntry] of Object.entries(servers as Record<string, unknown>)) {
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
        result.diagnostics.push(
          diagnostic({
            code: "AGF001",
            message: `MCP server "${name}" is not an object`,
            location: { file },
            data: { server: name },
          }),
        );
        continue;
      }

      const entry = rawEntry as Record<string, unknown>;
      const declaredType = typeof entry.type === "string" ? entry.type : undefined;
      const url = typeof entry.url === "string" ? entry.url : undefined;

      // A documented, deterministic misconfiguration: an entry with a `url` but
      // no `type` is read as a stdio server, so the server is skipped entirely.
      if (url && !declaredType) {
        result.diagnostics.push(
          diagnostic({
            code: "AGF001",
            message: `MCP server "${name}" has a "url" but no "type"`,
            explanation:
              "An entry without a `type` is read as a stdio server, so one with a `url` and no `type` is skipped " +
              "and its tools never load.",
            suggestion: 'Add "type": "http" (or "sse" / "ws") to match the endpoint.',
            location: { file },
            data: { server: name },
          }),
        );
        continue;
      }

      if (declaredType && !REMOTE_TRANSPORTS.includes(declaredType) && declaredType !== "stdio") {
        result.diagnostics.push(
          diagnostic({
            code: "AGF001",
            message: `MCP server "${name}" has an unrecognised type "${declaredType}"`,
            explanation: `Supported transports are stdio, http (or its streamable-http alias), sse, and ws.`,
            location: { file },
            data: { server: name, type: declaredType },
          }),
        );
        continue;
      }

      const transport: McpTransport = declaredType ? normalizeTransport(declaredType) : "stdio";
      const timeout = typeof entry.timeout === "number" ? entry.timeout : undefined;

      result.mcpServers.push({
        name,
        transport,
        command: typeof entry.command === "string" ? entry.command : undefined,
        args: Array.isArray(entry.args)
          ? entry.args.filter((arg): arg is string => typeof arg === "string")
          : undefined,
        env: stringMap(entry.env),
        url,
        headers: stringMap(entry.headers),
        timeoutMs: timeout,
        provenance,
      });

      if (transport === "stdio" && typeof entry.command !== "string") {
        result.diagnostics.push(
          diagnostic({
            code: "AGF001",
            message: `MCP server "${name}" is a stdio server with no "command"`,
            explanation:
              "A stdio server is launched by running `command` with `args`; without it there is nothing to run.",
            suggestion: 'Add a "command", or add a "type" and "url" for a remote server.',
            location: { file },
            data: { server: name },
          }),
        );
      }
    }

    result.sources.push({
      path: file,
      platform: "claude",
      scope: dirnameOf(file) === "" ? "project" : "directory",
      kind: "mcp",
      bytes: text.length,
    });
  }

  return result;
}
