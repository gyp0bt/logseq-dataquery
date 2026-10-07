import { dragAxis, legendHtml, type ChartOpts, type Domain } from '../core/chart';
import { parseQuery } from '../core/dsl';
import { chartOf, errorHtml, toCsv, type ViewData } from '../core/view';

export interface InteractDeps {
  /** Write a valid query back into the macro. */
  submit(uuid: string, dsl: string): Promise<void>;
  /** What the view of a macro last showed, to redraw its chart or copy its table. */
  view(uuid: string): ViewData | undefined;
  report(e: unknown): void;
  /** A short confirmation for the user. */
  notify(msg: string): void;
}

/**
 * What a chart shows besides the macro: zoom, enlarged, Ctrl+wheel scale and traces hidden by a
 * double-click. Kept per macro block, so it survives Logseq re-rendering the same view; `w` is the
 * last drawn width, so a re-render can paint at the right size straight away.
 */
interface ChartState { view?: Domain; big: boolean; scale: number; hidden: Set<string>; w?: number }

const HEIGHT = 360;
const MIN_DRAG = 6;
const SCALE_STEP = 1.1;
const clampScale = (s: number) => Math.min(3, Math.max(0.5, Math.round(s * 1000) / 1000));
type AxisEnd = '0' | '1' | 'pan';

/**
 * Behaviour Logseq's `data-on-*` delegation cannot give: it forwards no key names and no pointer
 * movement. The plugin runs in a same-origin iframe, so these listeners live on Logseq's document
 * and act only on elements inside our views.
 */
export class Interact {
  private state = new Map<string, ChartState>();
  private observers = new WeakMap<Element, ResizeObserver>();
  private drag?: { box: HTMLElement; svg: SVGSVGElement; x: number; y: number; rect: SVGRectElement };
  private pan?: { el: HTMLElement; x: number };
  private axDrag?: { box: HTMLElement; ax: 'x' | 'y'; end: AxisEnd; d: Domain; a: NonNullable<ReturnType<typeof areaOf>>; from: { x: number; y: number }; cx: number; cy: number };

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
      // Middle button in a table pans it; on Linux its default would paste the primary selection
      // or start autoscroll, so those are stopped inside our tables.
      ['mousedown', (e) => this.stopMiddle(e as MouseEvent), true],
      ['mouseup', (e) => this.stopMiddle(e as MouseEvent), true],
      ['auxclick', (e) => this.stopMiddle(e as MouseEvent), true],
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
    // Ctrl + wheel must cancel the browser/Logseq zoom, which a passive listener cannot do.
    const wheel = guard((e) => this.onWheel(e as WheelEvent));
    this.doc.addEventListener('wheel', wheel, { passive: false });
    return () => {
      for (const [t, f, cap] of bound) this.doc.removeEventListener(t, f, cap);
      this.doc.removeEventListener('wheel', wheel);
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
      // The view was painted at its last size and state already; redraw only if the width moved.
      const plotEl = box.querySelector<HTMLElement>('.dq-plot');
      const drawnW = plotEl?.querySelector('svg.dq-chart')?.getAttribute('data-w');
      if (!plotEl || drawnW === null || drawnW === undefined || Number(drawnW) !== plotEl.clientWidth) this.draw(box);
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
    if (!this.state.has(uuid)) this.state.set(uuid, { big: false, scale: 1, hidden: new Set() });
    return this.state.get(uuid)!;
  }

  private optsOf(st: ChartState, w: number): ChartOpts {
    const winH = this.doc.defaultView?.innerHeight ?? 800;
    const h = st.big ? Math.max(HEIGHT, Math.round(winH * 0.7)) : HEIGHT;
    return { size: { w, h }, view: st.view, scale: st.scale, hidden: [...st.hidden] };
  }

  /** How to paint the chart of `uuid` on a re-render: its last width and transient state. */
  optsFor(uuid: string): ChartOpts | undefined {
    const st = this.state.get(uuid);
    return st?.w ? this.optsOf(st, st.w) : undefined;
  }

  draw(box: HTMLElement): void {
    const data = this.deps.view(box.dataset.macro!);
    const plotEl = box.querySelector<HTMLElement>('.dq-plot');
    const w = plotEl?.clientWidth ?? 0;
    if (!data || !plotEl || w <= 0) return;
    const st = this.stateOf(box);
    st.w = w;
    const chart = chartOf(data, this.optsOf(st, w));
    if (!chart) return;
    // Keep the horizontal scroll of a wide bar chart across redraws.
    const left = plotEl.scrollLeft;
    plotEl.innerHTML = chart.html;
    plotEl.scrollLeft = left;
    // The legend shows hidden traces greyed and follows the scale, so it is redrawn too.
    box.querySelector('.dq-legend')?.remove();
    plotEl.insertAdjacentHTML('afterend', legendHtml(chart.legend, st.scale));
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
      const parsed = parseQuery(dsl);
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
    const act = t?.closest?.('.dq-side [data-act]') as HTMLElement | null;
    if (act) return this.sideAction(act);
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

  /** Buttons in the side column that change only what is on screen, not the macro. */
  private sideAction(btn: HTMLElement): void {
    const act = btn.dataset.act;
    if (act === 'csv') return this.copyCsv(btn);
    const box = btn.closest('.dq')?.querySelector<HTMLElement>('.dq-chartbox');
    if (!box) return;
    const st = this.stateOf(box);
    if (act === 'expand') {
      st.big = !st.big;
      box.classList.toggle('dq-big', st.big);
    } else if (act === 'reset') {
      st.view = undefined;
      st.hidden.clear();
    }
    this.draw(box);
  }

  private copyCsv(btn: HTMLElement): void {
    const uuid = btn.closest<HTMLElement>('.dq-side')?.dataset.macro;
    const data = uuid ? this.deps.view(uuid) : undefined;
    if (!data) return this.deps.report(new Error('Nothing to copy yet: the view has not finished drawing.'));
    const n = data.result.rows.length;
    const fail = (cause: unknown) => this.deps.report(new Error('Could not copy the table as CSV.', { cause }));
    const clip = this.doc.defaultView?.navigator.clipboard;
    if (!clip) return fail(new Error('The clipboard is not available in this window.'));
    clip.writeText(toCsv(data.result, data.query.by)).then(() => this.deps.notify(`${n} rows copied`), fail);
  }

  /** On a trace (legend entry, marker, line, band) it hides or shows that trace; elsewhere on the plot it resets the zoom. */
  private onDblClick(e: MouseEvent): void {
    const t = e.target as Element | null;
    const box = t?.closest?.('.dq-chartbox') as HTMLElement | null;
    if (!box) return;
    const trace = (t!.closest('[data-trace]') as HTMLElement | SVGElement | null)?.dataset.trace;
    const st = this.stateOf(box);
    if (trace !== undefined) {
      if (!st.hidden.delete(trace)) st.hidden.add(trace);
    } else if (t!.closest('.dq-plot')) st.view = undefined;
    else return;
    this.draw(box);
  }

  /** Ctrl + wheel over a chart scales markers, lines and fonts; a plain wheel scrolls the page as usual. */
  private onWheel(e: WheelEvent): void {
    if (!e.ctrlKey || !e.deltaY) return;
    const box = (e.target as Element | null)?.closest?.('.dq-chartbox') as HTMLElement | null;
    if (!box) return;
    e.preventDefault();
    const st = this.stateOf(box);
    st.scale = clampScale(st.scale * (e.deltaY < 0 ? SCALE_STEP : 1 / SCALE_STEP));
    this.draw(box);
  }

  private onOver(e: MouseEvent): void {
    const mark = (e.target as Element | null)?.closest?.('.dq-pt, .dq-bar') as SVGElement | null;
    const box = mark?.closest<HTMLElement>('.dq-chartbox');
    const tip = box?.querySelector<HTMLElement>('.dq-tip');
    if (!mark || !box || !tip || !mark.dataset.tip) return;
    tip.textContent = mark.dataset.tip;
    tip.style.background = mark.getAttribute('fill') ?? '';
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

  // ---- table pan ----

  private stopMiddle(e: MouseEvent): void {
    if (e.button === 1 && (e.target as Element | null)?.closest?.('.dq-tbl')) e.preventDefault();
  }

  private startPan(e: PointerEvent): boolean {
    const el = e.button === 1 ? ((e.target as Element | null)?.closest?.('.dq-tbl') as HTMLElement | null) : null;
    if (!el) return false;
    e.preventDefault();
    el.style.cursor = 'grabbing';
    this.pan = { el, x: e.clientX };
    return true;
  }

  private endPan(): void {
    if (this.pan) this.pan.el.style.cursor = '';
    this.pan = undefined;
  }

  // ---- drag zoom ----

  private startAxisDrag(e: PointerEvent): boolean {
    const hit = (e.target as Element | null)?.closest?.('.dq-axdrag') as SVGElement | null;
    const svg = hit?.closest('svg.dq-chart') as SVGSVGElement | null;
    const box = svg?.closest<HTMLElement>('.dq-chartbox');
    if (!hit || !svg || !box || e.button !== 0) return false;
    const d = currentDomain(box);
    const a = areaOf(svg);
    if (!d || !a) return false;
    e.preventDefault();
    const ax = hit.dataset.ax === 'y' ? 'y' : 'x';
    const end = (['0', '1', 'pan'] as const).find((x) => x === hit.dataset.end) ?? 'pan';
    this.axDrag = { box, ax, end, d, a, from: local(svg, e), cx: e.clientX, cy: e.clientY };
    return true;
  }

  private onDown(e: PointerEvent): void {
    if (this.startPan(e) || this.startAxisDrag(e)) return;
    // Bands and lines lie over the plot area (they take double-clicks); a drag may start on them too.
    const area = (e.target as Element | null)?.closest?.('.dq-area, .dq-band, .dq-line, .dq-err');
    const svg = area?.closest('svg.dq-chart') as SVGSVGElement | null;
    const box = svg?.closest<HTMLElement>('.dq-chartbox');
    // Only scatter plots record a domain to zoom into.
    if (!area || !svg || !box || e.button !== 0 || !svg.hasAttribute('data-dom')) return;
    e.preventDefault();
    const p = local(svg, e);
    const rect = this.doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('class', 'dq-drag');
    svg.appendChild(rect);
    this.drag = { box, svg, x: p.x, y: p.y, rect };
  }

  private onMove(e: PointerEvent): void {
    if (this.pan) {
      // The button was released outside the window: stop following the pointer.
      if (!(e.buttons & 4)) return this.endPan();
      // Sideways only, and the table moves against the pointer (like dragging a scrollbar thumb).
      const { el, x } = this.pan;
      el.scrollLeft += e.clientX - x;
      this.pan = { el, x: e.clientX };
      return;
    }
    if (this.axDrag) {
      const { box, ax, end, d, a, from, cx, cy } = this.axDrag;
      const to = { x: from.x + e.clientX - cx, y: from.y + e.clientY - cy };
      this.stateOf(box).view = dragAxis(d, a, ax, end, from, to);
      this.draw(box);
      return;
    }
    if (!this.drag) return;
    const { svg, x, y, rect } = this.drag;
    const p = clampToArea(svg, local(svg, e));
    rect.setAttribute('x', String(Math.min(x, p.x)));
    rect.setAttribute('y', String(Math.min(y, p.y)));
    rect.setAttribute('width', String(Math.abs(p.x - x)));
    rect.setAttribute('height', String(Math.abs(p.y - y)));
  }

  private onUp(e: PointerEvent): void {
    if (this.pan) return this.endPan();
    if (this.axDrag) {
      this.axDrag = undefined;
      return;
    }
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
