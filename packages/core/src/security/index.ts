export type { AuditOptions, AuditResult, AuditSurface } from "./audit.js";
export { auditConfiguration, NO_FINDINGS_CAVEAT } from "./audit.js";
export { auditCommands } from "./commands.js";
export type { HookAuditOptions } from "./hooks.js";
export { auditHooks } from "./hooks.js";
export { auditInstructionText, INJECTION_INDICATORS, INVISIBLE_CHARACTER_NAMES } from "./injection.js";
export { auditMcpServers } from "./mcp.js";
export type { RiskMatch, RiskPattern, RiskRequirement } from "./patterns.js";
export {
  isVariableReference,
  RISK_PATTERNS,
  SECRET_VALUE_PATTERNS,
  scanArgv,
  scanExpression,
  scanSecretValue,
  scanText,
  shellScriptInArgv,
} from "./patterns.js";
export { auditPermissions, parsePermissionRule } from "./permissions.js";
