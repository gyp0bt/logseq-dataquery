import { readCopies, type Card, type CardNode } from '../core/cards';
import type { LogseqLike } from './api';
import { pick } from './collect';

export type { Card };

/**
 * Blocks whose path refs (their own and their ancestors' tags) hold the page `ref`. Tagging a block
 * tags all its descendants this way, so a card's whole subtree comes back in the same answer.
 */
export const cardsQuery = (ref: string): string => `[:find (pull ?b [:db/id :block/uuid :block/content
  {:block/parent [:block/uuid]} {:block/left [:block/uuid]} {:block/page [:block/name]} {:block/path-refs [:block/name]}])
 :where [?r :block/name ${JSON.stringify(ref)}] [?b :block/path-refs ?r]]`;

const uuidOf = (v: any): string | undefined => {
  const raw = pick(v, 'uuid', 'block/uuid') ?? v;
  if (typeof raw === 'string') return raw;
  return raw != null && typeof raw === 'object' && raw.uuid != null ? String(raw.uuid) : undefined;
};

interface Flat { uuid: string; content: string; parent?: string; left?: string; seq: number; page: string; refs: string[] }

function flat(r: any): Flat | null {
  const uuid = uuidOf(r);
  const content = pick(r, 'content', 'block/content');
  if (!uuid || typeof content !== 'string') return null;
  const refs: any[] = pick(r, 'path-refs', 'pathRefs', 'block/path-refs') ?? [];
  return {
    uuid,
    content,
    parent: uuidOf(pick(r, 'parent', 'block/parent')),
    left: uuidOf(pick(r, 'left', 'block/left')),
    seq: Number(pick(r, 'id', 'db/id') ?? 0),
    page: String(pick(pick(r, 'page', 'block/page') ?? {}, 'name', 'block/name') ?? '').toLowerCase(),
    refs: refs.map((x) => String(pick(x, 'name', 'block/name') ?? '').toLowerCase()),
  };
}

/** Siblings in outline order: follow each one's left sibling from the parent; any not reached go last by id. */
function ordered(parent: string, kids: Flat[]): Flat[] {
  const byLeft = new Map(kids.map((k) => [k.left, k]));
  const out: Flat[] = [];
  const seen = new Set<string>();
  for (let k = byLeft.get(parent); k && !seen.has(k.uuid); k = byLeft.get(k.uuid)) {
    out.push(k);
    seen.add(k.uuid);
  }
  return out.concat(kids.filter((k) => !seen.has(k.uuid)).sort((a, b) => a.seq - b.seq));
}

/** Card trees from the rows of `cardsQuery`, keeping blocks tagged with every ref and leaving out the macro's own subtree. */
export function buildCards(rows: any[], refs: string[], macroUuid: string): Card[] {
  const all = rows.map((r) => flat(Array.isArray(r) ? r[0] : r)).filter((b): b is Flat => b !== null);
  const byUuid = new Map(all.map((b) => [b.uuid, b]));
  const underMacro = (b: Flat): boolean => {
    for (let p: Flat | undefined = b, n = 0; p && n < 1000; p = p.parent ? byUuid.get(p.parent) : undefined, n++)
      if (p.uuid === macroUuid || p.parent === macroUuid) return true;
    return false;
  };
  const kept = all.filter((b) => refs.every((r) => b.refs.includes(r)) && !underMacro(b));
  const keptIds = new Set(kept.map((b) => b.uuid));
  const children = new Map<string, Flat[]>();
  for (const b of kept) if (b.parent && keptIds.has(b.parent)) children.set(b.parent, [...(children.get(b.parent) ?? []), b]);
  const tree = (b: Flat): CardNode => ({ uuid: b.uuid, content: b.content, children: ordered(b.uuid, children.get(b.uuid) ?? []).map(tree) });
  return kept
    .filter((b) => !b.parent || !keptIds.has(b.parent))
    .sort((a, b) => a.seq - b.seq)
    .map((b) => ({ root: tree(b), copies: readCopies(b.content), seq: b.seq, page: b.page }));
}

export async function fetchCards(api: LogseqLike, refs: string[], macroUuid: string): Promise<Card[]> {
  if (!refs.length) throw new Error('DQcards needs a #tag or [[page]] in its query.');
  let res: any;
  try {
    res = await api.DB.datascriptQuery(cardsQuery(refs[0]));
  } catch (e) {
    throw new Error('Could not read the cards from the Logseq database.', { cause: e });
  }
  return buildCards(res ?? [], refs, macroUuid);
}

/** A card tree from `Editor.getBlock(uuid, { includeChildren: true })`. */
export function toCardNode(raw: any): CardNode | null {
  const uuid = uuidOf(raw);
  const content = pick(raw, 'content', 'block/content');
  if (!uuid || typeof content !== 'string') return null;
  const kids: any[] = pick(raw, 'children', 'block/children') ?? [];
  return { uuid, content, children: kids.map(toCardNode).filter((n): n is CardNode => n !== null) };
}
