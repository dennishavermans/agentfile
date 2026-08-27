/// <reference types="node" />

/**
 * `agentfile adopt` — propose a single source of truth, without destroying one.
 *
 * This is the only command that rewrites configuration a human wrote, so the
 * rework brief's constraints on it are enforced by the shape of the code rather
 * than by care: it plans by default and writes only under `--apply`, it prints
 * the plan before asking, it asks before touching anything, and it overwrites a
 * hand-written file only when that file's own text has already been carried into
 * the consolidated source.
 *
 * That last rule is the important one. Adoption happens in two phases because a
 * compiler never carries a target's own files into that target: consolidate
 * first so nothing is unique to a generated file, then generate. Doing both at
 * once is what `AGF205` warns about.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type AdoptionPlan,
  applyCompilation,
  buildManifest,
  type CompilationPlan,
  DEFAULT_SOURCE_PLATFORM,
  discover,
  formatHuman,
  MANIFEST_FILE,
  nodeFileSystem,
  ownedPaths,
  planAdoption,
  planCompilation,
  readManifest,
  sourceOnlyConfiguration,
  writeManifest,
} from "@agentfile/core";
import chalk from "chalk";
import { logger } from "../logger.js";
import { parseFindingFormat, printJson, rejectFormat } from "../report.js";

export interface AdoptOptions {
  /** Directory to adopt instead of the current working directory. */
  root?: string;
  /** Platform to consolidate into. Defaults to `agents-md`. */
  source?: string;
  /** Write the plan. Without this, nothing is written. */
  apply?: boolean;
  /** Skip the confirmation prompt. Only meaningful with --apply. */
  yes?: boolean;
  /** `human` (default) or `json`. */
  format?: string;
}

/** Files whose text the consolidated source now carries, so overwriting them loses nothing. */
function pathsCarriedIntoSource(plan: AdoptionPlan): Set<string> {
  const paths = new Set<string>();
  for (const entry of plan.source?.appended ?? []) paths.add(entry.file);
  for (const entry of plan.source?.alreadyCovered ?? []) paths.add(entry.file);
  return paths;
}

function reportPlan(plan: AdoptionPlan, root: string): void {
  logger.title("agentfile adopt");
  logger.info(root);
  console.log();

  if (!plan.source) {
    if (plan.blockers.length) {
      console.log(formatHuman(plan.blockers, { showSummary: false }));
      console.log();
      return;
    }
    logger.warn("No instruction text found, so there is nothing to consolidate.");
    logger.info("Run `agentfile doctor` to see what agentfile looks for.");
    console.log();
    return;
  }

  const { source } = plan;
  const nothingToMove = source.appended.length === 0 && source.alreadyCovered.length === 0;

  // A repository that has already adopted should say so, rather than describing
  // a consolidation with nothing in it.
  if (nothingToMove && !source.created && !plan.targets.length) {
    logger.success(`${source.file} is already the only source of instructions.`);
    console.log();
    if (plan.untouched.length) reportUntouched(plan);
    return;
  }

  // ─── Step one: the source ────────────────────────────────────────────────
  logger.title("1. Consolidate into one source");
  const state = source.created ? "(created)" : nothingToMove ? "(unchanged)" : "(kept, and added to)";
  logger.info(
    `${chalk.cyan(source.file)} ${chalk.gray(state)}` +
      chalk.gray(" — stays hand-written; this is the file you edit from now on"),
  );
  console.log();

  if (source.appended.length) {
    logger.info("Text moved into it:");
    for (const entry of source.appended) {
      const lines = entry.body.trim().split("\n").length;
      console.log(`  ${chalk.green("move")}  ${entry.file} ${chalk.gray(`(${lines} line${lines === 1 ? "" : "s"})`)}`);
    }
    console.log();
  }

  if (source.alreadyCovered.length) {
    logger.info(chalk.gray("Already said by the source, so not copied again:"));
    for (const entry of source.alreadyCovered) {
      console.log(`  ${chalk.gray("skip")}  ${entry.file}`);
    }
    console.log();
  }

  // ─── Step two: the generated files ───────────────────────────────────────
  if (plan.targets.length) {
    logger.title("2. Generate the rest from it");
    for (const entry of plan.targets) {
      console.log(
        `  ${chalk.yellow("generate")}  ${chalk.cyan(String(entry.target).padEnd(10))} ${chalk.gray(entry.files.join(", "))}`,
      );
    }
    console.log();
    logger.info(
      chalk.gray(
        "These files become compiler output. Editing them directly stops being\n" +
          "  meaningful — the next `agentfile compile` regenerates them from the source.",
      ),
    );
    console.log();
  }

  if (plan.untouched.length) reportUntouched(plan);
}

/** Surfaces adoption does not touch, so their absence from the plan is not a surprise. */
function reportUntouched(plan: AdoptionPlan): void {
  logger.title("Left exactly as it is");
  for (const surface of plan.untouched) {
    console.log(
      `  ${chalk.gray(`${surface.count}`.padStart(3))} ${surface.kind.padEnd(17)} ${chalk.gray(surface.reason)}`,
    );
  }
  console.log();
}

export async function adoptCommand(options: AdoptOptions = {}): Promise<void> {
  const format = parseFindingFormat(options.format);
  if (!format) return rejectFormat(options.format as string, ["human", "json"]);

  const root = options.root ?? process.cwd();
  const discovery = discover({ root });
  const plan = planAdoption(discovery.configuration, {
    root,
    fs: nodeFileSystem,
    sourcePlatform: options.source ?? DEFAULT_SOURCE_PLATFORM,
  });

  if (format === "json") {
    printJson({
      root,
      command: "adopt",
      applied: false,
      source: plan.source && {
        platform: plan.source.platform,
        file: plan.source.file,
        created: plan.source.created,
        appended: plan.source.appended.map((entry) => ({ file: entry.file, platform: entry.platform })),
        alreadyCovered: plan.source.alreadyCovered.map((entry) => ({ file: entry.file, platform: entry.platform })),
        content: plan.source.content,
      },
      targets: plan.targets.map((entry) => ({ target: entry.target, files: entry.files })),
      untouched: plan.untouched,
      blockers: plan.blockers,
    });
    if (plan.blockers.length) process.exit(1);
    return;
  }

  reportPlan(plan, root);

  if (plan.blockers.length) process.exit(1);
  if (!plan.source) return;

  const alreadyAdopted =
    plan.source.appended.length === 0 &&
    plan.source.alreadyCovered.length === 0 &&
    !plan.source.created &&
    !plan.targets.length;
  if (alreadyAdopted) return;

  if (!options.apply) {
    logger.info("This was a plan. Nothing has been written.");
    logger.info(`Run ${chalk.cyan("agentfile adopt --apply")} to carry it out.`);
    console.log();
    return;
  }

  // ─── Applying ────────────────────────────────────────────────────────────
  const overwrites = plan.targets.flatMap((entry) => entry.files);
  if (!options.yes) {
    const { default: Enquirer } = await import("enquirer");
    const enquirer = new Enquirer();
    const { confirm } = (await enquirer.prompt({
      type: "confirm",
      name: "confirm",
      message: `Write ${plan.source.file} and turn ${overwrites.length} file${overwrites.length === 1 ? "" : "s"} into generated output?`,
      initial: false,
    })) as { confirm: boolean };

    if (!confirm) {
      logger.warn("Adoption cancelled. Nothing was written.");
      console.log();
      return;
    }
  }

  // Phase one: the consolidated source, written without a generated marker —
  // it is the file a human edits, not output.
  const sourceAbsolute = join(root, plan.source.file);
  mkdirSync(dirname(sourceAbsolute), { recursive: true });
  writeFileSync(sourceAbsolute, plan.source.content, "utf-8");
  logger.success(`Wrote ${plan.source.file}`);

  if (!plan.targets.length) {
    console.log();
    logger.info("No other platform to generate for. The source is now the only instruction file.");
    console.log();
    return;
  }

  // Phase two: compile, from a fresh read so the new source is what is compiled.
  // The files whose text was carried into the source are passed as owned rather
  // than forced: adoption established ownership over exactly those, and any
  // other hand-written file in the way is still refused.
  const after = discover({ root });
  const manifest = readManifest(root);
  const compilation = planCompilation(sourceOnlyConfiguration(after.configuration, plan.source.file), {
    root,
    fs: nodeFileSystem,
    targets: plan.targets.map((entry) => String(entry.target)),
    owned: new Set([...(manifest ? ownedPaths(manifest) : []), ...pathsCarriedIntoSource(plan)]),
  });

  const written = applyAndRecord(compilation, root);
  console.log();
  for (const file of compilation.files) {
    if (file.action === "unchanged") continue;
    const label = file.action === "refused" ? chalk.red("refused") : chalk.green(file.action);
    console.log(`  ${label.padEnd(18)} ${file.path}`);
  }
  console.log();

  const refused = compilation.files.filter((file) => file.action === "refused");
  if (refused.length) {
    console.log(formatHuman(compilation.diagnostics, { showSummary: false }));
    console.log();
  }

  logger.success(
    `${written.length} file${written.length === 1 ? "" : "s"} generated. Manifest updated: ${MANIFEST_FILE}`,
  );
  logger.info(chalk.gray(`Edit ${plan.source.file} from now on, then run \`agentfile compile\`.`));
  console.log();

  if (refused.length) process.exit(1);
}

/** Writes the compilation and records ownership, so later compiles may update these files. */
function applyAndRecord(plan: CompilationPlan, root: string): string[] {
  const written = applyCompilation(plan, root);

  const ownedFiles = new Map<string, { content: string; source: string }>();
  for (const file of plan.files) {
    if (file.action === "refused") continue;
    ownedFiles.set(file.path, { content: file.content, source: file.source });
  }

  writeManifest(root, buildManifest(ownedFiles, readManifest(root)));
  return written;
}
