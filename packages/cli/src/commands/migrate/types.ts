export type RuleCategory = "coding" | "architecture" | "testing" | "naming";

export interface ParsedRules {
  coding: string[];
  architecture: string[];
  testing: string[];
  naming: string[];
}

export interface ParsedSkill {
  name: string;
  description: string;
  context: string[];
  steps: string[];
  expected_output: string;
  examples: { input: string; output: string }[];
}

export interface ParsedFile {
  source: string;
  projectName?: string;
  stack?: string[];
  rules: ParsedRules;
  skills: ParsedSkill[];
  unrecognized: { heading: string; lineCount: number }[];
}

export interface MergeResult {
  rules: ParsedRules;
  skills: ParsedSkill[];
  conflicts: string[];
}

export interface Section {
  level: number;
  heading: string;
  lines: string[];
  children: Section[];
}

export type ReplacePolicy = "keep" | "archive" | "delete";

export interface MigrateOptions {
  from: string[];
  dryRun?: boolean;
  output?: string;
  replacePolicy?: ReplacePolicy;
  targets?: string[];
  exclude?: string[];
}

export type MigrateClassification = "imported" | "preserved" | "skipped" | "unsupported";

export interface MigrateReportEntry {
  path: string;
  classification: MigrateClassification;
  reason: string;
}
