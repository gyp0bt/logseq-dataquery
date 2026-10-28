// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseQuery } from '../../src/core/dsl';
import { runQuery } from '../../src/core/query';
import type { SourceBlock } from '../../src/core/rows';
import type { ValueType } from '../../src/core/types';
import { renderInline, type ViewData } from '../../src/core/view';
import { Interact } from '../../src/host/interact';

const block = (uuid: string, content: string): SourceBlock => ({
  uuid, content, page: 'p', pageTitle: 'P', journalDay: null, pathRefs: [], preBlock: false, seq: 0,
});
const blocks = [
  block('a', 'A\nx:: 1\ny:: 10\nz:: =x+y'),
  block('b', 'B\nx:: 2\ny:: 20\nz:: =x*y'),
  block('c', 'C\nx:: 3\ny:: 30'),
];
const types: Record<string, ValueType> = { x: 'number', y: 'number', z: 'number' };

const mk = () => ({
  submit: vi.fn(async () => {}),
  view: vi.fn<(uuid: string) => ViewData | undefined>(),
  report: vi.fn<(e: unknown) => void>(),
  notify: vi.fn<(msg: string) => void>(),
  leaveEditing: vi.fn(),
  saveCell: vi.fn<(b: string, k: string, v: string) => Promise<void>>(async () => {}),
  addColumn: vi.fn(),
  addRow: vi.fn<(m: string) => Promise<string | undefined>>(async () => 'new'),
  jump: vi.fn<(u: string) => Promise<void>>(async () => {}),
  saveTitle: vi.fn<(b: string, t: string) => Promise<void>>(async () => {}),
  deleteRow: vi.fn<(m: string, i: number) => Promise<void>>(async () => {}),
  setImg: vi.fn(async () => {}),
});
let deps: ReturnType<typeof mk>;
let off: () => void;
let ui: Interact;

function paint(dsl = '') {
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
  paint();
});
afterEach(() => {
  off();
  vi.useRealTimers();
});

const tbl = () => document.querySelector<HTMLElement>('.dq-tbl')!;
const cell = (row: number, col: string) => document.querySelector<HTMLElement>(`tr[data-row="${row}"] td[data-col="${col}"]`)!;
const press = (el: Element, type: string, init: MouseEventInit = {}) =>
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' ? 0 : 1, ...init }));
const click = (el: Element, init: MouseEventInit = {}) => {
  press(el, 'mousedown', init);
  press(el, 'mouseup', init);
};
const keyOn = (el: Element, k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
};
const cur = () => document.querySelector('td.dq-cur') as HTMLElement | null;
const at = (el: HTMLElement | null) => (el ? `${el.closest('tr')!.dataset.row}:${el.dataset.col}` : null);

describe('selecting cells', () => {
  it('a press marks the cell and gives the table the keyboard', () => {
    click(cell(1, 'y'));
    expect(at(cur())).toBe('1:y');
    expect(document.activeElement).toBe(tbl());
  });

  it('arrows move, and stop at the edges', () => {
    click(cell(0, 'x'));
    keyOn(tbl(), 'ArrowRight');
    keyOn(tbl(), 'ArrowDown');
    expect(at(cur())).toBe('1:y');
    keyOn(tbl(), 'ArrowUp');
    keyOn(tbl(), 'ArrowUp');
    keyOn(tbl(), 'ArrowLeft');
    keyOn(tbl(), 'ArrowLeft');
    expect(at(cur())).toBe('0:x');
  });

  it('shift+arrow and dragging select a range', () => {
    click(cell(0, 'x'));
    keyOn(tbl(), 'ArrowDown', { shiftKey: true });
    keyOn(tbl(), 'ArrowRight', { shiftKey: true });
    expect(document.querySelectorAll('td.dq-sel').length).toBe(3);
    expect(at(cur())).toBe('1:y');
    click(cell(2, 'z'));
    press(cell(0, 'y'), 'mousedown');
    press(cell(1, 'z'), 'mousemove');
    expect(document.querySelectorAll('td.dq-sel').length).toBe(3);
    press(cell(1, 'z'), 'mouseup');
    press(cell(2, 'z'), 'mousemove');
    expect(at(cur())).toBe('1:z');
  });

  it('keys are not passed on to Logseq while the table has the focus', () => {
    click(cell(0, 'x'));
    const seen = vi.fn();
    document.body.addEventListener('keydown', seen);
    keyOn(tbl(), 'ArrowDown');
    document.body.removeEventListener('keydown', seen);
    expect(seen).not.toHaveBeenCalled();
  });

  it('the cursor comes back after the view is painted again', () => {
    click(cell(1, 'y'));
    paint();
    expect(at(cur())).toBe('1:y');
    expect(document.activeElement).toBe(tbl());
  });
});

describe('editing in the grid', () => {
  it('typing opens the cell empty and Enter saves, then moves down', () => {
    click(cell(0, 'x'));
    keyOn(tbl(), '7');
    const input = cell(0, 'x').querySelector<HTMLInputElement>('input.dq-cellin')!;
    expect(input.value).toBe('');
    input.value = '7';
    keyOn(input, 'Enter');
    expect(deps.saveCell).toHaveBeenCalledWith('a', 'x', '7');
    expect(at(cur())).toBe('1:x');
    expect(document.activeElement).toBe(tbl());
  });

  it('typing a value equal to the old one clears nothing and saves nothing', () => {
    click(cell(0, 'x'));
    keyOn(tbl(), '1');
    const input = cell(0, 'x').querySelector<HTMLInputElement>('input')!;
    input.value = '1';
    keyOn(input, 'Enter');
    expect(deps.saveCell).not.toHaveBeenCalled();
  });

  it('F2 and double-click open a formula cell with its formula, not its result', () => {
    click(cell(0, 'z'));
    keyOn(tbl(), 'F2');
    expect(cell(0, 'z').querySelector<HTMLInputElement>('input')!.value).toBe('=x+y');
    keyOn(cell(0, 'z').querySelector('input')!, 'Escape');
    expect(cell(0, 'z').textContent).toBe('11');
    expect(document.activeElement).toBe(tbl());
  });

  it('Tab saves and moves right; Esc cancels and keeps the cell', () => {
    click(cell(0, 'x'));
    keyOn(tbl(), 'F2');
    const input = cell(0, 'x').querySelector<HTMLInputElement>('input')!;
    input.value = '5';
    keyOn(input, 'Tab');
    expect(deps.saveCell).toHaveBeenCalledWith('a', 'x', '5');
    expect(at(cur())).toBe('0:y');
    keyOn(tbl(), 'F2');
    keyOn(cell(0, 'y').querySelector('input')!, 'Escape');
    expect(deps.saveCell).toHaveBeenCalledTimes(1);
    expect(at(cur())).toBe('0:y');
  });

  it('pointing at another cell finishes the edit', () => {
    click(cell(0, 'x'));
    keyOn(tbl(), 'F2');
    cell(0, 'x').querySelector<HTMLInputElement>('input')!.value = '9';
    click(cell(2, 'y'));
    expect(deps.saveCell).toHaveBeenCalledWith('a', 'x', '9');
    expect(at(cur())).toBe('2:y');
  });

  it('Delete clears the selected cells that hold something', async () => {
    click(cell(1, 'y'));
    keyOn(tbl(), 'ArrowDown', { shiftKey: true });
    keyOn(tbl(), 'ArrowRight', { shiftKey: true });
    keyOn(tbl(), 'Delete');
    await vi.waitFor(() => expect(deps.saveCell).toHaveBeenCalledTimes(3));
    expect(deps.saveCell.mock.calls.map((c) => c.join('|')).sort()).toEqual(['b|y|', 'b|z|', 'c|y|']);
  });
});

describe('formulas', () => {
  it('= then the arrow keys pick cells of the row into the formula', () => {
    click(cell(2, 'z'));
    keyOn(tbl(), '=');
    const input = cell(2, 'z').querySelector<HTMLInputElement>('input')!;
    input.value = '=';
    input.setSelectionRange(1, 1);
    keyOn(input, 'ArrowLeft');
    expect(input.value).toBe('=y');
    expect(cell(2, 'y').classList.contains('dq-ref')).toBe(true);
    keyOn(input, 'ArrowLeft');
    expect(input.value).toBe('=x');
    input.value = '=x*';
    input.setSelectionRange(3, 3);
    keyOn(input, 'ArrowLeft');
    expect(input.value).toBe('=x*y');
    keyOn(input, 'Enter');
    expect(deps.saveCell).toHaveBeenCalledWith('c', 'z', '=x*y');
    expect(document.querySelector('.dq-ref')).toBeNull();
  });

  it('clicking another cell of the row inserts it', () => {
    click(cell(2, 'z'));
    keyOn(tbl(), 'F2');
    const input = cell(2, 'z').querySelector<HTMLInputElement>('input')!;
    input.value = '=';
    input.setSelectionRange(1, 1);
    click(cell(2, 'x'));
    expect(input.value).toBe('=x');
    expect(cell(2, 'z').querySelector('input')).toBe(input);
    expect(deps.saveCell).not.toHaveBeenCalled();
  });

  it('arrows move the text caret as usual outside a formula', () => {
    click(cell(0, 'x'));
    keyOn(tbl(), 'F2');
    const input = cell(0, 'x').querySelector<HTMLInputElement>('input')!;
    const e = keyOn(input, 'ArrowRight');
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('rows', () => {
  it('Enter on the last row adds a row and puts the cursor on it', async () => {
    click(cell(2, 'y'));
    keyOn(tbl(), 'Enter');
    await vi.waitFor(() => expect(deps.addRow).toHaveBeenCalledWith('m'));
    await Promise.resolve();
    expect(deps.addRow).toHaveBeenCalledTimes(1);
  });

  it('Enter above the last row only moves', () => {
    click(cell(0, 'y'));
    keyOn(tbl(), 'Enter');
    expect(deps.addRow).not.toHaveBeenCalled();
    expect(at(cur())).toBe('1:y');
  });

  it('Enter that saves a cell on the last row stays there and adds no row', async () => {
    click(cell(2, 'x'));
    keyOn(tbl(), 'F2');
    const input = cell(2, 'x').querySelector<HTMLInputElement>('input')!;
    input.value = '4';
    keyOn(input, 'Enter');
    await Promise.resolve();
    expect(deps.saveCell).toHaveBeenCalledWith('c', 'x', '4');
    expect(deps.addRow).not.toHaveBeenCalled();
    expect(at(cur())).toBe('2:x');
  });

  it('the + row under the table adds one', () => {
    document.querySelector('tr.dq-addrow td')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(deps.addRow).toHaveBeenCalledWith('m');
  });
});

describe('clipboard', () => {
  const clip = (init: Partial<{ text: string; files: File[] }> = {}) => {
    const store: Record<string, string> = {};
    return {
      store,
      data: {
        setData: (t: string, v: string) => (store[t] = v),
        getData: (t: string) => (t === 'text/plain' ? init.text ?? '' : ''),
        files: init.files ?? [],
        items: [],
      },
    };
  };
  const fire = (type: 'copy' | 'cut' | 'paste', data: unknown) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: data });
    tbl().dispatchEvent(e);
    return e;
  };

  it('copies the selection as tab-separated text and an HTML table', () => {
    click(cell(0, 'x'));
    keyOn(tbl(), 'ArrowDown', { shiftKey: true });
    keyOn(tbl(), 'ArrowRight', { shiftKey: true });
    const c = clip();
    const e = fire('copy', c.data);
    expect(e.defaultPrevented).toBe(true);
    expect(c.store['text/plain']).toBe('1\t10\n2\t20');
    expect(c.store['text/html']).toBe('<table><tbody><tr><td>1</td><td>10</td></tr><tr><td>2</td><td>20</td></tr></tbody></table>');
    expect(deps.notify).toHaveBeenCalledWith('4 cells copied');
  });

  it('copies what a formula cell shows', () => {
    click(cell(0, 'z'));
    const c = clip();
    fire('copy', c.data);
    expect(c.store['text/plain']).toBe('11');
  });

  it('cut copies and clears', () => {
    click(cell(2, 'y'));
    const c = clip();
    fire('cut', c.data);
    expect(c.store['text/plain']).toBe('30');
    expect(deps.saveCell).toHaveBeenCalledWith('c', 'y', '');
  });

  it('pastes cells from the cursor on, and drops what falls outside', async () => {
    click(cell(1, 'x'));
    fire('paste', clip({ text: '5\t50\n6\t60\n7\t70\n' }).data);
    await vi.waitFor(() => expect(deps.saveCell).toHaveBeenCalledTimes(4));
    expect(deps.saveCell.mock.calls.map((c) => c.join('|'))).toEqual(['b|x|5', 'b|y|50', 'c|x|6', 'c|y|60']);
    await vi.waitFor(() => expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining('2 fell outside')));
  });

  it('one value pasted over a range fills it', async () => {
    click(cell(0, 'x'));
    keyOn(tbl(), 'ArrowDown', { shiftKey: true });
    fire('paste', clip({ text: '0' }).data);
    await vi.waitFor(() => expect(deps.saveCell).toHaveBeenCalledTimes(2));
  });

  it('pastes a picture from the clipboard into the cell as an image', async () => {
    click(cell(0, 'x'));
    const png = new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' });
    const e = fire('paste', clip({ files: [png] }).data);
    expect(e.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(deps.saveCell).toHaveBeenCalled());
    const [b, k, v] = deps.saveCell.mock.calls[0];
    expect([b, k]).toEqual(['a', 'x']);
    expect(v).toMatch(/^!\[pasted image\]\(data:image\/png;base64,[A-Za-z0-9+/=]+\)$/);
  });
});

describe('full screen', () => {
  const full = () => document.querySelector('.dq')!.classList.contains('dq-full');

  it('the ⛶ button toggles it', () => {
    const btn = document.querySelector<HTMLElement>('.dq-side [data-act="full"]')!;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(full()).toBe(true);
    expect(ui.isFull('m')).toBe(true);
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(full()).toBe(false);
  });

  it('f toggles it while the table has the focus, and Esc does not leave it', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    click(cell(0, 'x'));
    keyOn(tbl(), 'f');
    expect(full()).toBe(true);
    expect(deps.saveCell).not.toHaveBeenCalled();
    expect(cell(0, 'x').querySelector('input')).toBeNull();
    keyOn(tbl(), 'Escape');
    expect(full()).toBe(true);
    vi.advanceTimersByTime(1000);
    keyOn(tbl(), 'f');
    expect(full()).toBe(false);
  });

  it('mashing f toggles once, and f outside a field is swallowed while full', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    click(cell(0, 'x'));
    keyOn(tbl(), 'f');
    keyOn(tbl(), 'f');
    keyOn(tbl(), 'f');
    expect(full()).toBe(true);
    vi.advanceTimersByTime(1000);
    keyOn(document.body, 'f');
    expect(full()).toBe(false);
  });

  it('f from the page body leaves a full-screen view, and a capital F still types', () => {
    document.querySelector<HTMLElement>('.dq-side [data-act="full"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    keyOn(document.body, 'f');
    expect(full()).toBe(false);
    click(cell(0, 'x'));
    keyOn(tbl(), 'F', { shiftKey: true });
    expect(cell(0, 'x').querySelector('input')).not.toBeNull();
    expect(full()).toBe(false);
  });
});

describe('right-click menu', () => {
  const rightClick = (el: Element) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 20 }));

  it('offers Delete row and deletes the row', () => {
    const e = rightClick(cell(1, 'x'));
    expect(e).toBe(false);
    const item = [...document.querySelectorAll<HTMLElement>('.dq-menu .dq-menuitem')].find((b) => b.textContent!.startsWith('Delete'))!;
    expect(item.textContent).toBe('Delete row');
    item.click();
    expect(deps.deleteRow).toHaveBeenCalledWith('m', 1);
    expect(document.querySelector('.dq-menu')).toBeNull();
  });

  it('closes when the user presses elsewhere', () => {
    rightClick(cell(0, 'x'));
    expect(document.querySelector('.dq-menu')).not.toBeNull();
    press(document.body, 'mousedown');
    expect(document.querySelector('.dq-menu')).toBeNull();
    expect(deps.deleteRow).not.toHaveBeenCalled();
  });
});

describe('row label', () => {
  const label = (row: number) => document.querySelector<HTMLElement>(`tr[data-row="${row}"] td[data-label]`)!;
  const clickEv = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  afterEach(() => vi.useRealTimers());

  it('a click goes to the block after a beat', () => {
    vi.useFakeTimers();
    clickEv(label(1));
    expect(deps.jump).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(deps.jump).toHaveBeenCalledWith('b');
  });

  it('a click in full screen leaves it first, then goes', () => {
    vi.useFakeTimers();
    document.querySelector<HTMLElement>('.dq-side [data-act="full"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(ui.isFull('m')).toBe(true);
    clickEv(label(0));
    vi.advanceTimersByTime(300);
    expect(ui.isFull('m')).toBe(false);
    expect(document.querySelector('.dq')!.classList.contains('dq-full')).toBe(false);
    expect(deps.jump).toHaveBeenCalledWith('a');
  });

  it('a double-click renames the row instead of going', () => {
    vi.useFakeTimers();
    clickEv(label(0));
    clickEv(label(0));
    label(0).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(300);
    expect(deps.jump).not.toHaveBeenCalled();
    const input = label(0).querySelector<HTMLInputElement>('input')!;
    expect(input.value).toBe('A');
    input.value = 'Renamed';
    keyOn(input, 'Enter');
    expect(deps.saveTitle).toHaveBeenCalledWith('a', 'Renamed');
    expect(deps.saveCell).not.toHaveBeenCalled();
  });
});

describe('right-click menu and focus', () => {
  it('survives the focus moving to the menu button', () => {
    click(cell(1, 'x'));
    cell(1, 'x').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    tbl().dispatchEvent(new FocusEvent('blur'));
    tbl().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(document.querySelector('.dq-menu')).not.toBeNull();
  });
});

describe('right-click menu: rename', () => {
  it('Rename row opens the label editor', () => {
    cell(1, 'x').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    document.querySelector<HTMLElement>('.dq-menurename')!.click();
    expect(document.querySelector<HTMLInputElement>('tr[data-row="1"] td[data-label] input')!.value).toBe('B');
  });
});

describe('table images', () => {
  it('scales a picture so the harmonic mean of its sides is the table size', async () => {
    const { scaleImg } = await import('../../src/host/interact');
    const img = document.createElement('img');
    Object.defineProperty(img, 'naturalWidth', { value: 300 });
    Object.defineProperty(img, 'naturalHeight', { value: 100 });
    scaleImg(img);
    // 2wh/(w+h) = 150 for 300x100; the factors give T*kw by T*kh with the same harmonic mean T.
    const kw = Number(img.style.getPropertyValue('--kw'));
    const kh = Number(img.style.getPropertyValue('--kh'));
    expect(kw).toBeCloseTo(2, 5);
    expect(kh).toBeCloseTo(2 / 3, 5);
    expect((2 * kw * kh) / (kw + kh)).toBeCloseTo(1, 5);
    expect(kw / kh).toBeCloseTo(3, 5);
  });
});

describe('focus slips away', () => {
  it('arrows still move the cursor when the focus is on the page body', () => {
    click(cell(0, 'x'));
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    keyOn(document.body, 'ArrowDown');
    expect(at(cur())).toBe('1:x');
  });

  it('but not after the user pressed somewhere else on the page', () => {
    click(cell(0, 'x'));
    document.body.insertAdjacentHTML('beforeend', '<p id="o">x</p>');
    press(document.getElementById('o')!, 'mousedown');
    (document.activeElement as HTMLElement).blur();
    keyOn(document.body, 'ArrowDown');
    expect(at(cur())).toBe('0:x');
  });
});
