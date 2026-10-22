import { dragAxis, formatTick, legendHtml, type ChartOpts, type Domain } from '../core/chart';
import { parseQuery } from '../core/dsl';
import { chartOf, errorHtml, tableToggleText, toCsv, type ViewData } from '../core/view';
import { Grid } from './grid';
import { TableTools, type TableDeps } from './tableTools';

export interface InteractDeps extends Pick<TableDeps, 'saveCell' | 'addColumn' | 'addRow' | 'setImg'> {
  /** Write a valid query back into the macro. */
  submit(uuid: string, dsl: string): Promise<void>;
  /** What the view of a macro last showed, to redraw its chart or copy its table. */
  view(uuid: string): ViewData | undefined;
  report(e: unknown): void;
  /** A short confirmation for the user. */
  notify(msg: string): void;
  /** A field of a view lost the focus: paint what was held back while it was being typed in. */
  resume?(): void;
  /**
   * A press is about to focus one of our fields. Logseq leaves a block's raw editing only through
   * its own outside-click handler, which never hears this press, so the host ends it here, while
   * the block's textarea still has the focus (Logseq ignores the request once it has not).
   */
  leaveEditing?(): void;
}

/** Fields typed into inside a view; a repaint would wipe them, so it waits until they are left. */
export const FIELD_SELECTOR = 'input.dq-dsl, input.dq-axin, input.dq-cellin, input.dq-keyin';

/**
 * Events a field keeps from Logseq. In Logseq 0.10.15 the block content's React handlers (at the
 * root) clear the DOM selection on mouseup while a block is selected, which takes the caret out of
 * the field so typing goes nowhere, and its mousedown and key handlers open or leave raw editing.
 * A listener on the window in the capture phase runs before all of them (the document's and the
 * root's), so these events stop there; nothing cancels their default, so the field still works.
 */
export const SHIELDED_EVENTS = [
  'keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend',
  'mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'selectstart', 'copy', 'cut', 'paste',
] as const;
/** Table cells a double-click or click turns into a field (cell value, new column name). */
const TABLE_CELLS = '.dq-tbl td[data-col], .dq-tbl th.dq-addcol';
const RELEASES = new Set(['mouseup', 'pointerup', 'click']);
/** Keyboard and clipboard events the table (`.dq-tbl`, focusable) keeps from Logseq while it has the focus. */
const GRID_EVENTS = new Set(['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend', 'copy', 'cut', 'paste']);

/**
 * What a chart shows besides the macro: zoom, enlarged, Ctrl+wheel scale and traces hidden by a
 * double-click. Kept per macro block, so it survives Logseq re-rendering the same view; `w` is the
 * last drawn width, so a re-render can paint at the right size straight away.
 */
interface ChartState { view?: Domain; big: boolean; scale: number; hidden: Set<string>; w?: number }

const HEIGHT = 360;
const MIN_DRAG = 6;
/** Pointer travel before an axis drag starts moving, so the clicks of a double-click do not nudge the range. */
const AXIS_SLOP = 3;
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
  /** Macro blocks whose table under the chart the user expanded. */
  private opened = new Set<string>();
  /** Macro blocks whose Cols ▾ list is open, so a repaint after a tick keeps it open. */
  private colsOpen = new Set<string>();
  private table: TableTools;
  private grid: Grid;
  /** Macro blocks whose view fills the window. */
  private full = new Set<string>();
  /** The one hover label, fixed-positioned in Logseq's <body> so no overflow box can clip it. */
  private tipEl?: HTMLElement;
  private observers = new WeakMap<Element, ResizeObserver>();
  private drag?: { box: HTMLElement; svg: SVGSVGElement; x: number; y: number; rect: SVGRectElement };
  private pan?: { el: HTMLElement; x: number };
  /** Where the last mouse press landed, to tell a click from a drag that ended elsewhere. */
  private pressed?: Element | null;
  /** A key handled in a field that then lost the focus: its keyup lands on the body, and is ours too. */
  private swallowKeyUp?: string;
  private axDrag?: { box: HTMLElement; ax: 'x' | 'y'; end: AxisEnd; d: Domain; a: NonNullable<ReturnType<typeof areaOf>>; from: { x: number; y: number }; cx: number; cy: number; moved: boolean };

  constructor(private doc: Document, private deps: InteractDeps) {
    this.table = new TableTools(doc, { ...deps, addRow: (m) => this.grid.addRowFor(m) });
    this.grid = new Grid(doc, deps, this.table, (tbl) => this.leaveFull(tbl.closest<HTMLElement>('.dq')));
  }

  install(): () => void {
    const on: Array<[string, (e: Event) => void, boolean]> = [
      // Capture phase: Logseq's block handlers (React 17, delegated at its root) stop the
      // propagation of mouseover and others, so a bubbling listener on the document never hears them.
      ['pointerdown', (e) => (this.pressed = e.target as Element | null), true],
      ['mousedown', (e) => this.onMouseDown(e as MouseEvent), true],
      ['focusout', (e) => this.onFocusOut(e as FocusEvent), true],
      ['click', (e) => this.onClick(e as MouseEvent), true],
      ['dblclick', (e) => this.onDblClick(e as MouseEvent), true],
      ['mousemove', (e) => this.grid.onMouseMove(e as MouseEvent), true],
      ['mouseup', () => this.grid.onMouseUp(), true],
      ['mouseover', (e) => this.onOver(e as MouseEvent), true],
      ['mouseout', (e) => this.onOut(e as MouseEvent), true],
      ['pointerdown', (e) => this.onDown(e as PointerEvent), false],
      ['pointermove', (e) => this.onMove(e as PointerEvent), false],
      ['pointerup', (e) => this.onUp(e as PointerEvent), false],
      // Middle button in a table pans it; on Linux its default would paste the primary selection
      // or start autoscroll, so those are stopped inside our tables.
      ['mousedown', (e) => this.stopMiddle(e as MouseEvent), true],
      ['mouseup', (e) => this.stopMiddle(e as MouseEvent), true],
      ['auxclick', (e) => this.stopMiddle(e as MouseEvent), true],
      // `error` doesn't bubble, so only a capture listener sees a table image that failed to load.
      ['error', (e) => this.onImgError(e), true],
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
    const win: EventTarget = this.doc.defaultView ?? this.doc;
    const shield = guard((e) => this.shield(e));
    for (const t of SHIELDED_EVENTS) win.addEventListener(t, shield, true);
    // Ctrl + wheel must cancel the browser/Logseq zoom, which a passive listener cannot do.
    const wheel = guard((e) => this.onWheel(e as WheelEvent));
    this.doc.addEventListener('wheel', wheel, { passive: false });
    return () => {
      for (const [t, f, cap] of bound) this.doc.removeEventListener(t, f, cap);
      for (const t of SHIELDED_EVENTS) win.removeEventListener(t, shield, true);
      this.doc.removeEventListener('wheel', wheel);
      this.tipEl?.remove();
      this.tipEl = undefined;
    };
  }

  /** Draw the charts under `slotId` at their real width once Logseq has inserted the new HTML. */
  attach(slotId: string, tries = 40): void {
    const views = [...(this.doc.getElementById(slotId)?.querySelectorAll<HTMLElement>('.dq:not([data-live])') ?? [])];
    if (!views.length) {
      if (tries > 0) setTimeout(() => this.attach(slotId, tries - 1), 25);
      return;
    }
    for (const view of views) {
      view.dataset.live = '1';
      const uuid = view.dataset.macro;
      const fold = view.querySelector<HTMLElement>('.dq-fold');
      if (fold && uuid) setFold(fold, this.opened.has(uuid));
      const cols = view.querySelector<HTMLDetailsElement>('.dq-cols');
      if (cols && uuid) cols.open = this.colsOpen.has(uuid);
      this.table.restore(view);
      this.grid.restore(view);
    }
    const boxes = views.flatMap((v) => [...v.querySelectorAll<HTMLElement>('.dq-chartbox:not([data-live])')]);
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

  /** Whether the view of `uuid` fills the window. */
  isFull(uuid: string): boolean {
    return this.full.has(uuid);
  }

  /** Whether the table under the chart of `uuid` is expanded. */
  tableOpen(uuid: string): boolean {
    return this.opened.has(uuid);
  }

  draw(box: HTMLElement): void {
    this.hideTip();
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
    plotEl.insertAdjacentHTML('afterend', legendHtml(chart.legend));
  }

  // ---- query field ----

  /** Window capture: events aimed at one of our fields are handled here and go no further. */
  private onMouseDown(e: MouseEvent): void {
    this.pressed = e.target as Element | null;
    // A press on a table cell may open a cell editor (double-click, `+`): leave another block's raw
    // editing now, while its textarea still has the focus, as a press on a field does.
    if (this.pressed?.closest?.(TABLE_CELLS)) this.deps.leaveEditing?.();
    this.grid.onMouseDown(e);
  }

  private shield(e: Event): void {
    if (e.type === 'keyup' && this.swallowKeyUp !== undefined && (e as KeyboardEvent).key === this.swallowKeyUp) {
      this.swallowKeyUp = undefined;
      return stopAll(e);
    }
    if (this.table.escBox(e as KeyboardEvent)) {
      this.swallowKeyUp = 'Escape';
      return stopAll(e);
    }
    const t = e.target as Element | null;
    // The focused table: keys and clipboard are its own; mouse events are not touched.
    const tbl = t?.matches?.('.dq-tbl') ? (t as HTMLElement) : null;
    if (tbl && GRID_EVENTS.has(e.type)) {
      if (e.type === 'keydown') {
        this.grid.onKey(e as KeyboardEvent, tbl);
        if (['Escape', 'Enter', 'Tab'].includes((e as KeyboardEvent).key)) this.swallowKeyUp = (e as KeyboardEvent).key;
      } else if (e.type === 'copy' || e.type === 'cut') this.grid.onCopy(e as ClipboardEvent, tbl, e.type === 'cut');
      else if (e.type === 'paste') this.grid.onPaste(e as ClipboardEvent, tbl);
      return stopAll(e);
    }
    // Esc leaves a full-screen view whatever has the focus in it.
    if (e.type === 'keydown' && (e as KeyboardEvent).key === 'Escape' && !t?.closest?.(FIELD_SELECTOR)) {
      const view = t?.closest?.<HTMLElement>('.dq-full') ?? (t === this.doc.body ? this.doc.querySelector<HTMLElement>('.dq-full') : null);
      if (view && this.leaveFull(view)) {
        this.swallowKeyUp = 'Escape';
        return stopAll(e);
      }
    }
    const inField = !!t?.closest?.(FIELD_SELECTOR);
    // A press in a field released outside it (selecting text past its end) is the field's too.
    const fromField = RELEASES.has(e.type) && !!this.pressed?.closest?.(FIELD_SELECTOR);
    if (!inField && !fromField) return;
    if (e.type === 'mousedown' || e.type === 'pointerdown') this.pressed = t;
    if (e.type === 'mousedown' && inField) this.deps.leaveEditing?.();
    if (e.type === 'keydown') this.onKey(e as KeyboardEvent);
    stopAll(e);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.table.onKey(e)) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab') this.swallowKeyUp = e.key;
      return;
    }
    const axIn = (e.target as Element | null)?.closest?.('input.dq-axin') as HTMLInputElement | null;
    if (axIn) return this.onAxisKey(axIn, e);
    const input = (e.target as Element | null)?.closest?.('input.dq-dsl') as HTMLInputElement | null;
    if (!input) return;
    if (e.isComposing || e.keyCode === 229) return; // IME confirmation, not a submit
    if (e.key === 'Escape') {
      // Only our field reverts: no raw editing, no block selection.
      e.preventDefault();
      this.swallowKeyUp = 'Escape';
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
      this.swallowKeyUp = 'Enter';
      // Leave the field first: while it has the focus, repaints (the saved query among them) wait.
      input.blur();
      this.deps.submit(input.dataset.macro!, dsl).catch((err) => this.deps.report(err));
    }
  }

  private onFocusOut(e: FocusEvent): void {
    this.table.onFocusOut(e);
    if ((e.target as Element | null)?.matches?.(FIELD_SELECTOR)) this.deps.resume?.();
  }

  private showError(input: HTMLInputElement, html: string): void {
    input.classList.toggle('dq-bad', !!html);
    const msg = input.closest('.dq')?.querySelector('.dq-msg');
    if (msg) msg.innerHTML = html;
  }

  // ---- chart ----

  private onClick(e: MouseEvent): void {
    const t = e.target as Element | null;
    // A press in a field released outside it (selecting text past its end) clicks their common
    // ancestor, whose nearest `data-on-click` is the view's "edit the block". It is no click: stop it
    // here, in the capture phase, before Logseq's delegation on the view hears it.
    const field = this.pressed?.closest?.('.dq input, .dq select, .dq textarea');
    if (field && t && !field.contains(t)) {
      e.stopPropagation();
      return;
    }
    if (this.table.onClick(e)) return;
    const summary = t?.closest?.('.dq-cols > summary') as HTMLElement | null;
    if (summary) return this.toggleCols(e, summary);
    const fold = t?.closest?.('.dq-fold [data-act="table"]') as HTMLElement | null;
    if (fold) return this.toggleTable(fold);
    const act = t?.closest?.('.dq-side [data-act]') as HTMLElement | null;
    if (act) return this.sideAction(act);
    const pt = t?.closest?.('.dq-pt') as SVGElement | null;
    if (pt) this.highlightRow(pt);
  }

  /** Cols ▾ opens and closes here (not natively), so its state is known and kept across repaints. */
  private toggleCols(e: MouseEvent, summary: HTMLElement): void {
    const det = summary.parentElement as HTMLDetailsElement;
    const uuid = det.closest<HTMLElement>('.dq')?.dataset.macro;
    e.preventDefault();
    det.open = !det.open;
    if (!uuid) return;
    if (det.open) this.colsOpen.add(uuid);
    else this.colsOpen.delete(uuid);
  }

  /** The table under a chart folds behind a one-line toggle; the choice is kept per block. */
  private toggleTable(btn: HTMLElement): void {
    const view = btn.closest<HTMLElement>('.dq');
    const fold = btn.closest<HTMLElement>('.dq-fold');
    const uuid = view?.dataset.macro;
    if (!fold || !uuid) return;
    if (!this.opened.delete(uuid)) this.opened.add(uuid);
    setFold(fold, this.opened.has(uuid));
  }

  /**
   * A point opens the table if folded, then marks its rows: those sharing its group key (every row
   * of its `color` group, or the merged `by` row), else the block's own row.
   */
  private highlightRow(pt: SVGElement): void {
    const { uuid, key } = pt.dataset;
    const view = pt.closest<HTMLElement>('.dq');
    if (!uuid || !view) return;
    const fold = view.querySelector<HTMLElement>('.dq-fold');
    if (fold && view.dataset.macro) {
      this.opened.add(view.dataset.macro);
      setFold(fold, true);
    }
    view.querySelectorAll('tr.dq-hl').forEach((tr) => tr.classList.remove('dq-hl'));
    const trs = [...view.querySelectorAll<HTMLElement>('tr[data-uuid]')];
    const byKey = key !== undefined ? trs.filter((r) => r.dataset.key === key) : [];
    const hit = byKey.length ? byKey : trs.filter((r) => r.dataset.uuid === uuid).slice(0, 1);
    if (!hit.length) return;
    for (const tr of hit) tr.classList.add('dq-hl');
    hit[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Buttons in the side column that change only what is on screen, not the macro. */
  private sideAction(btn: HTMLElement): void {
    const act = btn.dataset.act;
    if (act === 'csv') return this.copyCsv(btn);
    if (act === 'full') return this.toggleFull(btn.closest<HTMLElement>('.dq'));
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

  /** The view fills the window (⛶ or Esc to leave). A chart's folded table is opened, since it is what fills it. */
  private toggleFull(view: HTMLElement | null): void {
    const uuid = view?.dataset.macro;
    if (!view || !uuid) return;
    if (this.full.has(uuid)) {
      this.leaveFull(view);
      return;
    }
    this.full.add(uuid);
    view.classList.add('dq-full');
    const fold = view.querySelector<HTMLElement>('.dq-fold');
    if (fold) {
      this.opened.add(uuid);
      setFold(fold, true);
    }
  }

  /** True when the view was in full screen. */
  private leaveFull(view: HTMLElement | null): boolean {
    const uuid = view?.dataset.macro;
    if (!view || !uuid || !this.full.delete(uuid)) return false;
    view.classList.remove('dq-full');
    return true;
  }

  private copyCsv(btn: HTMLElement): void {
    const uuid = btn.closest<HTMLElement>('.dq-side')?.dataset.macro;
    const data = uuid ? this.deps.view(uuid) : undefined;
    if (!data) return this.deps.report(new Error('Nothing to copy yet: the view has not finished drawing.'));
    const n = data.result.rows.length;
    const fail = (cause: unknown) => this.deps.report(new Error('Could not copy the table as CSV.', { cause }));
    const clip = this.doc.defaultView?.navigator.clipboard;
    if (!clip) return fail(new Error('The clipboard is not available in this window.'));
    clip.writeText(toCsv(data.result, data.query.by, data.query.hide)).then(() => this.deps.notify(`${n} rows copied`), fail);
  }

  /** On a trace (legend entry, marker, line, band) it hides or shows that trace; elsewhere on the plot it resets the zoom. */
  private onDblClick(e: MouseEvent): void {
    if (this.table.onDblClick(e)) return;
    const t = e.target as Element | null;
    const box = t?.closest?.('.dq-chartbox') as HTMLElement | null;
    if (!box) return;
    // An axis strip: an end opens a box to type that end, the middle resets that axis only.
    const strip = t!.closest('.dq-axdrag') as SVGElement | null;
    if (strip) {
      e.preventDefault();
      const ax = strip.dataset.ax === 'y' ? 'y' : 'x';
      if (strip.dataset.end === '0' || strip.dataset.end === '1') this.openAxisInput(box, strip, ax, strip.dataset.end);
      else this.resetAxis(box, ax);
      return;
    }
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
    if (this.table.onWheel(e)) return;
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
    if (!mark?.closest('.dq-chartbox') || !mark.dataset.tip) return;
    const tip = this.tip();
    tip.textContent = mark.dataset.tip;
    // Colours are :root custom properties, so the trace colour resolves outside the view too.
    tip.style.background = mark.getAttribute('fill') ?? '';
    tip.hidden = false;
    const m = mark.getBoundingClientRect();
    const winW = this.doc.defaultView?.innerWidth ?? Infinity;
    const right = m.right + 10;
    const flip = right + tip.offsetWidth > winW;
    tip.style.left = `${flip ? m.left - 10 - tip.offsetWidth : right}px`;
    tip.style.top = `${Math.max(0, m.top + m.height / 2 - tip.offsetHeight / 2)}px`;
  }

  private onOut(e: MouseEvent): void {
    if ((e.target as Element | null)?.closest?.('.dq-pt, .dq-bar')) this.hideTip();
  }

  private tip(): HTMLElement {
    if (!this.tipEl?.isConnected) {
      this.tipEl = this.doc.createElement('div');
      this.tipEl.className = 'dq-tip';
      this.tipEl.hidden = true;
      this.doc.body.appendChild(this.tipEl);
    }
    return this.tipEl;
  }

  private hideTip(): void {
    if (this.tipEl) this.tipEl.hidden = true;
  }

  // ---- axis range box ----

  /** Plotly's double-click on an axis end: a text box over that end, prefilled like the ticks. */
  private openAxisInput(box: HTMLElement, strip: SVGElement, ax: 'x' | 'y', end: '0' | '1'): void {
    const svg = strip.closest('svg.dq-chart') as SVGSVGElement | null;
    const d = currentDomain(box);
    if (!svg || !d) return;
    box.querySelector('input.dq-axin')?.remove();
    const field = `${ax}${end}` as keyof Domain;
    const steps = nums(svg.getAttribute('data-step'));
    const step = steps?.[ax === 'x' ? 0 : 1] || Math.abs(d[field]) || 1;
    const input = this.doc.createElement('input');
    input.className = 'dq-axin';
    input.type = 'text';
    input.spellcheck = false;
    input.value = formatTick(d[field], step);
    input.dataset.ax = ax;
    input.dataset.end = end;
    input.setAttribute('aria-label', `${ax} axis ${end === '0' ? 'start' : 'end'}`);
    const s = strip.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    input.style.left = `${s.left - b.left + (ax === 'y' ? 2 : end === '0' ? 0 : s.width - 72)}px`;
    input.style.top = `${s.top - b.top + (ax === 'x' ? 2 : end === '1' ? 0 : s.height - 22)}px`;
    // Blur (clicking elsewhere) cancels.
    input.addEventListener('blur', () => input.remove());
    box.appendChild(input);
    input.focus();
    input.select();
  }

  private onAxisKey(input: HTMLInputElement, e: KeyboardEvent): void {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.swallowKeyUp = 'Escape';
      input.remove();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.swallowKeyUp = 'Enter';
      const box = input.closest<HTMLElement>('.dq-chartbox');
      const text = input.value.trim();
      const v = Number(text);
      input.remove();
      const d = box && currentDomain(box);
      // A typo or a range turned inside out changes nothing.
      if (!box || !d || !text || !isFinite(v)) return;
      const next = { ...d, [`${input.dataset.ax}${input.dataset.end}`]: v };
      if (next.x0 >= next.x1 || next.y0 >= next.y1) return;
      this.stateOf(box).view = next;
      this.draw(box);
    }
  }

  /** Back to the automatic range on one axis, keeping the other as it is. */
  private resetAxis(box: HTMLElement, ax: 'x' | 'y'): void {
    const st = this.stateOf(box);
    const data = this.deps.view(box.dataset.macro!);
    const w = box.querySelector<HTMLElement>('.dq-plot')?.clientWidth ?? 0;
    if (!st.view || !data || w <= 0) return;
    const auto = /data-dom="([^"]+)"/.exec(chartOf(data, { ...this.optsOf(st, w), view: undefined })?.html ?? '');
    const a = nums(auto?.[1]);
    if (!a) return;
    st.view = ax === 'x' ? { ...st.view, x0: a[0], x1: a[1] } : { ...st.view, y0: a[2], y1: a[3] };
    this.draw(box);
  }

  // ---- table pan ----

  /** A table image that failed to load shows as a marked box naming the URL it tried, so the cause is visible. */
  private onImgError(e: Event): void {
    const img = e.target as HTMLImageElement | null;
    if (!img || img.tagName !== 'IMG' || !img.classList.contains('dq-img')) return;
    img.classList.add('dq-img-broken');
    const src = img.getAttribute('src') ?? '';
    let shown = src;
    try {
      shown = decodeURI(src);
    } catch {
      // A malformed %-escape: show the URL as written.
    }
    img.title = `Image not found: ${shown}`;
  }

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
    this.axDrag = { box, ax, end, d, a, from: local(svg, e), cx: e.clientX, cy: e.clientY, moved: false };
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
      if (!this.axDrag.moved && Math.abs(e.clientX - cx) < AXIS_SLOP && Math.abs(e.clientY - cy) < AXIS_SLOP) return;
      this.axDrag.moved = true;
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

function stopAll(e: Event): void {
  e.stopPropagation();
  e.stopImmediatePropagation();
}

const nums = (s: string | null | undefined) => (s ? s.split(',').map(Number) : null);

function setFold(fold: HTMLElement, open: boolean): void {
  fold.classList.toggle('dq-open', open);
  const btn = fold.querySelector<HTMLElement>('[data-act="table"]');
  if (!btn) return;
  btn.setAttribute('aria-expanded', String(open));
  btn.textContent = tableToggleText(open, Number(fold.dataset.n ?? 0));
}

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
