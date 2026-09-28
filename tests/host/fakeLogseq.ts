import { vi } from 'vitest';
import type { LogseqLike } from '../../src/host/api';

export interface FakeBlock { uuid: string; content: string; children?: FakeBlock[]; preBlock?: boolean; journalDay?: number; refs?: string[] }

/**
 * In-memory Logseq with pages of nested blocks. Results use the camelCase,
 * namespace-free keys the real plugin API returns (`preBlock?`, `pathRefs`, `originalName`).
 */
export function fakeLogseq(pages: Record<string, FakeBlock[]>) {
  type Flat = { b: FakeBlock; id: number; parentId: number; pageId: number };
  const flat: Flat[] = [];
  const pageIds = new Map<string, number>();
  let next = 1000;
  for (const [name, blocks] of Object.entries(pages)) {
    const pid = next++;
    pageIds.set(name, pid);
    const walk = (bs: FakeBlock[], parentId: number) => {
      for (const b of bs) {
        const id = next++;
        flat.push({ b, id, parentId, pageId: pid });
        walk(b.children ?? [], id);
      }
    };
    walk(blocks, pid);
  }
  const byUuid = (u: string) => flat.find((f) => f.b.uuid === u);
  const byId = (i: number) => flat.find((f) => f.id === i);
  const pageName = (pid: number) => [...pageIds].find(([, v]) => v === pid)![0];
  const findPage = (name: string) => [...pageIds].find(([n]) => n.toLowerCase() === name.toLowerCase());
  const entity = (f: Flat, withChildren: boolean): any => ({
    id: f.id, uuid: f.b.uuid, content: f.b.content, page: { id: f.pageId }, parent: { id: f.parentId },
    'preBlock?': !!f.b.preBlock,
    children: withChildren ? flat.filter((c) => c.parentId === f.id).map((c) => entity(c, true)) : [],
  });
  const api = {
    DB: {
      datascriptQuery: vi.fn(async (_q: string) =>
        flat
          .filter((f) => /^\s*[\w.*-]+::\s*\S/m.test(f.b.content))
          .map((f) => [{
            uuid: f.b.uuid, content: f.b.content, 'preBlock?': !!f.b.preBlock,
            page: { name: pageName(f.pageId).toLowerCase(), originalName: pageName(f.pageId), journalDay: f.b.journalDay },
            pathRefs: (f.b.refs ?? []).map((n) => ({ name: n })),
          }])),
    },
    Editor: {
      getBlock: vi.fn(async (id: string | number, opts?: { includeChildren?: boolean }) => {
        const f = typeof id === 'number' ? byId(id) : byUuid(id);
        return f ? entity(f, !!opts?.includeChildren) : null;
      }),
      getPage: vi.fn(async (id: string | number) => {
        const hit = typeof id === 'number' ? [pageName(id), id] as const : findPage(String(id));
        return hit ? { id: hit[1], name: hit[0].toLowerCase(), originalName: hit[0] } : null;
      }),
      getPageBlocksTree: vi.fn(async (name: string) => {
        const pid = findPage(name)?.[1];
        return pid === undefined ? null : flat.filter((f) => f.parentId === pid).map((f) => entity(f, true));
      }),
      updateBlock: vi.fn(async (uuid: string, content: string) => {
        byUuid(uuid)!.b.content = content;
      }),
      upsertBlockProperty: vi.fn(async (_u: string, _k: string, _v: unknown) => {}),
      insertBlock: vi.fn(async (_u: string, _c: string, _o?: unknown) => null),
      appendBlockInPage: vi.fn(async (_p: string, _c: string) => null),
      createPage: vi.fn(async (_n: string, _p?: unknown, _o?: unknown) => null),
      scrollToBlockInPage: vi.fn((_p: string, _u: string) => {}),
    },
  };
  return api satisfies LogseqLike;
}
