import type { Kind } from './dsl';

/** Macro name → what it draws. */
export const MACRO_KINDS: Record<string, Kind> = { ':DQtable': 'table', ':DQscatter': 'scatter', ':DQbar': 'bar' };
/** The macro of the first design; only answered with a note pointing at the new ones. */
export const LEGACY_TYPE = ':dataquery';

const NAME_OF: Record<Kind, string> = { table: ':DQtable', scatter: ':DQscatter', bar: ':DQbar' };
// `}}` cannot appear inside `[[links]]` (they close with `]]`), so the first `}}` ends the macro.
const MACRO = /\{\{renderer\s+(:DQ(?:table|scatter|bar))(?![\w-])\s*,?([\s\S]*?)\}\}/;

export function findMacro(content: string): { macro: string; kind: Kind; dsl: string } | null {
  const m = MACRO.exec(content);
  return m ? { macro: m[0], kind: MACRO_KINDS[m[1]], dsl: m[2].trim() } : null;
}

export function buildMacro(kind: Kind, dsl: string): string {
  const d = dsl.trim();
  return d ? `{{renderer ${NAME_OF[kind]}, ${d}}}` : `{{renderer ${NAME_OF[kind]}}}`;
}

/** Swap the macro text, or return null when the block no longer contains `oldMacro`. */
export function replaceMacro(content: string, oldMacro: string, kind: Kind, dsl: string): string | null {
  const i = content.indexOf(oldMacro);
  if (i < 0) return null;
  return content.slice(0, i) + buildMacro(kind, dsl) + content.slice(i + oldMacro.length);
}
