import { describe, expect, it } from 'vitest';
import { parseDsl } from '../../src/core/dsl';
import type { QueryResult } from '../../src/core/query';
import type { Row } from '../../src/core/rows';
import { cellClass, renderInline } from '../../src/core/view';

const row = (id: string, values: Record<string, string>, conflicts: Row['conflicts'] = {}): Row => ({
  id, title: id, values, sources: [{ uuid: id, pageTitle: 'P', journalDay: null }], conflicts,
});
const result = (rows: Row[], cols: string[], warnings: string[] = []): QueryResult => ({
  scoped: rows, rows, cols, types: { gre: 'ratio', note: 'string', run: 'string' }, warnings,
});

describe('renderInline', () => {
  it('shows the DSL error with a caret under the column', () => {
    const dsl = 'where gre <';
    const html = renderInline({ macroUuid: 'm', dsl, parsed: parseDsl(dsl) });
    expect(html).toContain('class="dq dq-error"');
    expect(html).toContain('where gre &lt;\n           ^');
    expect(html).toContain('Missing value after');
  });

  it('shows a runtime failure message', () => {
    const html = renderInline({ macroUuid: 'm', dsl: '', parsed: parseDsl(''), error: 'Could not read blocks (cause: boom)' });
    expect(html).toContain('Data query failed: Could not read blocks (cause: boom)');
  });

  it('renders header, table and conflict notes', () => {
    const dsl = 'merge by run | sort gre';
    const rows = [
      row('a', { run: 'r1', gre: '0.96' }),
      row('b', { run: 'r2', gre: '1.27' }, { gre: [{ value: '1.27', pageTitle: 'Sep 28th' }, { value: '1.72', pageTitle: 'Sep 27th' }] }),
    ];
    const html = renderInline({ macroUuid: 'm', dsl, parsed: parseDsl(dsl), result: result(rows, ['gre']) });
    expect(html).toContain('data-on-click="dqOpen" data-macro="m"');
    expect(html).toContain('2 rows');
    expect(html).toContain('⚠ 1');
    expect(html).toContain('<th>run</th>');
    expect(html).toContain('data-on-click="dqJump" data-uuid="b"');
    expect(html).toContain('class="dq-num dq-pass"');
    expect(html).toContain('r2: gre is 1.27 (Sep 28th) / 1.72 (Sep 27th). Showing the first.');
    expect(html).not.toContain('dqToggleLabels');
  });

  it('offers the labels toggle only for scatter plots', () => {
    const dsl = 'plot scatter x=gre y=gre labels=off';
    const html = renderInline({ macroUuid: 'm', dsl, parsed: parseDsl(dsl), result: result([row('a', { gre: '1' })], ['gre']) });
    expect(html).toContain('data-on-click="dqToggleLabels" data-macro="m">Show labels</button>');
  });

  it('escapes property values everywhere (Review Focus 4)', () => {
    const evil = '<img src=x onerror=alert(1)>"&';
    const dsl = 'plot scatter x=gre y=gre color=note';
    const rows = [row('a', { gre: '1', note: evil }, { note: [{ value: evil, pageTitle: evil }, { value: 'b', pageTitle: 'P' }] })];
    const html = renderInline({ macroUuid: 'm', dsl, parsed: parseDsl(dsl), result: result(rows, ['note'], [evil]) });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;&amp;');
  });

  it('says so when nothing matches', () => {
    const html = renderInline({ macroUuid: 'm', dsl: '', parsed: parseDsl(''), result: result([], []) });
    expect(html).toContain('No rows match.');
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
