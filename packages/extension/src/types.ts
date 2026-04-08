export type AgentStatus = "synced" | "stale" | "disabled";

export type AgentNode = {
  name: string;
  outputPath: string;
  status: AgentStatus;
};

export type RuleGroup = {
  category: string;
  entries: string[];
};

export type SkillNode = {
  name: string;
  description: string;
};

export type SidebarState = {
  hasContract: boolean;
  agents: AgentNode[];
  rules: RuleGroup[];
  skills: SkillNode[];
  activeAgentCount: number;
  staleCount: number;
};
