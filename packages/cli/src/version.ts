/// <reference types="node" />

/**
 * The CLI's version, read from its own package.json.
 *
 * Hardcoding it means `--version` and the SARIF `tool.driver.version` go stale
 * at the first release nobody remembers to update them in — and a SARIF log
 * that misreports which version produced it is worse than one that omits it.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const VERSION: string = (require("../package.json") as { version: string }).version;
