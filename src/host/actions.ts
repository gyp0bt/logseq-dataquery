import { setSetting, type Kind, type SettingName } from '../core/dsl';
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
