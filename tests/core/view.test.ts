import { describe, expect, it } from 'vitest';
import { parseQuery, type Kind } from '../../src/core/dsl';
import { runQuery, type QueryResult } from '../../src/core/query';
import type { Row, SourceBlock } from '../../src/core/rows';
import type { ValueType } from '../../src/core/types';
import { cellClass, renderInline, renderLegacy, toCsv } from '../../src/core/view';

const row = (id: string, values: Record<string, string>, conflicts: Row['conflicts'] = {}): Row => ({
  id, title: id, values, sources: [{ uuid: id, pageTitle: 'P', journalDay: null }], conflicts,
});
const TYPES: Record<string, ValueType> = { gre: 'ratio', thick: 'number', note: 'string', run: 'string', seed: 'category' };
const result = (rows: Row[], cols: string[], warnings: string[] = [], axes: QueryResult['axes'] = { ys: [] }): QueryResult => ({
  rows, cols, types: TYPES, axes, warnings,
});
const view = (kind: Kind, dsl: string, res?: QueryResult) => renderInline({ kind, macroUuid: 'm', dsl, parsed: parseQuery(dsl), result: res });

/** A real result from blocks, so axes come from the engine. */
const blocks: SourceBlock[] = [
  { uuid: 'a', content: 'A\nrun:: r1\ngre:: 0.96\nthick:: 2\nseed:: 0', page: 'p', pageTitle: 'P', journalDay: null, pathRefs: [], preBlock: false, seq: 1 },
  { uuid: 'b', content: 'B\nrun:: r2\ngre:: 1.27\nthick:: 3\nseed:: 1', page: 'p', pageTitle: 'P', journalDay: null, pathRefs: [], preBlock: false, seq: 2 },
];
const real = (kind: Kind, dsl: string) => {
  const p = parseQuery(dsl);
  if (!p.ok) throw new Error(p.error.message);
  return view(kind, dsl, runQuery(p.query, kind, { blocks, types: TYPES, macroUuid: 'm' }));
};

describe('renderInline', () => {
  it('shows the query error with a caret under the column', () => {
    const html = view('table', 'gre<');
    // The field stays editable above the message instead of being replaced by it.
    expect(html).toContain('class="dq-dsl dq-bad"');
    expect(html).toContain('<div class="dq-msg"><pre>gre&lt;\n    ^</pre>');
    expect(html).toContain('Missing value after');
    expect(html).toContain('data-on-click="dqEdit" data-macro="m"');
  });

  it('shows a runtime failure message', () => {
    const html = renderInline({ kind: 'table', macroUuid: 'm', dsl: '', parsed: parseQuery(''), error: 'Could not read blocks (cause: boom)' });
    expect(html).toContain('Data query failed: Could not read blocks (cause: boom)');
  });

  it('renders head, table, conflict marks and a CSV button for tables', () => {
    const rows = [
      row('a', { run: 'r1', gre: '0.96' }),
      row('b', { run: 'r2', gre: '1.27' }, { gre: [{ value: '1.27', pageTitle: 'Sep 28th' }, { value: '1.72', pageTitle: 'Sep 27th' }] }),
    ];
    const html = view('table', 'by:run sort:gre', result(rows, ['gre']));
    expect(html).not.toContain('Open ↗');
    expect(html).toContain('value="by:run sort:gre" placeholder=');
    expect(html).toContain('<div class="dq-tbl" data-on-click="dqNoop">');
    expect(html).toContain('<tr data-uuid="b">');
    expect(html).toContain('2 rows');
    expect(html).toContain('⚠ 1');
    expect(html).toContain('data-on-click="dqJump" data-uuid="b"');
    expect(html).toContain('dq-num dq-pass');
    expect(html).toContain('title="1.27 (Sep 28th) / 1.72 (Sep 27th)"');
    expect(html).toContain('<div class="dq-side" data-on-click="dqNoop" data-macro="m">');
    expect(html).toContain('data-act="csv"');
    expect(html).not.toContain('data-act="expand"');
    expect(html).not.toContain('<select');
  });

  it('table headers cycle sort: none → key → -key → none', () => {
    const rows = [row('a', { gre: '1', note: 'x' })];
    const head = (dsl: string, k: string) => new RegExp(`<th class="[^"]*" data-on-click="dqSet" data-macro="m" data-name="sort" data-value="([^"]*)">${k}( [▲▼])?<`).exec(view('table', dsl, result(rows, ['gre', 'note'])));
    expect(head('', 'gre')![1]).toBe('gre');
    expect(head('sort:gre', 'gre')!.slice(1)).toEqual(['-gre', ' ▲']);
    expect(head('sort:-gre', 'gre')!.slice(1)).toEqual(['', ' ▼']);
    expect(head('sort:-gre', 'note')!.slice(1)).toEqual(['note', undefined]);
  });

  it('scatter side: X, Y and colour selects, ± and ▤ toggles, reset, enlarge, CSV', () => {
    const html = real('scatter', '');
    const sel = (name: string) => new RegExp(`<select class="dq-sel" data-on-change="dqSet" data-macro="m" data-name="${name}"[^>]*>(.*?)</select>`).exec(html)![1];
    expect(sel('x')).toBe('<option value="gre" selected>gre</option><option value="thick">thick</option>');
    expect(sel('y')).toBe('<option value="gre">gre</option><option value="thick" selected>thick</option>');
    expect(sel('color')).toContain('<option value="" selected>none</option>');
    expect(sel('color')).toContain('<option value="seed">seed</option>');
    expect(real('scatter', 'color:seed')).toContain('<option value="seed" selected>seed</option>');
    // The next value is worked out from the macro text when clicked, not baked in here.
    const pressed = (dsl: string, t: string) => new RegExp(`data-name="err" data-toggle="${t}" aria-pressed="(true|false)"`).exec(real('scatter', dsl))![1];
    expect([pressed('', 'bar'), pressed('', 'band')]).toEqual(['true', 'false']);
    expect([pressed('err:band', 'bar'), pressed('err:band', 'band')]).toEqual(['false', 'true']);
    expect([pressed('err:off', 'bar'), pressed('err:off', 'band')]).toEqual(['false', 'false']);
    expect(html).not.toContain('data-name="err" data-value');
    for (const a of ['reset', 'expand', 'csv']) expect(html).toContain(`data-act="${a}"`);
    expect(html).toContain('<div class="dq-chartbox" data-on-click="dqNoop" data-macro="m">');
    expect(html).not.toContain('dq-modebar');
  });

  it('draws the first paint at the size it is given', () => {
    const p = parseQuery('');
    if (!p.ok) throw new Error('bad');
    const res = runQuery(p.query, 'scatter', { blocks, types: TYPES, macroUuid: 'm' });
    const html = renderInline({ kind: 'scatter', macroUuid: 'm', dsl: '', parsed: p, result: res, chartOpts: { size: { w: 700, h: 360 } } });
    expect(html).toContain('width="700" height="360"');
  });

  it('bar side: X from every column, Y from numeric ones, enlarge, CSV', () => {
    const html = real('bar', '');
    const sel = (name: string) => new RegExp(`data-name="${name}"[^>]*>(.*?)</select>`).exec(html)![1];
    expect(sel('x')).toBe('<option value="run" selected>run</option><option value="gre">gre</option><option value="thick">thick</option><option value="seed">seed</option>');
    expect(sel('y')).toBe('<option value="gre" selected>gre</option><option value="thick">thick</option>');
    expect(html).toContain('data-act="expand"');
    expect(html).toContain('data-act="csv"');
    expect(html).not.toContain('data-act="reset"');
    expect(html).not.toContain('data-name="err"');
    expect(real('bar', 'y:gre,thick')).toContain('<option value="gre,thick" selected>gre, thick</option>');
  });

  it('escapes property values everywhere', () => {
    const evil = '<img src=x onerror=alert(1)>"&';
    const rows = [row('a', { gre: '1', note: evil }, { note: [{ value: evil, pageTitle: evil }, { value: 'b', pageTitle: 'P' }] })];
    const html = view('scatter', 'x:gre y:gre color:note', result(rows, ['gre', 'note'], [evil], { x: 'gre', ys: ['gre'], color: 'note' }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;&amp;');
  });

  it('says so when nothing matches', () => expect(view('table', '', result([], []))).toContain('No rows match.'));

  it('legacy macros get a one-line note', () => {
    expect(renderLegacy()).toContain('Data query now uses DQtable, DQscatter and DQbar. Replace this macro, e.g. {{renderer :DQtable, #tag}}.');
  });
});

describe('toCsv', () => {
  it('writes the visible rows and columns with RFC 4180 quoting', () => {
    const rows = [row('a', { gre: '1.2', note: 'say "hi", ok' }), row('b', { note: 'two\nlines' })];
    expect(toCsv(result(rows, ['gre', 'note']))).toBe('block,gre,note\r\na,1.2,"say ""hi"", ok"\r\nb,,"two\nlines"');
    expect(toCsv(result([row('a', { run: 'r1', gre: '1' })], ['gre']), 'run')).toBe('run,gre\r\nr1,1');
  });
});

describe('cellClass', () => {
  it('ratio below 1 passes, 1 or above fails, others unstyled', () => {
    expect(cellClass('ratio', '0.99')).toBe('dq-pass');
    expect(cellClass('ratio', '1.00')).toBe('dq-fail');
    expect(cellClass('ratio', 'x')).toBe('');
    expect(cellClass('number', '0.5')).toBe('');
  });
});
