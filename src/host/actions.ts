import { buildMacro, dslFromMacro, findMacro, replaceMacro } from '../core/macroText';
import type { ValueType } from '../core/types';
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

export async function readMacro(api: LogseqLike, macroUuid: string): Promise<{ macro: string; dsl: string }> {
  const block = await api.Editor.getBlock(macroUuid);
  const macro = block ? findMacro(String(block.content)) : null;
  if (!macro) throw new Error('The query block no longer contains a data query.');
  return { macro, dsl: dslFromMacro(macro) };
}

/** Rewrite the macro; refuses if the block no longer holds `oldMacro` (edited elsewhere). */
export async function saveDsl(api: LogseqLike, macroUuid: string, oldMacro: string, dsl: string): Promise<string> {
  const block = await api.Editor.getBlock(macroUuid);
  if (!block) throw new Error('The query block no longer exists.');
  const next = replaceMacro(String(block.content), oldMacro, dsl);
  if (next === null) throw new Error('The query block was edited after this view opened. Close the panel, reopen it, and try again.');
  try {
    await api.Editor.updateBlock(macroUuid, next);
  } catch (e) {
    throw new Error('Could not save the query to the page.', { cause: e });
  }
  return buildMacro(dsl);
}

export async function setType(api: LogseqLike, typesPage: string, key: string, type: ValueType): Promise<void> {
  try {
    const page = await api.Editor.getPage(typesPage);
    if (!page) {
      await api.Editor.createPage(typesPage, { [key]: type }, { redirect: false, createFirstBlock: true });
      return;
    }
    const tree = (await api.Editor.getPageBlocksTree(typesPage)) ?? [];
    const first = tree[0];
    if (!first) await api.Editor.appendBlockInPage(typesPage, `${key}:: ${type}`);
    else if (first['preBlock?'] || first.preBlock) await api.Editor.upsertBlockProperty(first.uuid, key, type);
    else await api.Editor.insertBlock(first.uuid, `${key}:: ${type}`, { before: true, sibling: true });
  } catch (e) {
    throw new Error(`Could not write '${key}:: ${type}' to the types page '${typesPage}'.`, { cause: e });
  }
}

export async function jumpTo(api: LogseqLike, uuid: string): Promise<void> {
  const block = await api.Editor.getBlock(uuid);
  if (!block) throw new Error('That block no longer exists.');
  const page = await api.Editor.getPage(block.page.id);
  api.Editor.scrollToBlockInPage(page.originalName ?? page.name, uuid);
}
