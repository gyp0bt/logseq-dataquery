import { addY, parseQuery, removeY, setImg, setSetting, stepImg, toggleErr, toggleHidden, type Kind, type SettingName } from '../core/dsl';
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

/** Rewrite the macro with `edit` applied to its query as the block holds it now. */
async function editMacro(api: LogseqLike, macroUuid: string, edit: (dsl: string) => string): Promise<void> {
  const { macro, kind, dsl } = await readMacro(api, macroUuid);
  const next = edit(dsl);
  if (next !== dsl) await saveDsl(api, macroUuid, macro, kind, next);
}

/** Ctrl+wheel over a table image: write the height it ended on as `img:`. */
export function setImgInMacro(api: LogseqLike, macroUuid: string, px: number): Promise<void> {
  return editMacro(api, macroUuid, (dsl) => setImg(dsl, px));
}

/** A table cell edit: write `key:: value` into the block, or remove the property when the value is empty. */
export async function saveCell(api: LogseqLike, blockUuid: string, key: string, value: string): Promise<void> {
  const v = value.trim();
  try {
    if (v) await api.Editor.upsertBlockProperty(blockUuid, key, v);
    else await api.Editor.removeBlockProperty(blockUuid, key);
  } catch (e) {
    throw new Error(v ? `Could not save '${key}' to the block.` : `Could not remove '${key}' from the block.`, { cause: e });
  }
}

export const SETTING_NAMES: readonly string[] = ['x', 'y', 'color', 'sort', 'by', 'labels', 'err', 'hide', 'img'] satisfies SettingName[];

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
  if (name === 'hide' && op === 'toggle' && e.dataset.col) {
    const col = e.dataset.col;
    return editMacro(api, macro, (dsl) => toggleHidden(dsl, col));
  }
  if (name === 'img' && op !== undefined) {
    if (op !== 'inc' && op !== 'dec') throw new Error(`Data query: unexpected control 'img:${op}'.`);
    return editMacro(api, macro, (dsl) => stepImg(dsl, op === 'inc' ? 1 : -1));
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

/** A new table row: a block of its own, right below the block of the row it follows. Returns its uuid. */
export async function insertRow(api: LogseqLike, afterUuid: string, content: string): Promise<string> {
  let made: { uuid: string } | null;
  try {
    made = await api.Editor.insertBlock(afterUuid, content, { sibling: true, before: false });
  } catch (e) {
    throw new Error('Could not add a block for the new row.', { cause: e });
  }
  if (!made?.uuid) throw new Error('Logseq did not return the new block.');
  return made.uuid;
}

/** Delete the blocks of a table row. Logseq's undo brings them back. */
export async function deleteBlocks(api: LogseqLike, uuids: string[]): Promise<void> {
  for (const uuid of uuids) {
    try {
      await api.Editor.removeBlock(uuid);
    } catch (e) {
      throw new Error('Could not delete the row\'s block.', { cause: e });
    }
  }
}
