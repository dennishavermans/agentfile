/**
 * Adoption planning.
 *
 * `adopt` answers one question: what would it take for this repository to have a
 * single source of truth, and what would that cost? It is the only command that
 * proposes a change to configuration the repository wrote by hand, so every
 * constraint the rework brief puts on it is structural here rather than
 * advisory — it plans, it never writes (the caller applies), it reports what it
 * would leave alone, and it refuses rather than guesses.
 *
 * The shape of the plan follows from one fact about compilation: a compiler
 * never carries a target's own files into that target. Generating CLAUDE.md
 * while CLAUDE.md still holds text nothing else has would therefore lose that
 * text. So adoption is two phases, in this order and not the other:
 *
 *   1. **Consolidate.** Everything every platform says ends up in one source
 *      file, which stays hand-written. Nothing is rewritten or summarised —
 *      bodies are appended whole, and a body already covered by the source is
 *      skipped rather than duplicated.
 *   2. **Generate.** Every other platform's file becomes compiler output of
 *      that source.
 *
 * Doing these in one pass is what produces the content swap AGF205 describes.
 */

import { normalizeInstructionLine } from "../analysis/index.js";
import type { TargetId } from "../capabilities/index.js";
import { COMPILE_TARGETS } from "../compilers/index.js";
import type { Diagnostic } from "../diagnostics/index.js";
import type { FileSystem } from "../fs/index.js";
import { type AgentConfiguration, type Instruction, type PlatformId, withoutAliases } from "../ir/index.js";

/**
 * The platform a repository consolidates into unless told otherwise.
 *
 * `AGENTS.md` is the cross-tool standard — read natively by Claude Code, Codex,
 * Cursor, Copilot and others, and stewarded by the Linux Foundation's Agentic
 * AI Foundation. Consolidating anywhere else means the source itself is
 * readable by fewer agents than the files generated from it.
 */
export const DEFAULT_SOURCE_PLATFORM = "agents-md";

/** A file whose text moves into the consolidated source. */
export interface AdoptedBody {
  file: string;
  platform: PlatformId;
  /** The body as authored. Never rewritten. */
  body: string;
}

export interface AdoptionSource {
  /** Platform the repository consolidates into. */
  platform: PlatformId;
  /** Path the consolidated source is written to. */
  file: string;
  /** True when the source file does not exist yet and adoption would create it. */
  created: boolean;
  /** The source's own current text, kept first and unchanged. */
  existing: string;
  /** Bodies appended to it, in deterministic order. */
  appended: AdoptedBody[];
  /** Bodies skipped because the source already says everything they say. */
  alreadyCovered: AdoptedBody[];
  /** The full text the source file would hold. */
  content: string;
}

/** A target that would become compiler output, and the files evidencing it. */
export interface AdoptionTarget {
  target: TargetId;
  files: string[];
}

/** Configuration adoption does not touch, stated so its absence is not a surprise. */
export interface UntouchedSurface {
  kind: string;
  count: number;
  reason: string;
}

export interface AdoptionPlan {
  /** Undefined when there is no instruction text to consolidate. */
  source?: AdoptionSource;
  /** Targets to compile after the source is consolidated. */
  targets: AdoptionTarget[];
  /** Surfaces left exactly as they are. */
  untouched: UntouchedSurface[];
  /** Reasons adoption cannot proceed. Empty means the plan is applicable. */
  blockers: Diagnostic[];
}

export interface AdoptionOptions {
  /** Absolute project root. */
  root: string;
  fs: FileSystem;
  /** Platform to consolidate into. Defaults to `agents-md`. */
  sourcePlatform?: PlatformId;
}

/** Where a platform's root instruction file lives. */
const ROOT_FILE_FOR: Record<string, string> = {
  "agents-md": "AGENTS.md",
  claude: "CLAUDE.md",
  copilot: ".github/copilot-instructions.md",
};

/**
 * Instructions adoption considers.
 *
 * Symlink twins are one text. Generated files are already output. `local`-scoped
 * files are personal and must never be folded into something committed.
 */
function adoptable(configuration: AgentConfiguration): Instruction[] {
  return withoutAliases(configuration.instructions)
    .filter((entry) => entry.provenance.origin !== "generated")
    .filter((entry) => entry.provenance.scope !== "local")
    .filter((entry) => entry.body.trim().length > 0)
    .sort((a, b) => {
      const byFile = a.provenance.file.localeCompare(b.provenance.file);
      return byFile !== 0 ? byFile : (a.provenance.line ?? 0) - (b.provenance.line ?? 0);
    });
}

/** Normalised, non-trivial lines of a body — the unit "already covered" is measured in. */
function meaningfulLines(body: string): Set<string> {
  const lines = new Set<string>();
  for (const raw of body.split("\n")) {
    const normalized = normalizeInstructionLine(raw);
    if (normalized.length > 0) lines.add(normalized);
  }
  return lines;
}

/** True when every line of `body` already appears in `covering`. */
function isCoveredBy(body: string, covering: Set<string>): boolean {
  const lines = meaningfulLines(body);
  if (lines.size === 0) return true;
  for (const line of lines) {
    if (!covering.has(line)) return false;
  }
  return true;
}

/**
 * Builds the consolidated source text.
 *
 * Bodies are appended whole, under a heading naming where they came from.
 * Merging line by line would read better and would also silently reorder
 * someone's prose and strip the context a rule depends on — so the text is left
 * intact, and the duplication that remains is reported by `lint` for a human to
 * resolve rather than resolved by guesswork here.
 */
function consolidate(existing: string, candidates: readonly AdoptedBody[]): AdoptionSource["content"] {
  const blocks: string[] = [];

  const own = existing.trim();
  if (own) blocks.push(own);

  for (const candidate of candidates) {
    const body = candidate.body.trim();
    if (!body) continue;
    blocks.push(`## From ${candidate.file}\n\n${body}`);
  }

  // Blank line between blocks, because a markdown heading glued to the previous
  // line is not a heading.
  return `${blocks.join("\n\n")}\n`;
}

/**
 * Plans adoption. Reads the filesystem, writes nothing.
 *
 * The returned plan is complete enough to print as a diff and to apply without
 * consulting anything else.
 */
export function planAdoption(configuration: AgentConfiguration, options: AdoptionOptions): AdoptionPlan {
  const sourcePlatform = options.sourcePlatform ?? DEFAULT_SOURCE_PLATFORM;
  const instructions = adoptable(configuration);

  const untouched = untouchedSurfaces(configuration);
  const blockers: Diagnostic[] = [];

  const sourceFile = ROOT_FILE_FOR[String(sourcePlatform)];
  if (!sourceFile) {
    blockers.push({
      code: "AGF001",
      severity: "error",
      message: `Cannot consolidate into "${sourcePlatform}": it has no single root instruction file`,
      explanation:
        "Adoption needs one file to hold the consolidated source. Platforms whose\n" +
        "instructions are a directory of rule files have no such file.",
      suggestion: `Choose a platform with a root file: ${Object.keys(ROOT_FILE_FOR).join(", ")}.`,
    });
    return { targets: [], untouched, blockers };
  }

  if (!instructions.length) {
    return { targets: [], untouched, blockers };
  }

  // The source's own text stays first and unchanged; everything else is a
  // candidate for appending.
  const own = instructions.filter((entry) => entry.provenance.platform === sourcePlatform);
  const others = instructions.filter((entry) => entry.provenance.platform !== sourcePlatform);

  const existing = own.map((entry) => entry.body.trim()).join("\n\n");
  const covering = meaningfulLines(existing);

  const appended: AdoptedBody[] = [];
  const alreadyCovered: AdoptedBody[] = [];

  for (const entry of others) {
    const candidate: AdoptedBody = {
      file: entry.provenance.file,
      platform: entry.provenance.platform,
      body: entry.body,
    };

    if (isCoveredBy(entry.body, covering)) {
      alreadyCovered.push(candidate);
      continue;
    }

    appended.push(candidate);
    for (const line of meaningfulLines(entry.body)) covering.add(line);
  }

  const source: AdoptionSource = {
    platform: sourcePlatform,
    file: sourceFile,
    created: own.length === 0,
    existing,
    appended,
    alreadyCovered,
    content: consolidate(existing, appended),
  };

  return { source, targets: targetsToGenerate(instructions, sourcePlatform), untouched, blockers };
}

/**
 * Targets that would become generated output.
 *
 * Only platforms the repository already maintains instructions for: adoption
 * normalises what is here, it does not add support for tools nobody uses. The
 * source platform is never in this list — that is the whole point.
 */
function targetsToGenerate(instructions: readonly Instruction[], sourcePlatform: PlatformId): AdoptionTarget[] {
  const byTarget = new Map<TargetId, string[]>();

  for (const entry of instructions) {
    const platform = String(entry.provenance.platform);
    if (platform === String(sourcePlatform)) continue;
    if (!COMPILE_TARGETS.includes(platform)) continue;

    const files = byTarget.get(platform) ?? [];
    if (!files.includes(entry.provenance.file)) files.push(entry.provenance.file);
    byTarget.set(platform, files);
  }

  return [...byTarget.entries()]
    .map(([target, files]) => ({ target, files: files.sort() }))
    .sort((a, b) => String(a.target).localeCompare(String(b.target)));
}

/**
 * The configuration as it will be once adoption has consolidated.
 *
 * Phase two must compile from the source and nothing else. Left to itself, a
 * compile run straight after writing the source still sees the old files —
 * they are on disk, hand-written, and not yet output — so each target would be
 * built from its siblings as well as the source, and their text would appear
 * twice. Narrowing the configuration to the source file is what makes "generate
 * the rest from it" literally true.
 */
export function sourceOnlyConfiguration(configuration: AgentConfiguration, sourceFile: string): AgentConfiguration {
  return {
    ...configuration,
    instructions: configuration.instructions.filter((entry) => entry.provenance.file === sourceFile),
    directives: configuration.directives.filter((entry) => entry.provenance.file === sourceFile),
  };
}

/** Everything adoption deliberately leaves alone. */
function untouchedSurfaces(configuration: AgentConfiguration): UntouchedSurface[] {
  const surfaces: Array<[string, number, string]> = [
    ["skills", configuration.skills.length, "a skill is already one file with one owner"],
    ["subagents", configuration.subagents.length, "no target format expresses another platform's subagents"],
    ["commands", configuration.commands.length, "commands are invoked by name, not loaded as context"],
    ["hooks", configuration.hooks.length, "hooks live in settings, which adoption does not rewrite"],
    ["MCP servers", configuration.mcpServers.length, "server configuration is not instruction text"],
    [
      "permission rules",
      configuration.permissions.length,
      "permissions decide what an agent may do, not what it is told",
    ],
  ];

  return surfaces.filter(([, count]) => count > 0).map(([kind, count, reason]) => ({ kind, count, reason }));
}
