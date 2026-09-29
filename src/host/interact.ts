import { barSvg, scatterSvg, type Domain } from '../core/chart';
import { parseDsl, type Plot } from '../core/dsl';
import type { Row } from '../core/rows';
import type { ValueType } from '../core/types';
import { errorHtml } from '../core/view';

/** What a chart needs to be drawn again at another size or zoom. */
export interface ChartData { rows: Row[]; plot: Plot; types: Record<string, ValueType>; mergeBy?: string }

export interface InteractDeps {
  /** Write a valid query back into the macro. */
  submit(uuid: string, dsl: string): Promise<void>;
  chart(uuid: string): ChartData | undefined;
  report(e: unknown): void;
}

interface ChartState { view?: Domain; big: boolean }

const HEIGHT = 360;
const MIN_DRAG = 6;

/**
 * Behaviour Logseq's `data-on-*` delegation cannot give: it forwards no key names and no pointer
 * movement. The plugin runs in a same-origin iframe, so these listeners live on Logseq's document
 * and act only on elements inside our views.
 */
export class Interact {
  private state = new Map<string, ChartState>();
  private observers = new WeakMap<Element, ResizeObserver>();
  private drag?: { box: HTMLElement; svg: SVGSVGElement; x: number; y: number; rect: SVGRectElement };

  constructor(private doc: Document, private deps: InteractDeps) {}

  install(): () => void {
    const on: Array<[string, (e: Event) => void, boolean]> = [
      ['keydown', (e) => this.onKey(e as KeyboardEvent), true],
      ['click', (e) => this.onClick(e as MouseEvent), false],
      ['dblclick', (e) => this.onDblClick(e as MouseEvent), false],
      ['mouseover', (e) => this.onOver(e as MouseEvent), false],
      ['mouseout', (e) => this.onOut(e as MouseEvent), false],
      ['pointerdown', (e) => this.onDown(e as PointerEvent), false],
      ['pointermove', (e) => this.onMove(e as PointerEvent), false],
      ['pointerup', (e) => this.onUp(e as PointerEvent), false],
    ];
    const guard = (f: (e: Event) => void) => (e: Event) => {
      try {
        f(e);
      } catch (err) {
        this.deps.report(new Error('Data query view: an interaction failed.', { cause: err }));
      }
    };
    const bound = on.map(([t, f, cap]) => [t, guard(f), cap] as const);
    for (const [t, f, cap] of bound) this.doc.addEventListener(t, f, cap);
    return () => {
      for (const [t, f, cap] of bound) this.doc.removeEventListener(t, f, cap);
    };
  }

  /** Draw the charts under `slotId` at their real width once Logseq has inserted the new HTML. */
  attach(slotId: string, tries = 40): void {
    const boxes = [...(this.doc.getElementById(slotId)?.querySelectorAll<HTMLElement>('.dq-chartbox:not([data-live])') ?? [])];
    if (!boxes.length) {
      if (tries > 0) setTimeout(() => this.attach(slotId, tries - 1), 25);
      return;
    }
    for (const box of boxes) {
      box.dataset.live = '1';
      const st = this.stateOf(box);
      box.classList.toggle('dq-big', st.big);
      this.draw(box);
      const RO = this.doc.defaultView?.ResizeObserver;
      if (RO && !this.observers.has(box)) {
        let lastW = box.clientWidth;
        const ro = new RO(() => {
          if (!box.isConnected) return ro.disconnect();
          if (box.clientWidth !== lastW) {
            lastW = box.clientWidth;
            this.draw(box);
          }
        });
        ro.observe(box);
        this.observers.set(box, ro);
      }
    }
  }

  private stateOf(box: HTMLElement): ChartState {
    const uuid = box.dataset.macro!;
    if (!this.state.has(uuid)) this.state.set(uuid, { big: false });
    return this.state.get(uuid)!;
  }

  draw(box: HTMLElement): void {
    const data = this.deps.chart(box.dataset.macro!);
    const plotEl = box.querySelector<HTMLElement>('.dq-plot');
    const w = plotEl?.clientWidth ?? 0;
    if (!data || !plotEl || w <= 0) return;
    const st = this.stateOf(box);
    const winH = this.doc.defaultView?.innerHeight ?? 800;
    const size = { w, h: st.big ? Math.max(HEIGHT, Math.round(winH * 0.7)) : HEIGHT };
    plotEl.innerHTML =
      data.plot.kind === 'scatter'
        ? scatterSvg(data.rows, data.plot, data.types, data.mergeBy, { size, view: st.view }).html
        : barSvg(data.rows, data.plot, data.types, { size }).html;
  }

  // ---- query field ----

  private onKey(e: KeyboardEvent): void {
    const input = (e.target as Element | null)?.closest?.('input.dq-dsl') as HTMLInputElement | null;
    if (!input) return;
    // Keys typed here belong to the field, not to Logseq's shortcuts.
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return; // IME confirmation, not a submit
    if (e.key === 'Escape') {
      input.value = input.defaultValue;
      this.showError(input, '');
      input.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const dsl = input.value.replace(/[\r\n]+/g, ' ').trim();
      const parsed = parseDsl(dsl);
      if (!parsed.ok) {
        this.showError(input, errorHtml(dsl, parsed.error.message, parsed.error.col));
        return;
      }
      this.showError(input, '');
      this.deps.submit(input.dataset.macro!, dsl).catch((err) => this.deps.report(err));
    }
  }

  private showError(input: HTMLInputElement, html: string): void {
    input.classList.toggle('dq-bad', !!html);
    const msg = input.closest('.dq')?.querySelector('.dq-msg');
    if (msg) msg.innerHTML = html;
  }

  // ---- chart ----

  private onClick(e: MouseEvent): void {
    const t = e.target as Element | null;
    const act = t?.closest?.('.dq-mb') as HTMLElement | null;
    if (act) return this.modebar(act);
    const pt = t?.closest?.('.dq-pt') as SVGElement | null;
    if (pt) this.highlightRow(pt);
  }

  private highlightRow(pt: SVGElement): void {
    const uuid = pt.dataset.uuid;
    const view = pt.closest('.dq');
    if (!uuid || !view) return;
    view.querySelectorAll('tr.dq-hl').forEach((tr) => tr.classList.remove('dq-hl'));
    const tr = [...view.querySelectorAll<HTMLElement>('tr[data-uuid]')].find((r) => r.dataset.uuid === uuid);
    if (!tr) return;
    tr.classList.add('dq-hl');
    tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  private modebar(btn: HTMLElement): void {
    const box = btn.closest<HTMLElement>('.dq-chartbox');
    if (!box) return;
    const st = this.stateOf(box);
    const act = btn.dataset.act;
    if (act === 'expand') {
      st.big = !st.big;
      box.classList.toggle('dq-big', st.big);
    } else if (act === 'reset') {
      st.view = undefined;
    } else {
      const d = currentDomain(box);
      if (!d) return;
      const k = act === 'zoomin' ? 0.5 : 2;
      const cx = (d.x0 + d.x1) / 2, cy = (d.y0 + d.y1) / 2;
      const hx = ((d.x1 - d.x0) * k) / 2, hy = ((d.y1 - d.y0) * k) / 2;
      st.view = { x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy };
    }
    this.draw(box);
  }

  private onDblClick(e: MouseEvent): void {
    const box = (e.target as Element | null)?.closest?.('.dq-plot')?.closest<HTMLElement>('.dq-chartbox');
    if (!box) return;
    this.stateOf(box).view = undefined;
    this.draw(box);
  }

  private onOver(e: MouseEvent): void {
    const mark = (e.target as Element | null)?.closest?.('.dq-pt, .dq-bar') as SVGElement | null;
    const box = mark?.closest<HTMLElement>('.dq-chartbox');
    const tip = box?.querySelector<HTMLElement>('.dq-tip');
    if (!mark || !box || !tip || !mark.dataset.tip) return;
    tip.textContent = mark.dataset.tip;
    tip.style.borderColor = mark.getAttribute('fill') ?? '';
    tip.hidden = false;
    const m = mark.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const right = m.right - b.left + 10;
    const flip = right + tip.offsetWidth > box.clientWidth;
    tip.style.left = `${flip ? m.left - b.left - 10 - tip.offsetWidth : right}px`;
    tip.style.top = `${Math.max(0, m.top - b.top + m.height / 2 - tip.offsetHeight / 2)}px`;
  }

  private onOut(e: MouseEvent): void {
    const mark = (e.target as Element | null)?.closest?.('.dq-pt, .dq-bar');
    const tip = mark?.closest('.dq-chartbox')?.querySelector<HTMLElement>('.dq-tip');
    if (tip) tip.hidden = true;
  }

  private onDown(e: PointerEvent): void {
    const area = (e.target as Element | null)?.closest?.('.dq-area');
    const svg = area?.closest('svg') as SVGSVGElement | null;
    const box = svg?.closest<HTMLElement>('.dq-chartbox');
    if (!area || !svg || !box || e.button !== 0) return;
    e.preventDefault();
    const p = local(svg, e);
    const rect = this.doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('class', 'dq-drag');
    svg.appendChild(rect);
    this.drag = { box, svg, x: p.x, y: p.y, rect };
  }

  private onMove(e: PointerEvent): void {
    if (!this.drag) return;
    const { svg, x, y, rect } = this.drag;
    const p = clampToArea(svg, local(svg, e));
    rect.setAttribute('x', String(Math.min(x, p.x)));
    rect.setAttribute('y', String(Math.min(y, p.y)));
    rect.setAttribute('width', String(Math.abs(p.x - x)));
    rect.setAttribute('height', String(Math.abs(p.y - y)));
  }

  private onUp(e: PointerEvent): void {
    if (!this.drag) return;
    const { box, svg, x, y, rect } = this.drag;
    this.drag = undefined;
    rect.remove();
    const p = clampToArea(svg, local(svg, e));
    if (Math.abs(p.x - x) < MIN_DRAG || Math.abs(p.y - y) < MIN_DRAG) return;
    const d = currentDomain(box);
    const a = areaOf(svg);
    if (!d || !a) return;
    const dx = (px: number) => d.x0 + ((px - a.L) / a.PW) * (d.x1 - d.x0);
    const dy = (py: number) => d.y0 + ((a.T + a.PH - py) / a.PH) * (d.y1 - d.y0);
    this.stateOf(box).view = {
      x0: dx(Math.min(x, p.x)), x1: dx(Math.max(x, p.x)),
      y0: dy(Math.max(y, p.y)), y1: dy(Math.min(y, p.y)),
    };
    this.draw(box);
  }
}

const nums = (s: string | null | undefined) => (s ? s.split(',').map(Number) : null);

function currentDomain(box: Element): Domain | null {
  const v = nums(box.querySelector('svg.dq-chart')?.getAttribute('data-dom'));
  return v ? { x0: v[0], x1: v[1], y0: v[2], y1: v[3] } : null;
}

function areaOf(svg: SVGSVGElement) {
  const v = nums(svg.getAttribute('data-box'));
  return v ? { L: v[0], T: v[1], PW: v[2], PH: v[3] } : null;
}

/** Pointer position in SVG units (the drawn chart is 1:1 with CSS pixels). */
function local(svg: SVGSVGElement, e: MouseEvent) {
  const r = svg.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function clampToArea(svg: SVGSVGElement, p: { x: number; y: number }) {
  const a = areaOf(svg);
  if (!a) return p;
  return { x: Math.min(a.L + a.PW, Math.max(a.L, p.x)), y: Math.min(a.T + a.PH, Math.max(a.T, p.y)) };
}
