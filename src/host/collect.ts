import type { SourceBlock } from '../core/rows';
import { parseContent } from '../core/text';
import { emptyOverrides, parseTypeOverrides, type TypeOverrides } from '../core/types';
import type { LogseqLike } from './api';

export const BLOCKS_QUERY = `[:find (pull ?b [:block/uuid :block/content :block/pre-block?
  {:block/page [:block/name :block/original-name :block/journal-day]}
  {:block/path-refs [:block/name]}])
 :where [?b :block/properties ?p] [(not= ?p {})]]`;

/** Logseq may return namespaced, kebab or camel keys depending on the call path. */
function pick(o: any, ...names: string[]): any {
  for (const n of names) if (o && o[n] !== undefined && o[n] !== null) return o[n];
  return undefined;
}

export function toSourceBlock(raw: any): SourceBlock | null {
  const uuid = pick(raw, 'uuid', 'block/uuid');
  const content = pick(raw, 'content', 'block/content');
  if (typeof uuid !== 'string' || typeof content !== 'string') return null;
  const page = pick(raw, 'page', 'block/page') ?? {};
  const name = String(pick(page, 'name', 'block/name') ?? '');
  const refs: any[] = pick(raw, 'path-refs', 'pathRefs', 'block/path-refs') ?? [];
  return {
    uuid,
    content,
    page: name.toLowerCase(),
    pageTitle: String(pick(page, 'original-name', 'originalName', 'block/original-name') ?? name),
    journalDay: pick(page, 'journal-day', 'journalDay', 'block/journal-day') ?? null,
    pathRefs: refs.map((r) => String(pick(r, 'name', 'block/name') ?? '').toLowerCase()).filter(Boolean),
    preBlock: !!pick(raw, 'pre-block?', 'preBlock?', 'preBlock', 'block/pre-block?'),
  };
}

export async function fetchBlocks(api: LogseqLike): Promise<SourceBlock[]> {
  let res: any;
  try {
    res = await api.DB.datascriptQuery(BLOCKS_QUERY);
  } catch (e) {
    throw new Error('Could not read blocks from the Logseq database.', { cause: e });
  }
  return (res ?? [])
    .map((r: any) => toSourceBlock(Array.isArray(r) ? r[0] : r))
    .filter((b: SourceBlock | null): b is SourceBlock => b !== null);
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

/** The macro's page and the uuids under its parent block (or the whole page at top level). */
export async function fetchScope(api: LogseqLike, macroUuid: string): Promise<{ macroPage: string; hereIds: Set<string> }> {
  let macro: any;
  let page: any;
  try {
    macro = await api.Editor.getBlock(macroUuid);
    page = macro ? await api.Editor.getPage(macro.page.id) : null;
  } catch (e) {
    throw new Error('Could not read the query block.', { cause: e });
  }
  if (!macro || !page) throw new Error(`The query block ${macroUuid} was not found.`);
  const hereIds = new Set<string>();
  const walk = (bs: any[] | null | undefined) => {
    for (const b of bs ?? []) {
      if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
      if (typeof b.uuid === 'string') hereIds.add(b.uuid);
      walk(b.children);
    }
  };
  try {
    if (macro.parent.id === macro.page.id) walk(await api.Editor.getPageBlocksTree(page.originalName ?? page.name));
    else walk((await api.Editor.getBlock(macro.parent.id, { includeChildren: true }))?.children);
  } catch (e) {
    throw new Error('Could not read the blocks around the query.', { cause: e });
  }
  return { macroPage: String(page.name ?? '').toLowerCase(), hereIds };
}
