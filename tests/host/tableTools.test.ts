// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseQuery } from '../../src/core/dsl';
import { runQuery } from '../../src/core/query';
import type { SourceBlock } from '../../src/core/rows';
import type { ValueType } from '../../src/core/types';
import { renderInline, type ViewData } from '../../src/core/view';
import { Interact } from '../../src/host/interact';
import { IMG_WRITE_DELAY } from '../../src/host/tableTools';

const block = (uuid: string, content: string, journalDay: number | null = null): SourceBlock => ({
  uuid, content, page: 'p', pageTitle: 'P', journalDay, pathRefs: [], preBlock: false, seq: 0,
});
const blocks = [
  block('a', 'A\nrun:: r1\ngre:: 1.2\npic:: ![p](https://e.org/p.png)', 2),
  block('b', 'B\nrun:: r1\nthick:: 3\ngre:: 1.3', 1),
  block('c', 'C\nrun:: r2\ngre:: 2'),
];
const types: Record<string, ValueType> = { run: 'string', gre: 'number', thick: 'number', pic: 'string' };

const mk = () => ({
  submit: vi.fn(async () => {}),
  view: vi.fn<(uuid: string) => ViewData | undefined>(),
  report: vi.fn<(e: unknown) => void>(),
  notify: vi.fn<(msg: string) => void>(),
  leaveEditing: vi.fn(),
  saveCell: vi.fn<(b: string, k: string, v: string) => Promise<void>>(async () => {}),
  addColumn: vi.fn<(m: string, k: string) => void>(),
  setImg: vi.fn<(m: string, px: number) => Promise<void>>(async () => {}),
});
let deps: ReturnType<typeof mk>;
let off: () => void;
let ui: Interact;

function paint(dsl: string) {
  const parsed = parseQuery(dsl);
  if (!parsed.ok) throw new Error('bad test query');
  const result = runQuery(parsed.query, 'table', { blocks, types, macroUuid: 'm' });
  document.body.innerHTML = `<div id="slot">${renderInline({ kind: 'table', macroUuid: 'm', dsl, parsed, result })}</div>`;
  deps.view.mockReturnValue({ kind: 'table', query: parsed.query, result });
  ui.attach('slot');
}
beforeEach(() => {
  deps = mk();
  ui = new Interact(document, deps);
  off = ui.install();
});
afterEach(() => off());

const cell = (row: number, col: string) => document.querySelector<HTMLElement>(`tr[data-row="${row}"] td[data-col="${col}"]`)!;
const dbl = (el: Element) => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
const keyIn = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

describe('double-click a cell to edit it', () => {
  it('opens a field with the raw text; Enter saves to the block that holds the cell', () => {
    paint('');
    dbl(cell(2, 'gre'));
    const input = cell(2, 'gre').querySelector<HTMLInputElement>('input.dq-cellin')!;
    expect(input.value).toBe('2');
    expect(document.activeElement).toBe(input);
    expect(deps.leaveEditing).toHaveBeenCalled();
    input.value = '2.5';
    keyIn(input, 'Enter');
    expect(deps.saveCell).toHaveBeenCalledWith('c', 'gre', '2.5');
    expect(cell(2, 'gre').textContent).toBe('2.5');
  });
  it('Esc puts the cell back without saving; so does leaving the field', () => {
    paint('');
    dbl(cell(0, 'gre'));
    keyIn(cell(0, 'gre').querySelector('input')!, 'Escape');
    expect(cell(0, 'gre').querySelector('input')).toBeNull();
    expect(cell(0, 'gre').textContent).toBe('1.2');
    dbl(cell(0, 'gre'));
    cell(0, 'gre').querySelector<HTMLInputElement>('input')!.blur();
    expect(cell(0, 'gre').textContent).toBe('1.2');
    expect(deps.saveCell).not.toHaveBeenCalled();
  });
  it('a merged row edits only a key one block holds; the by key is read-only', () => {
    paint('by:run');
    dbl(cell(0, 'thick'));
    keyIn(cell(0, 'thick').querySelector('input')!, 'Enter');
    // Unchanged text saves nothing.
    expect(deps.saveCell).not.toHaveBeenCalled();
    dbl(cell(0, 'thick'));
    const input = cell(0, 'thick').querySelector<HTMLInputElement>('input')!;
    input.value = '4';
    keyIn(input, 'Enter');
    expect(deps.saveCell).toHaveBeenCalledWith('b', 'thick', '4');
    dbl(cell(0, 'gre'));
    expect(cell(0, 'gre').querySelector('input')).toBeNull();
    expect(deps.notify).toHaveBeenCalledWith('Cell comes from several blocks; edit the block directly');
    dbl(document.querySelector('tr[data-row="0"] td.dq-link')!);
    expect(document.querySelector('input.dq-cellin')).toBeNull();
  });
  it('a failed save puts the cell back and reports the error', async () => {
    paint('');
    deps.saveCell.mockRejectedValueOnce(new Error('nope'));
    dbl(cell(2, 'gre'));
    const input = cell(2, 'gre').querySelector<HTMLInputElement>('input')!;
    input.value = '9';
    keyIn(input, 'Enter');
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.report).toHaveBeenCalledWith(new Error('nope'));
    expect(cell(2, 'gre').textContent).toBe('2');
  });
});

describe('pressing a table cell while Logseq edits a block', () => {
  it('leaves raw editing at the press, while the block textarea still has the focus', () => {
    paint('');
    const ta = document.createElement('textarea');
    ta.id = 'edit-block-1-x';
    document.body.appendChild(ta);
    ta.focus();
    let activeAtCall: Element | null = null;
    deps.leaveEditing.mockImplementation(() => (activeAtCall = document.activeElement));
    cell(0, 'gre').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(activeAtCall).toBe(ta);
    deps.leaveEditing.mockClear();
    document.querySelector('td.dq-link')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(deps.leaveEditing).not.toHaveBeenCalled();
  });
});

describe('+ adds a column', () => {
  const plus = () => document.querySelector<HTMLElement>('th.dq-addcol')!;
  it('checks the name, then asks the host to show the column', () => {
    paint('');
    plus().click();
    const input = plus().querySelector<HTMLInputElement>('input.dq-keyin')!;
    input.value = 'gre';
    keyIn(input, 'Enter');
    expect(document.querySelector('.dq-msg')!.textContent).toBe("'gre' is already a column.");
    expect(deps.addColumn).not.toHaveBeenCalled();
    input.value = 'note';
    keyIn(input, 'Enter');
    expect(deps.addColumn).toHaveBeenCalledWith('m', 'note');
    expect(plus().textContent).toBe('+');
    expect(document.querySelector('.dq-msg')!.textContent).toBe('');
  });
});

describe('table images', () => {
  it('a click opens the image over the page; a click or Esc closes it', () => {
    paint('');
    const img = document.querySelector<HTMLImageElement>('.dq-tbl img.dq-img')!;
    expect(img.getAttribute('loading')).toBe('lazy');
    img.click();
    const box = document.querySelector<HTMLElement>('body > .dq-lightbox')!;
    expect(box.querySelector('img')!.getAttribute('src')).toBe('https://e.org/p.png');
    box.click();
    expect(document.querySelector('.dq-lightbox')).toBeNull();
    img.click();
    keyIn(document.body, 'Escape');
    expect(document.querySelector('.dq-lightbox')).toBeNull();
  });
  it('Ctrl+wheel resizes every image at once and writes img: once it stops', () => {
    vi.useFakeTimers();
    try {
      paint('');
      const img = document.querySelector<HTMLImageElement>('.dq-tbl img.dq-img')!;
      const tbl = document.querySelector<HTMLElement>('.dq-tbl')!;
      const wheel = (dy: number) => img.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true }));
      wheel(-1);
      wheel(-1);
      expect(tbl.style.getPropertyValue('--dq-img')).toBe('77px');
      vi.advanceTimersByTime(IMG_WRITE_DELAY - 1);
      expect(deps.setImg).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(deps.setImg).toHaveBeenCalledTimes(1);
      expect(deps.setImg).toHaveBeenCalledWith('m', 77);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Cols ▾', () => {
  it('stays open across a repaint', () => {
    paint('');
    document.querySelector<HTMLElement>('.dq-cols > summary')!.click();
    expect(document.querySelector<HTMLDetailsElement>('.dq-cols')!.open).toBe(true);
    paint('hide:gre');
    expect(document.querySelector<HTMLDetailsElement>('.dq-cols')!.open).toBe(true);
    expect(document.querySelector('td[data-col="gre"]')).toBeNull();
  });
});
