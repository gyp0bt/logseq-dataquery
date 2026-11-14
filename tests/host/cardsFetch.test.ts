import { describe, expect, it, vi } from 'vitest';
import { buildCards, fetchCards, toCardNode } from '../../src/host/cardsFetch';
import type { LogseqLike } from '../../src/host/api';

let seq = 0;
const raw = (uuid: string, content: string, parent: string, left: string, refs = ['tips']) => ({
  id: ++seq, uuid, content, parent: { uuid: parent }, left: { uuid: left }, page: { name: 'p' }, pathRefs: refs.map((name) => ({ name })),
});
const shape = (n: { uuid: string; children: any[] }): any => ({ [n.uuid]: n.children.map(shape) });

describe('buildCards', () => {
  it('makes one card per topmost block, children in left-chain order', () => {
    const rows = [
      raw('a2', 'a2', 'A', 'a1'),
      raw('A', 'A #tips\ncopies:: 4', 'page', 'page'),
      raw('a1x', 'a1x', 'a1', 'a1'),
      raw('a1', 'a1', 'A', 'A'),
    ];
    const cards = buildCards(rows, ['tips'], 'm');
    expect(cards.map((c) => shape(c.root))).toEqual([{ A: [{ a1: [{ a1x: [] }] }, { a2: [] }] }]);
    expect(cards[0].copies).toBe(4);
    expect(cards[0].page).toBe('p');
  });
  it('makes a tagged child whose parent is not tagged its own card', () => {
    const cards = buildCards([raw('c', 'c #tips', 'untagged', 'untagged')], ['tips'], 'm');
    expect(cards.map((c) => c.root.uuid)).toEqual(['c']);
  });
  it('keeps only blocks tagged with every ref', () => {
    const cards = buildCards([raw('x', 'x', 'p', 'p', ['tips', 'fluent']), raw('y', 'y', 'p', 'x', ['tips'])], ['tips', 'fluent'], 'm');
    expect(cards.map((c) => c.root.uuid)).toEqual(['x']);
  });
  it('leaves out the macro block and its descendants', () => {
    const rows = [
      raw('A', 'A #tips', 'page', 'page'),
      raw('m', '{{renderer :DQcards, #tips}}', 'A', 'A'),
      raw('mc', 'under the macro', 'm', 'm'),
      raw('a', 'a', 'A', 'm'),
    ];
    expect(buildCards(rows, ['tips'], 'm').map((c) => shape(c.root))).toEqual([{ A: [{ a: [] }] }]);
  });
  it('reads a broken count as 0', () => {
    expect(buildCards([raw('A', 'A\ncopies:: abc', 'p', 'p')], ['tips'], 'm')[0].copies).toBe(0);
  });
});

describe('fetchCards', () => {
  const api = (impl: () => Promise<any>) => ({ DB: { datascriptQuery: vi.fn(impl) } }) as unknown as LogseqLike;
  it('needs a tag and does not read the whole graph without one', async () => {
    const a = api(async () => []);
    await expect(fetchCards(a, [], 'm')).rejects.toThrow('DQcards needs a #tag or [[page]]');
    expect(a.DB.datascriptQuery).not.toHaveBeenCalled();
  });
  it('queries by the first ref', async () => {
    const a = api(async () => [[raw('A', 'A', 'p', 'p', ['tips', 'b'])]]);
    expect((await fetchCards(a, ['tips', 'b'], 'm')).length).toBe(1);
    expect(String((a.DB.datascriptQuery as any).mock.calls[0][0])).toContain('"tips"');
  });
  it('wraps a database failure', async () => {
    const boom = new Error('boom');
    const err = await fetchCards(api(async () => { throw boom; }), ['tips'], 'm').catch((e) => e);
    expect(err.message).toBe('Could not read the cards from the Logseq database.');
    expect(err.cause).toBe(boom);
  });
});

describe('toCardNode', () => {
  it('reads a getBlock tree', () => {
    const n = toCardNode({ uuid: { uuid: 'A' }, content: 'A', children: [{ uuid: 'b', content: 'b', children: [{ uuid: 'c', content: 'c' }] }, { uuid: 'd', content: 'd' }] });
    expect(n && shape(n)).toEqual({ A: [{ b: [{ c: [] }] }, { d: [] }] });
    expect(n?.children[0].content).toBe('b');
  });
});
