// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseQuery, type Kind } from '../../src/core/dsl';
import { runQuery } from '../../src/core/query';
import type { SourceBlock } from '../../src/core/rows';
import type { ValueType } from '../../src/core/types';
import { renderInline, type ViewData } from '../../src/core/view';
import { Interact } from '../../src/host/interact';

const block = (uuid: string, content: string): SourceBlock => ({
  uuid, content, page: 'p', pageTitle: 'P', journalDay: null, pathRefs: [], preBlock: false, seq: 0,
});
const blocks = [block('a', 'A\nx:: 1\ny:: 10'), block('b', 'B\nx:: 2\ny:: 20/22'), block('c', 'C\nx:: 3\ny:: 30')];
const types: Record<string, ValueType> = { x: 'number', y: 'numlist' };
const DSL = 'x:x y:y';

let off: () => void;
const mk = () => ({
  submit: vi.fn<(uuid: string, dsl: string) => Promise<void>>(async () => {}),
  view: vi.fn<(uuid: string) => ViewData | undefined>(),
  report: vi.fn<(e: unknown) => void>(),
  notify: vi.fn<(msg: string) => void>(),
});
let deps: ReturnType<typeof mk>;
let ui: Interact;

function setup(kind: Kind, dsl = DSL, bs: SourceBlock[] = blocks) {
  const parsed = parseQuery(dsl);
  if (!parsed.ok) throw new Error('bad test query');
  const result = runQuery(parsed.query, kind, { blocks: bs, types, macroUuid: 'm' });
  document.body.innerHTML = `<div id="slot">${renderInline({ kind, macroUuid: 'm', dsl, parsed, result })}</div>`;
  deps.view.mockReturnValue({ kind, query: parsed.query, result });
}

beforeEach(() => {
  // jsdom has no layout: give the plot a width so it can be drawn.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  deps = mk();
  setup('scatter');
  ui = new Interact(document, deps);
  off = ui.install();
});
afterEach(() => off());

const field = () => document.querySelector<HTMLInputElement>('input.dq-dsl')!;
const key = (k: string, init: KeyboardEventInit = {}) =>
  field().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const act = (a: string) => document.querySelector<HTMLElement>(`.dq-side [data-act="${a}"]`)!;

describe('query field', () => {
  it('Enter saves a valid query', () => {
    field().value = 'sort:y';
    key('Enter');
    expect(deps.submit).toHaveBeenCalledWith('m', 'sort:y');
  });

  it('Enter on a mistake shows it under the field and keeps the text', () => {
    field().value = 'y<';
    key('Enter');
    expect(deps.submit).not.toHaveBeenCalled();
    expect(field().value).toBe('y<');
    expect(field().classList.contains('dq-bad')).toBe(true);
    expect(document.querySelector('.dq-msg')!.textContent).toContain('Missing value');
  });

  it('Enter that confirms IME input does not save', () => {
    field().value = 'sort:y';
    key('Enter', { isComposing: true });
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('Escape restores the saved text', () => {
    field().value = 'junk';
    key('Escape');
    expect(field().value).toBe(DSL);
  });
});

/**
 * Logseq around the view, as on the device: its injected-UI wrapper forwards a click to the
 * nearest `data-on-click` model (bubble phase), and the block content above it stops mouse
 * events (React `stopPropagation`). Our listeners sit on the document in the capture phase.
 */
describe('query field inside Logseq', () => {
  let models: string[];
  beforeEach(() => {
    models = [];
    const view = document.querySelector('.dq')!;
    const wrap = document.createElement('div');
    wrap.className = 'block-content';
    const injected = document.createElement('div');
    view.replaceWith(wrap);
    wrap.appendChild(injected);
    injected.appendChild(view);
    for (const t of ['mousedown', 'mouseover', 'click']) wrap.addEventListener(t, (e) => e.stopPropagation());
    injected.addEventListener('click', (e) => {
      const trig = (e.target as Element).closest<HTMLElement>('[data-on-click]');
      if (trig) models.push(trig.dataset.onClick!);
    });
  });
  const press = (el: Element, type: string) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1 }));

  it('click puts the caret in the field; typing and Enter save; no raw block editing', () => {
    const f = field();
    expect(press(f, 'pointerdown')).toBe(true);
    expect(press(f, 'mousedown')).toBe(true); // nothing cancels the default: the caret goes in
    f.focus();
    press(f, 'mouseup');
    expect(press(f, 'click')).toBe(true);
    expect(document.activeElement).toBe(f);
    f.value = 'sort:y';
    f.setSelectionRange(0, 4); // selecting text works
    expect(f.selectionEnd).toBe(4);
    expect(key('Enter')).toBe(false); // Enter is ours (no newline)
    expect(deps.submit).toHaveBeenCalledWith('m', 'sort:y');
    expect(models).not.toContain('dqEdit');
    // Saving leaves the field, so the repaint with the new query is not held back.
    expect(document.activeElement).not.toBe(f);
  });

  it('a drag that starts in the field and ends outside (selecting text) does not open the block editor', () => {
    const f = field();
    press(f, 'pointerdown');
    press(f, 'mousedown');
    f.focus();
    // The browser targets the click at the nearest common ancestor: the view head.
    press(document.querySelector('.dq-head')!, 'click');
    expect(models).not.toContain('dqEdit');
    // A plain click on blank space still opens it.
    press(document.querySelector('.dq-head')!, 'pointerdown');
    press(document.querySelector('.dq-head')!, 'click');
    expect(models).toContain('dqEdit');
  });

  it('leaving the field asks for the held-back repaint', () => {
    const resume = vi.fn();
    off();
    ui = new Interact(document, { ...deps, resume });
    off = ui.install();
    const f = field();
    f.focus();
    f.blur();
    expect(resume).toHaveBeenCalled();
  });
});

describe('chart and side buttons', () => {
  const dom = () => document.querySelector('svg.dq-chart')!.getAttribute('data-dom')!.split(',').map(Number);

  it('attach redraws at the real width', () => {
    ui.attach('slot');
    expect(document.querySelector('svg.dq-chart')!.getAttribute('width')).toBe('800');
  });

  it('clicking a point highlights its table row', () => {
    Element.prototype.scrollIntoView = vi.fn();
    ui.attach('slot');
    document.querySelector<SVGElement>('circle[data-uuid="b"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('tr[data-uuid="b"]')!.classList.contains('dq-hl')).toBe(true);
  });

  it('dragging zooms in; ⟲ in the side column resets', () => {
    ui.attach('slot');
    const svg = document.querySelector<SVGSVGElement>('svg.dq-chart')!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 360, width: 800, height: 360, x: 0, y: 0, toJSON: () => ({}) });
    const before = dom();
    const area = svg.querySelector('.dq-area')!;
    const ptr = (type: string, x: number, y: number) =>
      (type === 'pointerdown' ? area : document).dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    ptr('pointerdown', 100, 50);
    ptr('pointermove', 300, 200);
    ptr('pointerup', 300, 200);
    expect(dom()[1] - dom()[0]).toBeLessThan(before[1] - before[0]);
    act('reset').click();
    expect(dom()).toEqual(before);
  });

  it('⤢ in the side column makes the chart taller', () => {
    ui.attach('slot');
    act('expand').click();
    expect(Number(document.querySelector('svg.dq-chart')!.getAttribute('height'))).toBeGreaterThanOrEqual(360);
    expect(document.querySelector('.dq-chartbox')!.classList.contains('dq-big')).toBe(true);
  });

  it('draws error bars for the multi-valued row', () => {
    ui.attach('slot');
    expect(document.querySelectorAll('svg.dq-chart .dq-err')).toHaveLength(1);
  });
});

describe('plotly-like interactions', () => {
  const svg = () => document.querySelector<SVGSVGElement>('svg.dq-chart')!;
  const dom = () => svg().getAttribute('data-dom')!.split(',').map(Number);
  const rect = () => ({ left: 0, top: 0, right: 800, bottom: 360, width: 800, height: 360, x: 0, y: 0, toJSON: () => ({}) });
  const fire = (t: EventTarget, type: string, init: MouseEventInit = {}) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    t.dispatchEvent(e);
    return e;
  };

  it('dragging the right end of the x axis moves only x1; the middle pans', () => {
    ui.attach('slot');
    svg().getBoundingClientRect = rect;
    const before = dom();
    const [L, , PW] = svg().getAttribute('data-box')!.split(',').map(Number);
    const end = svg().querySelector('.dq-axdrag[data-ax="x"][data-end="1"]')!;
    fire(end, 'pointerdown', { button: 0, clientX: L + PW * 0.9, clientY: 330 });
    fire(document, 'pointermove', { clientX: L + PW * 0.45, clientY: 330 });
    fire(document, 'pointerup', { clientX: L + PW * 0.45, clientY: 330 });
    expect(dom()[0]).toBeCloseTo(before[0], 10);
    expect(dom()[1]).toBeGreaterThan(before[1]);
    const mid = dom();
    svg().getBoundingClientRect = rect;
    fire(svg().querySelector('.dq-axdrag[data-ax="y"][data-end="pan"]')!, 'pointerdown', { button: 0, clientX: 20, clientY: 150 });
    fire(document, 'pointermove', { clientX: 20, clientY: 200 });
    fire(document, 'pointerup', { clientX: 20, clientY: 200 });
    expect(dom()[2] - dom()[3]).toBeCloseTo(mid[2] - mid[3], 10);
    expect(dom()[2]).toBeGreaterThan(mid[2]);
    act('reset').click();
    expect(dom()).toEqual(before);
  });

  it('Ctrl + wheel scales markers and fonts and keeps the page from zooming; a plain wheel scrolls', () => {
    ui.attach('slot');
    const pt = () => document.querySelector('circle.dq-pt')!;
    const wheel = (ctrlKey: boolean, deltaY: number) => {
      const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey, deltaY });
      pt().dispatchEvent(e);
      return e;
    };
    expect(wheel(false, -100).defaultPrevented).toBe(false);
    expect(pt().getAttribute('r')).toBe('3');
    expect(wheel(true, -100).defaultPrevented).toBe(true);
    expect(Number(pt().getAttribute('r'))).toBeGreaterThan(3);
    expect(svg().getAttribute('style')).toContain('--dq-s:');
    for (let i = 0; i < 40; i++) wheel(true, 100);
    expect(svg().getAttribute('style')).toContain('--dq-s:0.5');
  });

  it('double-clicking a legend entry or a marker hides its trace; the entry stays, greyed, to bring it back', () => {
    setup('scatter', 'x:x y:y color:x');
    ui.attach('slot');
    const n = () => document.querySelectorAll('circle.dq-pt').length;
    expect(n()).toBe(3);
    fire(document.querySelector('circle[data-trace="x = 1"]')!, 'dblclick');
    expect(n()).toBe(2);
    const entry = () => document.querySelector<HTMLElement>('.dq-legend [data-trace="x = 1"]')!;
    expect(entry().classList.contains('dq-off')).toBe(true);
    fire(entry(), 'dblclick');
    expect(n()).toBe(3);
    expect(entry().classList.contains('dq-off')).toBe(false);
  });

  it('hovering a marker shows a fixed label in the document body, with the block name and values', () => {
    ui.attach('slot');
    const pt = document.querySelector<SVGElement>('circle[data-uuid="b"]')!;
    fire(pt, 'mouseover');
    const tip = document.querySelector<HTMLElement>('body > .dq-tip')!;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain('B');
    expect(tip.textContent).toContain('y: mean 21 · min 20 · max 22 · n=2');
    expect(tip.closest('.dq')).toBeNull();
    fire(pt, 'mouseout');
    expect(tip.hidden).toBe(true);
  });

  it('the hover label still appears when Logseq stops the event on its way up', () => {
    ui.attach('slot');
    const pt = document.querySelector<SVGElement>('circle[data-uuid="a"]')!;
    const stop = (e: Event) => e.stopPropagation();
    document.body.addEventListener('mouseover', stop);
    fire(pt, 'mouseover');
    document.body.removeEventListener('mouseover', stop);
    expect(document.querySelector<HTMLElement>('body > .dq-tip')!.hidden).toBe(false);
  });

  it('Ctrl + wheel leaves the legend at its normal size', () => {
    setup('scatter', 'x:x y:y color:x');
    ui.attach('slot');
    document.querySelector('circle.dq-pt')!.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 }));
    expect(svg().getAttribute('style')).toContain('--dq-s:');
    expect(document.querySelector('.dq-legend')!.getAttribute('style')).toBeNull();
  });

  it('double-clicking an axis end opens a box with that end; Enter applies a typed value', () => {
    ui.attach('slot');
    const before = dom();
    fire(svg().querySelector('.dq-axdrag[data-ax="x"][data-end="1"]')!, 'dblclick');
    const input = () => document.querySelector<HTMLInputElement>('input.dq-axin');
    expect(input()).not.toBeNull();
    expect(Number(input()!.value)).toBe(before[1]);
    expect(document.activeElement).toBe(input());
    // The plot-area reset and the trace toggle did not run: the range is unchanged.
    expect(dom()).toEqual(before);
    input()!.value = '7.5';
    const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input()!.dispatchEvent(e);
    expect(input()).toBeNull();
    expect(dom()[1]).toBe(7.5);
    expect(dom()[0]).toBe(before[0]);
  });

  it('a bad or inverted value and Esc change nothing; double-clicking the middle resets that axis only', () => {
    ui.attach('slot');
    const before = dom();
    const type = (end: string, v: string, k = 'Enter') => {
      fire(svg().querySelector(`.dq-axdrag[data-ax="y"][data-end="${end}"]`)!, 'dblclick');
      const input = document.querySelector<HTMLInputElement>('input.dq-axin')!;
      input.value = v;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    };
    type('0', 'abc');
    type('0', String(before[3] + 1));
    type('0', '5', 'Escape');
    expect(dom()).toEqual(before);
    expect(document.querySelector('input.dq-axin')).toBeNull();
    type('0', '15');
    fire(svg().querySelector('.dq-axdrag[data-ax="x"][data-end="0"]')!, 'dblclick');
    const xi = document.querySelector<HTMLInputElement>('input.dq-axin')!;
    xi.value = '1.5';
    xi.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(dom()[2]).toBe(15);
    expect(dom()[0]).toBe(1.5);
    fire(svg().querySelector('.dq-axdrag[data-ax="y"][data-end="pan"]')!, 'dblclick');
    expect(dom()[2]).toBe(before[2]);
    expect(dom()[0]).toBe(1.5);
  });

  it('keys typed in the axis box do not reach Logseq', () => {
    ui.attach('slot');
    fire(svg().querySelector('.dq-axdrag[data-ax="x"][data-end="0"]')!, 'dblclick');
    const heard = vi.fn();
    document.body.addEventListener('keydown', heard);
    document.querySelector<HTMLInputElement>('input.dq-axin')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    document.body.removeEventListener('keydown', heard);
    expect(heard).not.toHaveBeenCalled();
  });

  it('by: colours the points by its value', () => {
    setup('scatter', 'x:x y:y by:x');
    ui.attach('slot');
    expect(document.querySelector('.dq-legend')!.textContent).toContain('x = 2');
  });

  it('a re-render of the same view starts at the last size and state, so attach need not redraw', () => {
    ui.attach('slot');
    const opts = ui.optsFor('m')!;
    expect(opts.size).toEqual({ w: 800, h: 360 });
    expect(ui.optsFor('other')).toBeUndefined();
    const parsed = parseQuery(DSL);
    if (!parsed.ok) throw new Error('bad');
    document.body.innerHTML = `<div id="slot">${renderInline({ kind: 'scatter', macroUuid: 'm', dsl: DSL, parsed, result: deps.view('m')!.result, chartOpts: opts })}</div>`;
    const first = svg();
    ui.attach('slot');
    expect(svg()).toBe(first);
  });

});

describe('folded table under a chart', () => {
  const fold = () => document.querySelector<HTMLElement>('.dq-fold')!;
  const toggle = () => fold().querySelector<HTMLElement>('[data-act="table"]')!;

  it('starts folded; the toggle opens and closes it and the choice survives a re-render', () => {
    ui.attach('slot');
    expect(fold().classList.contains('dq-open')).toBe(false);
    expect(toggle().textContent).toBe('▸ Table (3 rows)');
    toggle().click();
    expect(fold().classList.contains('dq-open')).toBe(true);
    expect(toggle().textContent).toBe('▾ Table (3 rows)');
    expect(ui.tableOpen('m')).toBe(true);
    setup('scatter');
    ui.attach('slot');
    expect(fold().classList.contains('dq-open')).toBe(true);
    toggle().click();
    expect(ui.tableOpen('m')).toBe(false);
  });

  it('clicking a point opens the table, then marks the row', () => {
    Element.prototype.scrollIntoView = vi.fn();
    ui.attach('slot');
    document.querySelector<SVGElement>('circle[data-uuid="c"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(fold().classList.contains('dq-open')).toBe(true);
    expect(document.querySelector('tr[data-uuid="c"]')!.classList.contains('dq-hl')).toBe(true);
  });

  it('with by:, a point marks the merged row of its by value', () => {
    Element.prototype.scrollIntoView = vi.fn();
    setup('scatter', 'x:x y:y by:x');
    ui.attach('slot');
    document.querySelector<SVGElement>('circle[data-key="2"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('tr[data-key="2"]')!.classList.contains('dq-hl')).toBe(true);
  });

  it('with color: only, a point marks every row of its colour', () => {
    Element.prototype.scrollIntoView = vi.fn();
    const g = [block('a', 'A\nx:: 1\ny:: 10\ng:: p'), block('b', 'B\nx:: 1\ny:: 12\ng:: p'), block('c', 'C\nx:: 3\ny:: 30\ng:: q')];
    setup('scatter', 'x:x y:y color:g', g);
    ui.attach('slot');
    expect(document.querySelectorAll('circle.dq-pt')).toHaveLength(2);
    document.querySelector<SVGElement>('circle[data-key="p"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const hl = [...document.querySelectorAll<HTMLElement>('tr.dq-hl')].map((tr) => tr.dataset.uuid);
    expect(hl).toEqual(['a', 'b']);
  });

  it('a table view has no fold', () => {
    setup('table');
    expect(document.querySelector('.dq-fold')).toBeNull();
  });
});

describe('CSV', () => {
  it('copies the table and says how many rows', async () => {
    const writeText = vi.fn(async (_t: string) => {});
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
    act('csv').click();
    await vi.waitFor(() => expect(deps.notify).toHaveBeenCalledWith('3 rows copied'));
    expect(writeText).toHaveBeenCalledWith('block,x,y\r\nA,1,10\r\nB,2,20/22\r\nC,3,30');
  });

  it('reports a failed copy with the cause attached', async () => {
    const boom = new Error('denied');
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => { throw boom; }) } });
    act('csv').click();
    await vi.waitFor(() => expect(deps.report).toHaveBeenCalled());
    const e = deps.report.mock.calls[0][0] as Error;
    expect(e.message).toBe('Could not copy the table as CSV.');
    expect(e.cause).toBe(boom);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('works on a plain table view too', async () => {
    setup('table');
    const writeText = vi.fn(async (_t: string) => {});
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
    act('csv').click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
  });
});

describe('middle-button pan on the table (Review Focus 4)', () => {
  const tbl = () => document.querySelector<HTMLElement>('.dq-tbl')!;
  const fire = (target: EventTarget, type: string, init: MouseEventInit) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    return e;
  };

  it('dragging with the middle button scrolls the table sideways only, following the pointer direction reversed', () => {
    const t = tbl();
    t.scrollLeft = 100;
    t.scrollTop = 50;
    fire(t, 'pointerdown', { button: 1, buttons: 4, clientX: 200, clientY: 100 });
    expect(t.style.cursor).toBe('grabbing');
    fire(document, 'pointermove', { buttons: 4, clientX: 150, clientY: 90 });
    expect(t.scrollLeft).toBe(50);
    expect(t.scrollTop).toBe(50);
    fire(document, 'pointerup', { button: 1, clientX: 150, clientY: 90 });
    expect(t.style.cursor).toBe('');
    fire(document, 'pointermove', { buttons: 0, clientX: 0, clientY: 0 });
    expect(t.scrollLeft).toBe(50);
  });

  it('middle mousedown, mouseup and auxclick do nothing by default inside the table (no paste, no autoscroll)', () => {
    const cell = tbl().querySelector('td')!;
    for (const type of ['mousedown', 'mouseup', 'auxclick']) expect(fire(cell, type, { button: 1 }).defaultPrevented).toBe(true);
    expect(fire(cell, 'mousedown', { button: 0 }).defaultPrevented).toBe(false);
    expect(fire(document.body, 'mousedown', { button: 1 }).defaultPrevented).toBe(false);
  });
});
