/**
 * Eval definitions.
 *
 * The file shape follows the rework brief's conceptual test (REWORK §18)
 * directly: a name, a prompt, and deterministic assertions about the state the
 * agent leaves behind. Where the brief is silent the shape borrows from the
 * eval tools people already know (promptfoo's typed assertion list, plugin
 * eval's per-case frontmatter) rather than inventing a third convention.
 *
 * Everything here parses and validates. Nothing here executes.
 */

import { z } from "zod";
import type { Diagnostic } from "../diagnostics/index.js";
import { loadYamlSource, schemaIssuesToDiagnostics } from "../yaml/index.js";

/** A containment assertion: bare text searches what the run changed; `file` pins it. */
const TextAssertionSchema = z.union([
  z.string().min(1),
  z.strictObject({ file: z.string().min(1), text: z.string().min(1) }),
]);

const AssertionsSchema = z
  .strictObject({
    /** Files that must exist after the run. */
    files: z.array(z.string().min(1)).optional(),
    /** Files that must not exist after the run. */
    absent: z.array(z.string().min(1)).optional(),
    /** Commands that must exit 0, run inside the sandbox. */
    commands: z.array(z.string().min(1)).optional(),
    /** Text that must appear — in the named file, or in a file the run changed. */
    contains: z.array(TextAssertionSchema).optional(),
    /** Text that must not appear — in the named file, or in any file the run changed. */
    forbidden: z.array(TextAssertionSchema).optional(),
  })
  .refine(
    (value) => Object.values(value).some((entries) => entries?.length),
    "at least one assertion is required — an eval that asserts nothing passes vacuously",
  );

export const EvalDefinitionSchema = z.strictObject({
  /** Stable identifier, kebab-case like everything else agentfile names. */
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case: lowercase letters, digits, single hyphens"),
  description: z.string().max(1024).optional(),
  /** The task given to the agent. An eval without a prompt only runs assertions. */
  prompt: z.string().min(1).optional(),
  /** Commands that prepare the sandbox before the agent runs, e.g. `npm install`. */
  setup: z.array(z.string().min(1)).optional(),
  /** Seconds the agent may take. Bounded: an eval is a test, not a session. */
  timeout: z.number().int().positive().max(3600).optional(),
  assertions: AssertionsSchema,
});

export type EvalAssertions = z.infer<typeof AssertionsSchema>;
export type TextAssertion = z.infer<typeof TextAssertionSchema>;

export interface EvalDefinition extends z.infer<typeof EvalDefinitionSchema> {
  /** Project-relative path of the definition file. */
  file: string;
}

export interface ParsedEvalFile {
  definition?: EvalDefinition;
  diagnostics: Diagnostic[];
}

/**
 * Parses one eval file. Malformed YAML is `AGF003`, a schema mismatch is
 * `AGF001` — the same codes every other agentfile YAML surface uses, each
 * located at the offending line.
 */
export function parseEvalDefinition(file: string, text: string): ParsedEvalFile {
  const source = loadYamlSource(file, text);
  if (source.diagnostics.length || source.value === undefined) {
    return { diagnostics: source.diagnostics };
  }

  const result = EvalDefinitionSchema.safeParse(source.value);
  if (!result.success) {
    return { diagnostics: schemaIssuesToDiagnostics(source, result.error) };
  }

  return { definition: { ...result.data, file }, diagnostics: [] };
}

/** The default place eval definitions live, relative to the project root. */
export const EVAL_FILE_SUFFIX = ".eval.yaml";
export const EVAL_DIRECTORY = "evals";

/** Eval definition files among `files`, sorted for deterministic run order. */
export function evalFilesIn(files: readonly string[]): string[] {
  return files.filter((path) => path.endsWith(EVAL_FILE_SUFFIX)).sort();
}
