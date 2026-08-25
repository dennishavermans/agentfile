export type { ReachabilityOptions } from "./reachability.js";
export { deadPatterns, unreachableDiagnostics } from "./reachability.js";
export { configuredDirectories, probePaths, repositoryResolutionDiagnostics } from "./repository.js";
export type {
  Applied,
  EffectiveConfiguration,
  Excluded,
  ExclusionReason,
  Explanation,
  MatchReason,
  ResolutionRank,
  ResolveOptions,
} from "./resolve.js";
export { explainInstruction, normalizeDirectiveText, resolveForPath, SCOPE_RANK } from "./resolve.js";
