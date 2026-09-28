import { describe, expect, it } from 'vitest';
import { blockToRow, mergeRows, rowLabel, type Row, type SourceBlock } from '../../src/core/rows';

const block = (uuid: string, content: string, over: Partial<SourceBlock> = {}): SourceBlock => ({
  uuid, content, page: 'p', pageTitle: 'P', journalDay: null, pathRefs: [], preBlock: false, seq: 0, ...over,
});
const row = (b: SourceBlock) => blockToRow(b) as Row;

describe('blockToRow', () => {
  it('needs at least one user property and skips pre-blocks', () => {
    expect(blockToRow(block('a', 'just text'))).toBeNull();
    expect(blockToRow(block('a', 'id:: 1\ncollapsed:: true'))).toBeNull();
    expect(blockToRow(block('a', 'k:: v', { preBlock: true }))).toBeNull();
    expect(row(block('a', 'T\nk:: v'))).toEqual({
      id: 'a', title: 'T', values: { k: 'v' },
      sources: [{ uuid: 'a', pageTitle: 'P', journalDay: null }], conflicts: {},
    });
  });
});

describe('mergeRows', () => {
  const older = row(block('old', 'run:: r1\ngre:: 1.72\nseed:: 0', { pageTitle: 'Sep 27th, 2026', journalDay: 20260927 }));
  const newer = row(block('new', 'run:: r1\ngre:: 1.27\nseed:: 0.0\nextra:: x', { pageTitle: 'Sep 28th, 2026', journalDay: 20260928 }));
  const page = row(block('pg', 'run:: r1\ngre:: 1.27', { pageTitle: 'Notes' }));
  const other = row(block('o', 'run:: r2\ngre:: 2'));
  const loose = row(block('l', 'gre:: 3'));

  it('keeps order of first appearance and leaves rows without the key alone', () => {
    const out = mergeRows([older, loose, other, newer], 'run');
    expect(out.map((r) => r.id)).toEqual(['new', 'l', 'o']);
  });
  it('newest journal wins, then non-journal pages; conflicts list every source', () => {
    const [m] = mergeRows([page, older, newer], 'run');
    expect(m.values).toEqual({ run: 'r1', gre: '1.27', seed: '0.0', extra: 'x' });
    expect(m.sources.map((s) => s.uuid)).toEqual(['new', 'old', 'pg']);
    expect(m.conflicts).toEqual({
      gre: [
        { value: '1.27', pageTitle: 'Sep 28th, 2026' },
        { value: '1.72', pageTitle: 'Sep 27th, 2026' },
        { value: '1.27', pageTitle: 'Notes' },
      ],
    });
  });
  it('numerically equal texts are not conflicts (Review Focus 2)', () => {
    const [m] = mergeRows([older, newer], 'run');
    expect(m.conflicts.seed).toBeUndefined();
  });
});

describe('merge key normalisation (Review Focus 2)', () => {
  it('0.2 and 0.20 are one group; 8/16 and 8/16.0 do not conflict', () => {
    const out = mergeRows([row(block('x', 'k:: 0.2\np:: 8/16')), row(block('y', 'k:: 0.20\np:: 8/16.0'))], 'k');
    expect(out).toHaveLength(1);
    expect(out[0].conflicts).toEqual({});
  });
});

describe('rowLabel', () => {
  it('merge key, then title, then short id', () => {
    expect(rowLabel(row(block('abcdef123456', 'T\nrun:: r1')), 'run')).toBe('r1');
    expect(rowLabel(row(block('abcdef123456', 'T\nk:: v')))).toBe('T');
    expect(rowLabel(row(block('abcdef123456', 'k:: v')))).toBe('abcdef12');
  });
});
