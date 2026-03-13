import type { Contract, Override } from './schema.js';
export interface RenderContext {
    contract: Contract;
    override: Override | null;
}
/**
 * Renders a template string using a RenderContext.
 * Replaces all ${token} expressions. Unknown tokens are left as-is.
 * Returns a normalised string — trimmed with a single trailing newline.
 */
export declare function renderTemplate(template: string, ctx: RenderContext): string;
//# sourceMappingURL=renderer.d.ts.map