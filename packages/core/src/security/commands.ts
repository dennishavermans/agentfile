/**
 * Slash commands.
 *
 * A command reads as a prompt, but a Claude Code command body can carry
 * `` !`shell` `` — executed at invocation, before the model sees a word of the
 * output. Unless `disable-model-invocation` bars it, the model can invoke the
 * command itself through the SlashCommand tool, which makes that shell
 * agent-reachable, not just human-reachable. Both facts are stated in every
 * finding, and the shell itself is only ever read.
 */

import { type Diagnostic, diagnostic } from "../diagnostics/index.js";
import type { AgentConfiguration, CommandEntry } from "../ir/index.js";
import { scanExpression } from "./patterns.js";

const COMMANDS_DOC = "https://code.claude.com/docs/en/slash-commands";

/** Who can trigger the command's inline shell. */
function reachability(command: CommandEntry): string {
  return command.disableModelInvocation
    ? "Only a person can invoke this command; disable-model-invocation bars the model from running it itself."
    : "The model can invoke this command through the SlashCommand tool, so this shell is reachable without a person typing the command.";
}

/** AGF501 for inline shell matching a risk pattern. */
function inlineShellRisks(command: CommandEntry): Diagnostic[] {
  const findings: Diagnostic[] = [];

  for (const shell of command.inlineCommands) {
    for (const pattern of scanExpression(shell)) {
      findings.push(
        diagnostic({
          code: "AGF501",
          severity: pattern.severity,
          message: `Command /${command.name} embeds shell that ${pattern.title}`,
          explanation: [
            pattern.why,
            "",
            `  !\`${shell}\``,
            "",
            "This runs when the command is invoked, before the model sees the output.",
            reachability(command),
            "",
            "This is a pattern match on the command text. Nothing was executed to produce",
            `it, and it cannot see intent.\n\nSlash command documentation:\n  ${COMMANDS_DOC}`,
          ].join("\n"),
          suggestion:
            pattern.severity === "info"
              ? "No action needed unless the destinations are unexpected."
              : "Confirm this is intended for something that runs on invocation. If it is, a comment saying why saves the next reader the same work.",
          location: { file: command.provenance.file },
          data: {
            command: command.name,
            risk: pattern.id,
            modelInvocable: !command.disableModelInvocation,
            analysis: "static-pattern-match",
          },
        }),
      );
    }
  }

  return findings;
}

/** Static analysis of every discovered slash command. Nothing is executed. */
export function auditCommands(configuration: AgentConfiguration): Diagnostic[] {
  return configuration.commands.flatMap((command) => inlineShellRisks(command));
}
