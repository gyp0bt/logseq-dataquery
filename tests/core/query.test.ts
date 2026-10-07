import { describe, expect, it } from 'vitest';
import { parseQuery, type Kind, type Query } from '../../src/core/dsl';
import { computeTypes, runQuery, type QueryContext } from '../../src/core/query';
import type { SourceBlock } from '../../src/core/rows';
import { emptyOverrides, parseTypeOverrides } from '../../src/core/types';

const b = (uuid: string, content: string, over: Partial<SourceBlock> = {}): SourceBlock => ({
  uuid, content, page: 'day', pageTitle: 'Day', journalDay: 20260928, pathRefs: ['work/nsb'], preBlock: false, seq: 0, ...over,
});
const q = (t: string): Query => {
  const r = parseQuery(t);
  if (!r.ok) throw new Error(r.error.message);
  return r.query;
};

const blocks = [
  b('m', '{{renderer :DQtable}}\nnote:: macro'),
  b('a', 'A\ntype:: run\nrun:: a\npatch:: 8\ngrids:: 1\ncombine:: none\nseed:: 0\ngre:: 1.27', { pathRefs: ['work/nsb', 'seeds'] }),
  b('b', 'B\ntype:: run\nrun:: b\npatch:: 8/16\ngrids:: 2\ncombine:: mean\nseed:: 1\ngre:: 1.49'),
  b('c', 'C\ntype:: run\nrun:: c\npatch:: 8/16\ngrids:: 2\ncombine:: mean\nseed:: 2\ngre:: 0.20', { pathRefs: ['work/nsb', 'seeds'] }),
  b('d', 'D\ntype:: run\nrun:: d\npatch:: 16\ngrids:: 1\ncombine:: none'),
  b('x', 'elsewhere\nk:: v', { page: 'other', pathRefs: [] }),
];
const types = computeTypes(blocks, parseTypeOverrides({ seed: 'category', 'gre*': 'ratio' }));
const ctx: QueryContext = { blocks, types, macroUuid: 'm' };
const run = (t: string, kind: Kind = 'table', c: QueryContext = ctx) => runQuery(q(t), kind, c);
/** Most cases look at the tagged blocks, so they start with `#work/nsb`. */
const ids = (t: string) => run(`#work/nsb ${t}`).rows.map((r) => r.id);

describe('computeTypes', () => {
  it('infers graph-wide and applies overrides', () => {
    expect(types).toMatchObject({ patch: 'numlist', grids: 'number', combine: 'string', seed: 'category', gre: 'ratio' });
    expect(computeTypes(blocks, emptyOverrides()).seed).toBe('number');
  });
});

describe('refs and by', () => {
  it('no refs = the whole graph minus the macro block', () => expect(run('').rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'x']));
  it('every ref must be on the block or an ancestor', () => {
    expect(ids('')).toEqual(['a', 'b', 'c', 'd']);
    expect(ids('#seeds')).toEqual(['a', 'c']);
    expect(run('[[Seeds]]').rows.map((r) => r.id)).toEqual(['a', 'c']);
  });
  it('by:KEY keeps only blocks carrying KEY, one row per value', () => {
    expect(run('by:run').rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(run('by:run').cols).not.toContain('run');
  });
});

describe('row order', () => {
  it('follows the outline, not the database order', () => {
    const shuffled = [blocks[3], blocks[1], blocks[4], blocks[2]];
    const order = new Map(['a', 'b', 'c', 'd'].map((id, i) => [id, i]));
    expect(run('', 'table', { ...ctx, blocks: shuffled, order }).rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('without outline positions: newest journal first, then database id', () => {
    const refs = [
      b('old2', 'k:: 1', { journalDay: 1, seq: 9 }),
      b('new', 'k:: 1', { journalDay: 2, seq: 5 }),
      b('old1', 'k:: 1', { journalDay: 1, seq: 3 }),
    ];
    expect(run('', 'table', { ...ctx, blocks: refs }).rows.map((r) => r.id)).toEqual(['new', 'old1', 'old2']);
  });
});

describe('conditions', () => {
  it('numeric comparison, not string comparison', () => expect(ids('gre<1.3')).toEqual(['a', 'c']));
  it('numeric equality ignores formatting', () => expect(ids('gre=0.2')).toEqual(['c']));
  it('lists mean either; list cells contain (Review Focus 5)', () => {
    expect(ids('combine==mean,gate')).toEqual(['b', 'c']);
    expect(ids('combine!=mean,gate')).toEqual(['a', 'd']);
    expect(ids('patch==16')).toEqual(['b', 'c', 'd']);
    expect(ids('patch==8/16 seed==2')).toEqual(['c']);
  });
  it('a bare key keeps blocks that have it', () => expect(ids('seed')).toEqual(['a', 'b', 'c']));
  it('missing values', () => {
    expect(ids('gre>=0')).toEqual(['a', 'b', 'c']);
    expect(ids('seed!=1')).toEqual(['a', 'c', 'd']);
  });
  it('ordering compares the mean of a multi-valued cell', () => {
    const multi = [b('p', 'g:: 1/3'), b('r', 'g:: 2.5'), b('s', 'g:: 1, 1.2')];
    const t = computeTypes(multi, emptyOverrides());
    expect(run('g<2.2', 'table', { ...ctx, blocks: multi, types: t }).rows.map((r) => r.id)).toEqual(['p', 's']);
    expect(run('sort:g', 'table', { ...ctx, blocks: multi, types: t }).rows.map((r) => r.id)).toEqual(['s', 'p', 'r']);
  });
});

describe('sort', () => {
  it('typed, missing last in both directions', () => {
    expect(ids('sort:gre')).toEqual(['c', 'a', 'b', 'd']);
    expect(ids('sort:-gre')).toEqual(['b', 'a', 'c', 'd']);
  });
});

describe('axes', () => {
  it('scatter defaults to the first two numeric columns', () => {
    expect(run('#work/nsb', 'scatter').axes).toEqual({ x: 'patch', ys: ['grids'] });
  });
  it('bar defaults to the first category/string column and the first numeric one', () => {
    expect(run('#work/nsb', 'bar').axes).toEqual({ x: 'type', ys: ['patch'] });
  });
  it('explicit settings win; the other default avoids the chosen column', () => {
    expect(run('#work/nsb x:gre y:seed color:combine', 'scatter').axes).toEqual({ x: 'gre', ys: ['seed'], color: 'combine' });
    expect(run('#work/nsb y:patch', 'scatter').axes).toEqual({ x: 'grids', ys: ['patch'] });
    expect(run('#work/nsb x:combine y:gre,grids', 'bar').axes).toEqual({ x: 'combine', ys: ['gre', 'grids'] });
  });
});

describe('cols and warnings', () => {
  it('cols in first-appearance order', () => {
    expect(run('#work/nsb').cols).toEqual(['type', 'run', 'patch', 'grids', 'combine', 'seed', 'gre']);
  });
  it('warns about keys no row has', () => {
    expect(run('#work/nsb nope==1 y:zz', 'scatter').warnings).toEqual([
      "No block has 'nope'.",
      "No block has 'zz'.",
    ]);
  });
  it('explains an empty result of the tags', () => {
    expect(run('#nothing').warnings).toEqual(['No blocks with properties are tagged #nothing.']);
  });
});
