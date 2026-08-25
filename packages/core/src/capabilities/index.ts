export type { CapabilityCheckContext } from "./diagnose.js";
export { diagnoseCapability } from "./diagnose.js";
export type { CapabilityLevel, CapabilityRow, FeatureId, FeatureMeta, TargetId } from "./registry.js";
export {
  CAPABILITIES,
  capability,
  FEATURES,
  featureMeta,
  KNOWN_TARGETS,
  supports,
  targetCapabilities,
} from "./registry.js";
