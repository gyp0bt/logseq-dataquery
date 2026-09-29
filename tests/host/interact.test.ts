// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDsl } from '../../src/core/dsl';
import type { Row } from '../../src/core/rows';
import { renderInline } from '../../src/core/view';
import { Interact, type ChartData } from '../../src/host/interact';

const row = (id: string, values: Record<string, string>): Row => ({
  id, title: id, values, sources: [{ uuid: id, pageTitle: 'P', journalDay: null }], conflicts: {},
});
const rows = [row('a', { x: '1', y: '10' }), row('b', { x: '2', y: '20' }), row('c', { x: '3', y: '30' })];
const types = { x: 'number', y: 'number' } as const;
const DSL = 'plot scatter x=x y=y';
const chart: ChartData = { rows, plot: { kind: 'scatter', x: 'x', y: 'y', labels: false }, types };

let off: () => void;
const mk = () => ({ submit: vi.fn<(uuid: string, dsl: string) => Promise<void>>(async () => {}), chart: () => chart, report: vi.fn<(e: unknown) => void>() });
let deps: ReturnType<typeof mk>;
let ui: Interact;

beforeEach(() => {
  const parsed = parseDsl(DSL);
  document.body.innerHTML = `<div id="slot">${renderInline({
    macroUuid: 'm', dsl: DSL, parsed,
    result: { scoped: rows, rows, cols: ['x', 'y'], types: { ...types }, warnings: [] },
  })}</div>`;
  // jsdom has no layout: give the plot a width so it can be drawn.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  deps = mk();
  ui = new Interact(document, deps);
  off = ui.install();
});
afterEach(() => off());

const field = () => document.querySelector<HTMLInputElement>('input.dq-dsl')!;
const key = (k: string, init: KeyboardEventInit = {}) =>
  field().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

describe('query field', () => {
  it('Enter saves a valid query', () => {
    field().value = 'sort y';
    key('Enter');
    expect(deps.submit).toHaveBeenCalledWith('m', 'sort y');
  });

  it('Enter on a mistake shows it under the field and keeps the text', () => {
    field().value = 'where y <';
    key('Enter');
    expect(deps.submit).not.toHaveBeenCalled();
    expect(field().value).toBe('where y <');
    expect(field().classList.contains('dq-bad')).toBe(true);
    expect(document.querySelector('.dq-msg')!.textContent).toContain('Missing value');
  });

  it('Enter that confirms IME input does not save', () => {
    field().value = 'sort y';
    key('Enter', { isComposing: true });
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('Escape restores the saved text', () => {
    field().value = 'junk';
    key('Escape');
    expect(field().value).toBe(DSL);
  });
});

describe('chart', () => {
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

  it('zoom in halves the range; reset restores it', () => {
    ui.attach('slot');
    const dom = () => document.querySelector('svg.dq-chart')!.getAttribute('data-dom')!.split(',').map(Number);
    const [x0, x1] = dom();
    document.querySelector<HTMLElement>('[data-act="zoomin"]')!.click();
    const [z0, z1] = dom();
    expect(z1 - z0).toBeCloseTo((x1 - x0) / 2);
    document.querySelector<HTMLElement>('[data-act="reset"]')!.click();
    expect(dom().slice(0, 2)).toEqual([x0, x1]);
  });

  it('enlarge makes the chart taller', () => {
    ui.attach('slot');
    document.querySelector<HTMLElement>('[data-act="expand"]')!.click();
    expect(Number(document.querySelector('svg.dq-chart')!.getAttribute('height'))).toBeGreaterThanOrEqual(360);
    expect(document.querySelector('.dq-chartbox')!.classList.contains('dq-big')).toBe(true);
  });
});
