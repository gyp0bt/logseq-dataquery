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

function setup(kind: Kind, dsl = DSL) {
  const parsed = parseQuery(dsl);
  if (!parsed.ok) throw new Error('bad test query');
  const result = runQuery(parsed.query, kind, { blocks, types, macroUuid: 'm' });
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
