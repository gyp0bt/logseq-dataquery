import { addY, parseQuery, removeY, setSetting, toggleErr, type Kind, type SettingName } from '../core/dsl';
import { buildMacro, findMacro, replaceMacro } from '../core/macroText';
import type { LogseqLike } from './api';

/** Message plus the whole cause chain, for places that can only show text. */
export function errorText(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  while (cur !== undefined && cur !== null) {
    parts.push(cur instanceof Error ? cur.message : String(cur));
    cur = cur instanceof Error ? cur.cause : undefined;
  }
  return parts[0] + parts.slice(1).map((p) => ` (cause: ${p})`).join('');
}

async function getBlock(api: LogseqLike, uuid: string): Promise<any> {
  try {
    return await api.Editor.getBlock(uuid);
  } catch (e) {
    throw new Error('Could not read the block from Logseq.', { cause: e });
  }
}

export async function readMacro(api: LogseqLike, macroUuid: string): Promise<{ macro: string; kind: Kind; dsl: string }> {
  const block = await getBlock(api, macroUuid);
  const found = block ? findMacro(String(block.content)) : null;
  if (!found) throw new Error('The query block no longer contains a DQtable, DQscatter or DQbar macro.');
  return found;
}

/** Rewrite the macro; refuses if the block no longer holds `oldMacro` (edited elsewhere). */
export async function saveDsl(api: LogseqLike, macroUuid: string, oldMacro: string, kind: Kind, dsl: string): Promise<string> {
  const block = await getBlock(api, macroUuid);
  if (!block) throw new Error('The query block no longer exists.');
  const next = replaceMacro(String(block.content), oldMacro, kind, dsl);
  if (next === null) throw new Error('The query block was edited after this view was drawn. Try again.');
  try {
    await api.Editor.updateBlock(macroUuid, next);
  } catch (e) {
    throw new Error('Could not save the query to the page.', { cause: e });
  }
  return buildMacro(kind, dsl);
}

/** A side button or table header: change one `name:value` setting and keep the rest of the query as written. */
export async function setSettingInMacro(api: LogseqLike, macroUuid: string, name: SettingName, value: string | null): Promise<void> {
  const { macro, kind, dsl } = await readMacro(api, macroUuid);
  const next = setSetting(dsl, name, value);
  if (next !== dsl) await saveDsl(api, macroUuid, macro, kind, next);
}

/**
 * `±` / `▤`: switch error bars or the band on or off. The next value comes from the macro text
 * as it is now, not from the button, so a press always switches even if the view is stale.
 */
export async function toggleErrInMacro(api: LogseqLike, macroUuid: string, button: 'bar' | 'band'): Promise<void> {
  const { macro, kind, dsl } = await readMacro(api, macroUuid);
  const parsed = parseQuery(dsl);
  if (!parsed.ok) throw new Error(`Fix the query first: ${parsed.error.message}`);
  const next = setSetting(dsl, 'err', toggleErr(parsed.query.err, button));
  if (next !== dsl) await saveDsl(api, macroUuid, macro, kind, next);
}

/** `+ Y` / chip ×: add or remove one bar-chart y column, worked out from the macro text as it is now. */
export async function editYInMacro(api: LogseqLike, macroUuid: string, op: 'add' | 'remove', col: string, fallback: string[] = []): Promise<void> {
  const { macro, kind, dsl } = await readMacro(api, macroUuid);
  const next = op === 'add' ? addY(dsl, col, fallback) : removeY(dsl, col);
  if (next !== dsl) await saveDsl(api, macroUuid, macro, kind, next);
}

export const SETTING_NAMES: readonly string[] = ['x', 'y', 'color', 'sort', 'by', 'labels', 'err'] satisfies SettingName[];

/**
 * What a `data-on-*` control sends: a select carries `value`, a button names `data-value`.
 * An on/off button (`data-toggle`) and the bar Y chips (`data-op`) name neither: their next
 * value is read from the macro when pressed.
 */
export interface SetEvent {
  value?: string;
  dataset: { macro?: string; name?: string; value?: string; toggle?: string; op?: string; col?: string; default?: string };
}

/** Apply one side-panel or table-header control to the macro. */
export async function applyControl(api: LogseqLike, e: SetEvent): Promise<void> {
  const { macro, name, toggle, op } = e.dataset;
  if (!macro || !name || !SETTING_NAMES.includes(name)) throw new Error(`Data query: unexpected control '${name}'.`);
  if (toggle !== undefined) {
    if (name !== 'err' || (toggle !== 'bar' && toggle !== 'band')) throw new Error(`Data query: unexpected toggle '${name}:${toggle}'.`);
    return toggleErrInMacro(api, macro, toggle);
  }
  if (op !== undefined) {
    if (name !== 'y' || (op !== 'add' && op !== 'remove')) throw new Error(`Data query: unexpected control '${name}:${op}'.`);
    const col = op === 'add' ? e.value ?? '' : e.dataset.col ?? '';
    // The `+ Y` select's blank first option changes nothing.
    if (!col) return;
    const fallback = (e.dataset.default ?? '').split(',').filter(Boolean);
    return editYInMacro(api, macro, op, col, fallback);
  }
  const value = e.dataset.value ?? e.value ?? '';
  // An empty value ("none", or the default of a cycle) removes the setting.
  return setSettingInMacro(api, macro, name as SettingName, value === '' ? null : value);
}

export async function jumpTo(api: LogseqLike, uuid: string): Promise<void> {
  const block = await getBlock(api, uuid);
  if (!block) throw new Error('That block no longer exists.');
  let page: any;
  try {
    page = await api.Editor.getPage(block.page.id);
  } catch (e) {
    throw new Error('Could not read the page of that block.', { cause: e });
  }
  if (!page) throw new Error('The page of that block no longer exists.');
  api.Editor.scrollToBlockInPage(page.originalName ?? page.name, uuid);
}
