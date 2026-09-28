export const MACRO_TYPE = ':dataquery';
// `}}` cannot appear inside `[[links]]` (they close with `]]`), so the first `}}` ends the macro.
const MACRO = /\{\{renderer\s+:dataquery\b[\s\S]*?\}\}/;

export function findMacro(content: string): string | null {
  return MACRO.exec(content)?.[0] ?? null;
}

export function dslFromMacro(macro: string): string {
  const m = /^\{\{renderer\s+:dataquery\s*,?([\s\S]*)\}\}$/.exec(macro);
  return m ? m[1].trim() : '';
}

export function buildMacro(dsl: string): string {
  const d = dsl.trim();
  return d ? `{{renderer :dataquery, ${d}}}` : '{{renderer :dataquery}}';
}

/** Swap the macro text, or return null when the block no longer contains `oldMacro`. */
export function replaceMacro(content: string, oldMacro: string, dsl: string): string | null {
  const i = content.indexOf(oldMacro);
  if (i < 0) return null;
  return content.slice(0, i) + buildMacro(dsl) + content.slice(i + oldMacro.length);
}
