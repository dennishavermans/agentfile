// ─── Helpers ───────────────────────────────────────────────────────────────
function renderList(items) {
    return items.length
        ? items.map(item => `- ${item}`).join('\n')
        : '_None defined._';
}
function renderOverrideBlocks(override) {
    if (!override?.blocks?.length)
        return '';
    return override.blocks
        .map(block => `\n## ${block.section}\n\n${block.content.trim()}`)
        .join('\n');
}
// ─── Token Map ─────────────────────────────────────────────────────────────
// Maps template token strings to their resolved values.
// Keeping this explicit makes it easy to add new tokens without
// touching the render loop.
function buildTokenMap(ctx) {
    const { project, rules } = ctx.contract;
    return {
        'project.name': project.name,
        'project.stack.join(\', \')': project.stack.join(', '),
        'rules.coding': renderList(rules.coding),
        'rules.architecture': renderList(rules.architecture),
        'rules.testing': renderList(rules.testing),
        'rules.naming': renderList(rules.naming),
        'override': renderOverrideBlocks(ctx.override)
    };
}
// ─── Renderer ─────────────────────────────────────────────────────────────
/**
 * Renders a template string using a RenderContext.
 * Replaces all ${token} expressions. Unknown tokens are left as-is.
 * Returns a normalised string — trimmed with a single trailing newline.
 */
export function renderTemplate(template, ctx) {
    const tokens = buildTokenMap(ctx);
    let output = template;
    for (const [token, value] of Object.entries(tokens)) {
        output = output.replaceAll(`\${${token}}`, value);
    }
    return output.trim() + '\n';
}
//# sourceMappingURL=renderer.js.map