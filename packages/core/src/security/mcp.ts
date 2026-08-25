/**
 * MCP servers.
 *
 * A committed `.mcp.json` is a shared decision about which external processes
 * and endpoints an agent may talk to. Claude Code requires approval before
 * connecting, so this is not about bypassing a gate — it is about the developer
 * at that gate being able to see what they are approving.
 *
 * Two things are worth reporting deterministically: what actually runs is not
 * pinned, and credentials are in the file everyone can read.
 */

import { type Diagnostic, diagnostic, type Location } from "../diagnostics/index.js";
import type { AgentConfiguration, McpServerEntry } from "../ir/index.js";
import { scanExpression, scanSecretValue } from "./patterns.js";

const MCP_DOC = "https://code.claude.com/docs/en/mcp";

function locationOf(server: McpServerEntry): Location {
  return { file: server.provenance.file, line: server.provenance.line };
}

/**
 * Package runners that resolve what to execute at run time.
 *
 * `npx`, `pnpm dlx`, `bunx`, `uvx`, and `pipx run` all fetch a package from a
 * registry when the server starts. Without a version, the version fetched is
 * whatever the registry serves at that moment, so the code that runs can change
 * between two developers on the same commit.
 */
const RUNNERS = ["npx", "bunx", "uvx", "dlx", "pipx"];

/** True when an argv entry pins a version, e.g. `pkg@1.2.3`. */
function isPinned(arg: string): boolean {
  if (arg.startsWith("-")) return false;
  const at = arg.lastIndexOf("@");
  if (at <= 0) return false;
  const version = arg.slice(at + 1);
  return version.length > 0 && version !== "latest" && version !== "next";
}

/** AGF503 for a stdio server whose executed code is not pinned. */
function unpinnedPackage(server: McpServerEntry): Diagnostic[] {
  if (server.transport !== "stdio" || !server.command) return [];

  const command = server.command.split("/").pop() ?? server.command;
  const args = server.args ?? [];
  const isRunner = RUNNERS.includes(command) || args.some((arg) => RUNNERS.includes(arg));
  if (!isRunner) return [];

  // A package argument that pins a version answers the question.
  const packages = args.filter((arg) => !arg.startsWith("-") && !RUNNERS.includes(arg));
  if (packages.some(isPinned)) return [];
  if (!packages.length) return [];

  const invocation = [server.command, ...args].join(" ");

  return [
    diagnostic({
      code: "AGF503",
      message: `MCP server "${server.name}" runs an unpinned package: ${packages.join(", ")}`,
      explanation: [
        `The invocation is \`${invocation}\`.`,
        "",
        "A package runner fetches the package when the server starts, so without a",
        "version the code that runs is whatever the registry serves at that moment.",
        "Two developers on the same commit can end up running different code, and a",
        "compromised release reaches everyone who restarts.",
        "",
        "Claude Code asks before connecting to a project MCP server, so this is not a",
        "gate being bypassed — it is what the person at the gate cannot see.",
        `\nMCP documentation:\n  ${MCP_DOC}`,
      ].join("\n"),
      suggestion: `Pin the version, for example ${packages[0]}@1.2.3.`,
      location: locationOf(server),
      data: { server: server.name, packages: packages.join(",") },
    }),
  ];
}

/** AGF503 for a remote server reached over an unencrypted connection. */
function insecureTransport(server: McpServerEntry): Diagnostic[] {
  if (!server.url || !/^http:\/\//i.test(server.url)) return [];

  const loopback = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(server.url);

  return [
    diagnostic({
      code: "AGF503",
      severity: loopback ? "info" : "warning",
      message: `MCP server "${server.name}" is reached over plain HTTP: ${server.url}`,
      explanation: loopback
        ? "The endpoint is on this machine, so the traffic does not leave it. Recorded so the endpoint is visible."
        : "Everything the agent sends to and receives from this server — including tool arguments and results — is readable and modifiable in transit.",
      suggestion: loopback ? "No action needed." : "Use HTTPS.",
      location: locationOf(server),
      data: { server: server.name, url: server.url },
    }),
  ];
}

/** AGF504 for credentials written literally into `env` or `headers`. */
function embeddedSecrets(server: McpServerEntry): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const surfaces: Array<[string, Record<string, string> | undefined]> = [
    ["env", server.env],
    ["headers", server.headers],
  ];

  for (const [surface, values] of surfaces) {
    for (const [name, value] of Object.entries(values ?? {})) {
      for (const secret of scanSecretValue(value)) {
        diagnostics.push(
          diagnostic({
            code: "AGF504",
            message: `MCP server "${server.name}" has a credential in ${surface}.${name}`,
            explanation: [
              secret.why,
              "",
              "`.mcp.json` is committed and shared with everyone on the project, so this",
              "value is disclosed to everyone with repository access and to anything that",
              "mirrors it.",
              `\nMCP documentation:\n  ${MCP_DOC}`,
            ].join("\n"),
            suggestion: `Replace the value with an environment variable reference such as \${${name}}, then rotate the exposed credential.`,
            location: locationOf(server),
            data: { server: server.name, surface, key: name, secret: secret.id },
          }),
        );
      }
    }
  }

  return diagnostics;
}

/** AGF503 for a risk pattern in the command a stdio server runs. */
function commandRisks(server: McpServerEntry): Diagnostic[] {
  if (server.transport !== "stdio" || !server.command) return [];

  const invocation = [server.command, ...(server.args ?? [])].join(" ");

  return scanExpression(invocation)
    // A network client is the normal shape of an MCP server, so the outbound
    // signal says nothing here and would only add noise.
    .filter((pattern) => pattern.id !== "outbound-network")
    .map((pattern) =>
      diagnostic({
        code: "AGF503",
        severity: pattern.severity,
        message: `MCP server "${server.name}" ${pattern.title}`,
        explanation: [
          pattern.why,
          "",
          `  ${invocation}`,
          "",
          "This is a pattern match on the command text. Nothing was executed to produce",
          "it, and it cannot see intent.",
        ].join("\n"),
        suggestion: "Confirm this is what the server is meant to run.",
        location: locationOf(server),
        data: { server: server.name, risk: pattern.id, analysis: "static-pattern-match" },
      }),
    );
}

/** Every MCP finding for a configuration. */
export function auditMcpServers(configuration: AgentConfiguration): Diagnostic[] {
  return configuration.mcpServers.flatMap((server) => [
    ...unpinnedPackage(server),
    ...insecureTransport(server),
    ...embeddedSecrets(server),
    ...commandRisks(server),
  ]);
}
