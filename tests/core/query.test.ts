import { describe, expect, it } from 'vitest';
import { parseDsl, type Query } from '../../src/core/dsl';
import { computeTypes, runQuery, type QueryContext } from '../../src/core/query';
import type { SourceBlock } from '../../src/core/rows';
import { emptyOverrides, parseTypeOverrides } from '../../src/core/types';

const b = (uuid: string, content: string, over: Partial<SourceBlock> = {}): SourceBlock => ({
  uuid, content, page: 'day', pageTitle: 'Day', journalDay: 20260928, pathRefs: ['work/nsb'], preBlock: false, seq: 0, ...over,
});
const q = (t: string): Query => {
  const r = parseDsl(t);
  if (!r.ok) throw new Error(r.error.message);
  return r.query;
};

const blocks = [
  b('m', '{{renderer :dataquery}}\nnote:: macro'),
  b('a', 'A\ntype:: run\nrun:: a\npatch:: 8\ngrids:: 1\ncombine:: none\nseed:: 0\ngre:: 1.27'),
  b('b', 'B\ntype:: run\nrun:: b\npatch:: 8/16\ngrids:: 2\ncombine:: mean\nseed:: 1\ngre:: 1.49'),
  b('c', 'C\ntype:: run\nrun:: c\npatch:: 8/16\ngrids:: 2\ncombine:: mean\nseed:: 2\ngre:: 0.20'),
  b('d', 'D\ntype:: run\nrun:: d\npatch:: 16\ngrids:: 1\ncombine:: none'),
  b('x', 'elsewhere\nk:: v', { page: 'other', pathRefs: [] }),
];
const types = computeTypes(blocks, parseTypeOverrides({ seed: 'category', 'gre*': 'ratio' }));
const ctx: QueryContext = { blocks, types, macroUuid: 'm', macroPage: 'day', hereIds: new Set(['m', 'a', 'b', 'c', 'd']) };
const ids = (t: string) => runQuery(q(t), ctx).rows.map((r) => r.id);

describe('computeTypes', () => {
  it('infers graph-wide and applies overrides', () => {
    expect(types).toMatchObject({ patch: 'numlist', grids: 'number', combine: 'string', seed: 'category', gre: 'ratio' });
    expect(computeTypes(blocks, emptyOverrides()).seed).toBe('number');
  });
});

describe('scope', () => {
  it('here excludes the macro block and outside blocks', () => expect(ids('')).toEqual(['a', 'b', 'c', 'd']));
  it('page', () => expect(ids('in page')).toEqual(['a', 'b', 'c', 'd']));
  it('ref uses path refs, case-insensitively', () => expect(ids('in [[Work/NSB]]')).toEqual(['a', 'b', 'c', 'd']));
});

describe('row order', () => {
  it('follows the outline, not the database order', () => {
    const shuffled = [blocks[3], blocks[1], blocks[4], blocks[2]];
    const order = new Map(['a', 'b', 'c', 'd'].map((id, i) => [id, i]));
    expect(runQuery(q(''), { ...ctx, blocks: shuffled, order }).rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('without outline positions: newest journal first, then database id', () => {
    const refs = [
      b('old2', 'k:: 1', { journalDay: 1, seq: 9 }),
      b('new', 'k:: 1', { journalDay: 2, seq: 5 }),
      b('old1', 'k:: 1', { journalDay: 1, seq: 3 }),
    ];
    expect(runQuery(q('in [[work/nsb]]'), { ...ctx, blocks: refs }).rows.map((r) => r.id)).toEqual(['new', 'old1', 'old2']);
  });
});

describe('where', () => {
  it('numeric comparison, not string comparison', () => expect(ids('where gre < 1.3')).toEqual(['a', 'c']));
  it('numeric equality ignores formatting (Review Focus 2)', () => expect(ids('where gre = 0.2')).toEqual(['c']));
  it('in, has, and', () => {
    expect(ids('where combine in (mean, gate)')).toEqual(['b', 'c']);
    expect(ids('where patch has 16')).toEqual(['b', 'c', 'd']);
    expect(ids('where patch = 8/16 and seed = 2')).toEqual(['c']);
  });
  it('missing values (Review Focus 3)', () => {
    expect(ids('where gre >= 0')).toEqual(['a', 'b', 'c']);
    expect(ids('where seed != 1')).toEqual(['a', 'c', 'd']);
  });
});

describe('sort', () => {
  it('typed, missing last in both directions (Review Focus 3)', () => {
    expect(ids('sort gre')).toEqual(['c', 'a', 'b', 'd']);
    expect(ids('sort gre desc')).toEqual(['b', 'a', 'c', 'd']);
    expect(ids('sort patch, seed desc')).toEqual(['a', 'c', 'b', 'd']);
  });
});

describe('cols and warnings', () => {
  it('default cols in first-appearance order', () => {
    expect(runQuery(q(''), ctx).cols).toEqual(['type', 'run', 'patch', 'grids', 'combine', 'seed', 'gre']);
  });
  it('merge key is left out of cols; patterns expand', () => {
    expect(runQuery(q('merge by run'), ctx).cols).toEqual(['type', 'patch', 'grids', 'combine', 'seed', 'gre']);
    expect(runQuery(q('cols g*, run'), ctx).cols).toEqual(['grids', 'gre', 'run']);
  });
  it('warns about keys absent from the scope', () => {
    expect(runQuery(q('where nope = 1 | plot scatter x=gre y=zz'), ctx).warnings).toEqual([
      "No block in this scope has 'nope'.",
      "No block in this scope has 'zz'.",
    ]);
  });
  it('explains an empty scope', () => {
    const empty = { ...ctx, hereIds: new Set<string>() };
    expect(runQuery(q(''), empty).warnings).toEqual(['No blocks with properties in this scope.']);
  });
  it('scoped keeps pre-filter rows', () => {
    const r = runQuery(q('where gre < 1'), ctx);
    expect(r.rows.map((x) => x.id)).toEqual(['c']);
    expect(r.scoped.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
