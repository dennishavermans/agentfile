import { type Diagnostic, diagnostic, type Location } from "../diagnostics/index.js";
import { capability, type FeatureId, featureMeta, type TargetId } from "./registry.js";

export interface CapabilityCheckContext {
  /** What is being compiled or validated, e.g. `skill "react-native"`. */
  subject: string;
  /** Where the subject is declared, so the diagnostic can point at it. */
  location?: Location;
}

/**
 * Maps a capability lookup onto a diagnostic.
 *
 * Returns `null` for `supported` — a supported feature is not a finding.
 * Severity follows the code registry, so a target gap is an error, a degraded
 * or emulated feature is a warning, and an unverified combination is info.
 */
export function diagnoseCapability(
  target: TargetId,
  feature: FeatureId,
  context: CapabilityCheckContext,
): Diagnostic | null {
  const row = capability(target, feature);
  if (row.level === "supported") return null;

  const title = featureMeta(feature)?.title ?? feature;
  const data = { target: String(target), feature, level: row.level, subject: context.subject };
  const sourceLine = row.source ? `\n\nTarget documentation:\n  ${row.source}` : "";

  if (row.level === "unsupported") {
    return diagnostic({
      code: "AGF201",
      message: `${context.subject} uses ${title}, which target "${target}" does not support`,
      explanation: `${row.note}${sourceLine}`,
      suggestion: `Remove ${title} for this target, or drop "${target}" from the targets that receive ${context.subject}. Compiling it anyway loses this behaviour silently.`,
      location: context.location,
      data,
    });
  }

  if (row.level === "unknown") {
    return diagnostic({
      code: "AGF203",
      message: `Support for ${title} on target "${target}" has not been verified`,
      explanation: `${row.note}${sourceLine}`,
      suggestion: `Verify the behaviour in the target's documentation and add a capability row, or treat ${title} as unavailable for "${target}".`,
      location: context.location,
      data,
    });
  }

  // emulated | degraded
  const qualifier = row.level === "emulated" ? "is emulated rather than native" : "is narrower than elsewhere";
  return diagnostic({
    code: "AGF202",
    message: `${context.subject} uses ${title}, which on target "${target}" ${qualifier}`,
    explanation: `${row.note}${sourceLine}`,
    suggestion: `Confirm the reduced behaviour is acceptable for "${target}", or express ${title} another way for this target.`,
    location: context.location,
    data,
  });
}
