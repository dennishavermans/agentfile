export type { FidelityReport } from "./fidelity.js";
export { fidelity } from "./fidelity.js";
export type { CompilationPlan, CompiledFile, FileAction, PlanOptions } from "./host.js";
export { applyCompilation, driftedFiles, planCompilation } from "./host.js";
export type { SelectedSources } from "./sources.js";
export { isCompileSource, mergeBodies, outputSlug, selectSources } from "./sources.js";
export {
  agentsMdCompiler,
  claudeCompiler,
  COMPILE_TARGETS,
  COMPILERS,
  compilerFor,
  copilotCompiler,
  cursorCompiler,
} from "./targets.js";
export type { CompilePlan, NotCarried, PlannedFile, TargetCompiler } from "./types.js";
