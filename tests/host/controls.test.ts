// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseQuery } from '../../src/core/dsl';
import { runQuery } from '../../src/core/query';
import type { SourceBlock } from '../../src/core/rows';
import type { ValueType } from '../../src/core/types';
import { renderInline } from '../../src/core/view';
import { applyControl, readMacro } from '../../src/host/actions';
import { fakeLogseq } from './fakeLogseq';

const block = (uuid: string, content: string): SourceBlock => ({
  uuid, content, page: 'p', pageTitle: 'P', journalDay: null, pathRefs: [], preBlock: false, seq: 0,
});
const blocks = [block('a', 'A\nrun:: r1\ngre:: 1\nthick:: 2\nwide:: 3'), block('b', 'B\nrun:: r2\ngre:: 2\nthick:: 3\nwide:: 4')];
const types: Record<string, ValueType> = { run: 'string', gre: 'number', thick: 'number', wide: 'number' };

/** Paint the bar view of `dsl`, as Logseq would, and keep the macro in a fake graph. */
function setup(dsl: string) {
  const api = fakeLogseq({ P: [{ uuid: 'm', content: `{{renderer :DQbar, ${dsl}}}` }] });
  const parsed = parseQuery(dsl);
  if (!parsed.ok) throw new Error('bad test query');
  const result = runQuery(parsed.query, 'bar', { blocks, types, macroUuid: 'm' });
  document.body.innerHTML = renderInline({ kind: 'bar', macroUuid: 'm', dsl, parsed, result });
  return api;
}
const dataset = (el: HTMLElement) => ({ ...el.dataset });
const chipX = (col: string) => document.querySelector<HTMLElement>(`.dq-side button[data-op="remove"][data-col="${col}"]`)!;
const addSel = () => document.querySelector<HTMLSelectElement>('.dq-side select[data-op="add"]')!;

describe('bar Y chips and + Y', () => {
  it('shows one chip per y column and offers only the numeric columns not shown', () => {
    setup('x:run y:gre,thick');
    expect([...document.querySelectorAll('.dq-chip')].map((c) => c.firstChild!.textContent)).toEqual(['gre', 'thick']);
    expect([...addSel().options].map((o) => o.value)).toEqual(['', 'wide']);
  });
  it('the × of a chip removes that column, read from the macro text when clicked', async () => {
    const api = setup('x:run y:gre,thick,wide');
    const ds = dataset(chipX('thick'));
    // The macro changed after the view was drawn: the click must work on the text as it is now.
    await api.Editor.updateBlock('m', '{{renderer :DQbar, x:run y:gre,thick,wide sort:gre}}');
    await applyControl(api, { dataset: ds });
    expect((await readMacro(api, 'm')).dsl).toBe('x:run y:gre,wide sort:gre');
  });
  it('removing the last chip removes y: and falls back to the default', async () => {
    const api = setup('x:run y:thick');
    await applyControl(api, { dataset: dataset(chipX('thick')) });
    expect((await readMacro(api, 'm')).dsl).toBe('x:run');
  });
  it('+ Y appends the chosen column; without y: it keeps the default column first', async () => {
    let api = setup('x:run y:gre');
    await applyControl(api, { value: 'wide', dataset: dataset(addSel()) });
    expect((await readMacro(api, 'm')).dsl).toBe('x:run y:gre,wide');
    api = setup('x:run');
    expect(document.querySelectorAll('.dq-chip')).toHaveLength(1);
    await applyControl(api, { value: 'wide', dataset: dataset(addSel()) });
    expect((await readMacro(api, 'm')).dsl).toBe('x:run y:gre,wide');
  });
  it('an unknown control is an error, not a silent no-op', async () => {
    const api = setup('x:run');
    await expect(applyControl(api, { dataset: { macro: 'm', name: 'y', op: 'swap', col: 'gre' } })).rejects.toThrow("unexpected control 'y:swap'");
  });
});
