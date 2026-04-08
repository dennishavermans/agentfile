import { randomBytes } from "crypto";

import * as vscode from "vscode";

import { getSidebarState } from "./project-state.js";
import type { AgentNode, SidebarState } from "./types.js";

export class AgentfileSidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(private readonly root: string) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
    };

    view.webview.onDidReceiveMessage(
      async (message: { type: string; agent?: AgentNode; category?: string; index?: number }) => {
        switch (message.type) {
          case "sync":
            await vscode.commands.executeCommand("agentfile.sync");
            break;
          case "validate":
            await vscode.commands.executeCommand("agentfile.validate", {
              source: "webview",
            });
            this.refresh();
            break;
          case "openContract":
            await vscode.commands.executeCommand("agentfile.openContract");
            break;
          case "refresh":
            await vscode.commands.executeCommand("agentfile.refresh");
            break;
          case "init":
            await vscode.commands.executeCommand("agentfile.init");
            break;
          case "migrate":
            await vscode.commands.executeCommand("agentfile.migrate");
            break;
          case "openAgent":
            await vscode.commands.executeCommand("agentfile.openAgentOutput", message.agent);
            break;
          case "openRule":
            await vscode.commands.executeCommand("agentfile.openContractRule", message.category, message.index);
            break;
          default:
            break;
        }
      },
    );

    this.refresh();
  }

  refresh(): void {
    if (!this.view) {
      return;
    }

    this.view.webview.html = this.getHtml(this.view.webview, getSidebarState(this.root));
  }

  private getHtml(webview: vscode.Webview, state: SidebarState): string {
    const nonce = randomBytes(16).toString("hex");
    const payload = JSON.stringify(state).replace(/</g, "\\u003c");

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        --bg: var(--vscode-sideBar-background);
        --panel: var(--vscode-sideBarSectionHeader-background, var(--vscode-editorWidget-background));
        --line: var(--vscode-sideBar-border, var(--vscode-panel-border));
        --text: var(--vscode-sideBar-foreground);
        --muted: var(--vscode-descriptionForeground);
        --button: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
        --button-hover: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
        --button-foreground: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
        --button-border: var(--vscode-contrastBorder, var(--vscode-widget-border));
        --green: var(--vscode-testing-iconPassed, #56d364);
        --amber: var(--vscode-testing-iconQueued, #f0b44c);
        --gray: var(--vscode-disabledForeground, #6a6a6a);
        --blue: var(--vscode-textLink-foreground);
        --focus: var(--vscode-focusBorder);
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 12px;
        background: var(--bg);
        color: var(--text);
        font: 13px/1.45 var(--vscode-font-family);
      }

      .shell {
        border: 1px solid var(--line);
        border-radius: 16px;
        overflow: hidden;
        background: var(--bg);
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 16px;
        border-bottom: 1px solid var(--line);
      }

      .title {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .syncButton {
        appearance: none;
        border: 1px solid var(--button-border);
        background: var(--button);
        color: var(--button-foreground);
        border-radius: 14px;
        padding: 10px 16px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }

      .actions {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        padding: 0 16px 16px;
        border-bottom: 1px solid var(--line);
      }

      .actionButton {
        appearance: none;
        border: 1px solid var(--button-border);
        background: var(--button);
        color: var(--button-foreground);
        border-radius: 10px;
        padding: 9px 10px;
        font: inherit;
        cursor: pointer;
      }

      .section {
        padding: 16px;
        border-bottom: 1px solid var(--line);
      }

      .section:last-child { border-bottom: 0; }

      .sectionTitle {
        margin: 0 0 12px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .agentList, .skillList { display: grid; gap: 8px; }

      .agentRow, .skillRow {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 10px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--text);
        border-radius: 10px;
        text-align: left;
        cursor: pointer;
      }

      .agentRow:hover, .skillRow:hover, .actionButton:hover, .syncButton:hover {
        border-color: var(--button-border);
        background: var(--button-hover);
      }

      .agentRow:focus-visible,
      .skillRow:focus-visible,
      .actionButton:focus-visible,
      .syncButton:focus-visible,
      .warningActions button:focus-visible {
        outline: 1px solid var(--focus);
        outline-offset: 1px;
      }

      .agentMain { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .agentMeta { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .agentName { font-size: 16px; font-weight: 700; }
      .agentPath { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dot { width: 11px; height: 11px; border-radius: 999px; flex: none; }
      .dot.synced { background: var(--green); }
      .dot.stale { background: var(--amber); }
      .dot.disabled { background: var(--gray); }

      .badge {
        display: inline-flex;
        align-items: center;
        border-radius: 8px;
        padding: 2px 8px;
        font-size: 12px;
        font-weight: 700;
        text-transform: lowercase;
      }

      .badge.stale { background: rgba(240, 180, 76, 0.18); color: var(--amber); }
      .badge.disabled { background: rgba(127, 127, 127, 0.18); color: var(--gray); }

      .rulesGrid {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 6px 14px;
        align-items: start;
      }

      .ruleCategory {
        color: var(--blue);
        font-weight: 700;
        text-transform: lowercase;
      }

      .ruleItems { display: grid; gap: 4px; }
      .ruleItem {
        appearance: none;
        border: 0;
        background: transparent;
        color: var(--text);
        padding: 0;
        text-align: left;
        font: inherit;
        cursor: pointer;
      }

      .skillName { font-size: 15px; font-weight: 700; }
      .skillDescription { color: var(--muted); margin-top: 2px; font-size: 12px; }

      .summary {
        display: flex;
        gap: 12px;
        padding: 0 16px 16px;
        color: var(--muted);
        font-size: 12px;
      }

      .warningCard {
        margin: 0 16px 16px;
        padding: 12px;
        border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(240, 180, 76, 0.34));
        border-left: 3px solid var(--amber);
        border-radius: 12px;
        background: var(--vscode-inputValidation-warningBackground, rgba(240, 180, 76, 0.10));
      }

      .warningTitle { font-weight: 700; margin-bottom: 4px; color: var(--amber); }
      .warningActions { display: flex; gap: 8px; margin-top: 10px; }
      .warningActions button {
        appearance: none;
        border: 1px solid var(--button-border);
        background: var(--button);
        color: var(--button-foreground);
        border-radius: 10px;
        padding: 8px 12px;
        font: inherit;
        cursor: pointer;
      }

      .setupSection {
        display: grid;
        gap: 16px;
        padding: 32px 16px;
        text-align: center;
      }

      .setupIcon {
        font-size: 48px;
        margin-bottom: 8px;
      }

      .setupTitle {
        font-size: 16px;
        font-weight: 700;
        margin-bottom: 4px;
      }

      .setupDescription {
        color: var(--muted);
        font-size: 13px;
        margin-bottom: 8px;
        line-height: 1.4;
      }

      .setupActions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 12px;
      }

      .setupButton {
        appearance: none;
        border: 1px solid var(--button-border);
        background: var(--button);
        color: var(--button-foreground);
        border-radius: 10px;
        padding: 12px 16px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }

      .setupButton:hover {
        background: var(--button-hover);
      }

      .setupButton:focus-visible {
        outline: 1px solid var(--focus);
        outline-offset: 1px;
      }
    </style>
  </head>
  <body>
    <div class="shell" id="app"></div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const state = ${payload};

      const escapeHtml = (value) => value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');

      const badge = (status) => {
        if (status === 'stale') return '<span class="badge stale">stale</span>';
        if (status === 'disabled') return '<span class="badge disabled">disabled</span>';
        return '';
      };

      const agentRows = state.agents.map((agent) => {
        const path = agent.status === 'disabled' ? 'click to enable and create output file' : agent.outputPath;
        return \
          '<button class="agentRow" data-action="openAgent" data-agent="' + encodeURIComponent(JSON.stringify(agent)) + '">' +
            '<span class="agentMain">' +
              '<span class="dot ' + agent.status + '"></span>' +
              '<span class="agentName">' + escapeHtml(agent.name) + '</span>' +
              badge(agent.status) +
            '</span>' +
            '<span class="agentMeta">' +
              '<span class="agentPath">' + escapeHtml(path) + '</span>' +
            '</span>' +
          '</button>';
      }).join('');

      const ruleRows = state.rules.map((group) => \
        '<div class="ruleCategory">' + escapeHtml(group.category) + ':</div>' +
        '<div class="ruleItems">' +
          group.entries.map((entry, index) => '<button class="ruleItem" data-action="openRule" data-category="' + escapeHtml(group.category) + '" data-index="' + index + '">' + escapeHtml(entry) + '</button>').join('') +
        '</div>'
      ).join('');

      const skillRows = state.skills.map((skill) => \
        '<button class="skillRow" data-action="openContract">' +
          '<span>' +
            '<span class="agentMain"><span class="dot synced"></span><span class="skillName">' + escapeHtml(skill.name) + '</span></span>' +
            '<div class="skillDescription">' + escapeHtml(skill.description) + '</div>' +
          '</span>' +
        '</button>'
      ).join('');

      const setupSection = !state.hasContract
        ? '<div class="shell">' +
            '<div class="setupSection">' +
              '<div class="setupIcon">📋</div>' +
              '<div>' +
                '<div class="setupTitle">Initialize Agentfile</div>' +
                '<div class="setupDescription">Start by creating a new contract file or migrate an existing project structure.</div>' +
              '</div>' +
              '<div class="setupActions">' +
                '<button class="setupButton" data-action="init">New Project</button>' +
                '<button class="setupButton" data-action="migrate">Migrate Project</button>' +
              '</div>' +
            '</div>' +
          '</div>'
        : '';

      const warning = state.staleCount > 0
        ? '<div class="warningCard">' +
            '<div class="warningTitle">' + state.staleCount + ' stale output' + (state.staleCount === 1 ? '' : 's') + '</div>' +
            '<div>contract.yaml changed after at least one generated file was last written.</div>' +
            '<div class="warningActions">' +
              '<button data-action="sync">sync now</button>' +
              '<button data-action="openContract">open contract</button>' +
            '</div>' +
          '</div>'
        : '';

      document.getElementById('app').innerHTML = setupSection || (
        '<div class="header">' +
          '<div class="title">agentfile</div>' +
          '<button class="syncButton" data-action="sync">↻ sync</button>' +
        '</div>' +
        '<div class="summary">' +
          '<span>' + state.activeAgentCount + ' agents active</span>' +
          '<span>' + state.staleCount + ' stale</span>' +
        '</div>' +
        warning +
        '<div class="actions">' +
          '<button class="actionButton" data-action="validate">Validate</button>' +
          '<button class="actionButton" data-action="openContract">Open Contract</button>' +
          '<button class="actionButton" data-action="refresh">Refresh</button>' +
        '</div>' +
        '<section class="section">' +
          '<h2 class="sectionTitle">Agents</h2>' +
          '<div class="agentList">' + agentRows + '</div>' +
        '</section>' +
        '<section class="section">' +
          '<h2 class="sectionTitle">Contract Rules</h2>' +
          '<div class="rulesGrid">' + ruleRows + '</div>' +
        '</section>' +
        '<section class="section">' +
          '<h2 class="sectionTitle">Skills</h2>' +
          '<div class="skillList">' + skillRows + '</div>' +
        '</section>'
      );

      document.addEventListener('click', (event) => {
        const target = event.target instanceof HTMLElement ? event.target.closest('[data-action]') : null;
        if (!target) return;

        const action = target.getAttribute('data-action');
        if (action === 'openAgent') {
          const rawAgent = target.getAttribute('data-agent');
          if (!rawAgent) return;
          vscode.postMessage({ type: 'openAgent', agent: JSON.parse(decodeURIComponent(rawAgent)) });
          return;
        }

        if (action === 'openRule') {
          const category = target.getAttribute('data-category');
          const index = Number(target.getAttribute('data-index'));
          if (!category || Number.isNaN(index)) return;
          vscode.postMessage({ type: 'openRule', category, index });
          return;
        }

        vscode.postMessage({ type: action });
      });
    </script>
  </body>
</html>`;
  }
}
