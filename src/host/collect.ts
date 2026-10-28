import type { SourceBlock } from '../core/rows';
import { parseContent } from '../core/text';
import { emptyOverrides, parseTypeOverrides, type TypeOverrides } from '../core/types';
import type { LogseqLike } from './api';

export const BLOCKS_QUERY = `[:find (pull ?b [:db/id :block/uuid :block/content :block/pre-block?
  {:block/page [:block/name :block/original-name :block/journal-day]}
  {:block/path-refs [:block/name]}
  {:block/parent [:block/uuid :block/content {:block/parent [:block/uuid :block/content {:block/parent [:block/uuid :block/content]}]}]}])
 :where [?b :block/properties ?p] [(not= ?p {})]]`;

/** Logseq may return namespaced, kebab or camel keys depending on the call path. */
function pick(o: any, ...names: string[]): any {
  for (const n of names) if (o && o[n] !== undefined && o[n] !== null) return o[n];
  return undefined;
}

/** Text of the nearest ancestor that has any (the pull holds three levels; a page has no content). */
function ancestorTitle(parent: any): { title: string; uuid?: string } | undefined {
  for (let p = parent, depth = 0; p && typeof p === 'object' && depth < 3; p = pick(p, 'parent', 'block/parent'), depth++) {
    const content = pick(p, 'content', 'block/content');
    const title = typeof content === 'string' ? parseContent(content).title : '';
    if (title) {
      const raw = pick(p, 'uuid', 'block/uuid');
      return { title, uuid: typeof raw === 'string' ? raw : raw != null ? String(raw.uuid ?? raw) : undefined };
    }
  }
  return undefined;
}

export function toSourceBlock(raw: any): SourceBlock | null {
  const rawUuid = pick(raw, 'uuid', 'block/uuid');
  // Normally a string; some call paths hand back a UUID object.
  const uuid = typeof rawUuid === 'string' ? rawUuid : rawUuid != null ? String(rawUuid.uuid ?? rawUuid) : undefined;
  const content = pick(raw, 'content', 'block/content');
  if (typeof uuid !== 'string' || typeof content !== 'string') return null;
  const page = pick(raw, 'page', 'block/page') ?? {};
  const name = String(pick(page, 'name', 'block/name') ?? '');
  const refs: any[] = pick(raw, 'path-refs', 'pathRefs', 'block/path-refs') ?? [];
  const up = ancestorTitle(pick(raw, 'parent', 'block/parent'));
  return {
    uuid,
    content,
    parentTitle: up?.title,
    parentUuid: up?.uuid,
    page: name.toLowerCase(),
    pageTitle: String(pick(page, 'original-name', 'originalName', 'block/original-name') ?? name),
    journalDay: pick(page, 'journal-day', 'journalDay', 'block/journal-day') ?? null,
    pathRefs: refs.map((r) => String(pick(r, 'name', 'block/name') ?? '').toLowerCase()).filter(Boolean),
    preBlock: !!pick(raw, 'pre-block?', 'preBlock?', 'preBlock', 'block/pre-block?'),
    seq: Number(pick(raw, 'id', 'db/id') ?? 0),
  };
}

export async function fetchBlocks(api: LogseqLike): Promise<SourceBlock[]> {
  let res: any;
  try {
    res = await api.DB.datascriptQuery(BLOCKS_QUERY);
  } catch (e) {
    throw new Error('Could not read blocks from the Logseq database.', { cause: e });
  }
  const all: any[] = res ?? [];
  const blocks = all
    .map((r) => toSourceBlock(Array.isArray(r) ? r[0] : r))
    .filter((b): b is SourceBlock => b !== null);
  if (blocks.length < all.length) console.warn(`[dataquery] skipped ${all.length - blocks.length} blocks without uuid or content`, all.find((r) => !toSourceBlock(Array.isArray(r) ? r[0] : r)));
  return blocks;
}

export async function fetchTypeOverrides(api: LogseqLike, typesPage: string): Promise<TypeOverrides> {
  let tree: any[] | null;
  try {
    tree = await api.Editor.getPageBlocksTree(typesPage);
  } catch (e) {
    throw new Error(`Could not read the types page '${typesPage}'.`, { cause: e });
  }
  if (!tree?.length) return emptyOverrides();
  return parseTypeOverrides(parseContent(String(tree[0].content ?? '')).props);
}

/** Outline position of every block on the macro's page, so rows keep the order they were written in. */
export async function fetchOrder(api: LogseqLike, macroUuid: string): Promise<Map<string, number>> {
  let macro: any;
  let page: any;
  let tree: any[] | null;
  try {
    macro = await api.Editor.getBlock(macroUuid);
    page = macro ? await api.Editor.getPage(macro.page.id) : null;
    tree = page ? await api.Editor.getPageBlocksTree(page.originalName ?? page.name) : null;
  } catch (e) {
    throw new Error('Could not read the page around the query.', { cause: e });
  }
  if (!macro || !page) throw new Error(`The query block ${macroUuid} was not found.`);
  const order = new Map<string, number>();
  const walk = (bs: any[] | null | undefined) => {
    for (const b of bs ?? []) {
      if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
      if (typeof b.uuid === 'string') order.set(b.uuid, order.size);
      walk(b.children);
    }
  };
  walk(tree);
  return order;
}
