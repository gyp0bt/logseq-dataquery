import { cardTitle, type Card } from '../core/cards';
import { cardOrder, cardsHtml } from '../core/cardsView';
import { cardsNotes, parseQuery } from '../core/dsl';
import type { AssetScheme } from '../core/images';
import { StaleSnippet, type CardCopier, type CopyTarget } from './cardCopy';

export interface CardViewsDeps {
  fetch(refs: string[], macroUuid: string): Promise<Card[]>;
  copier: Pick<CardCopier, 'copy'>;
  provide(slot: string, html: string): void;
  exists(slot: string): boolean;
  /** Write the query typed into the view back into the macro. */
  save(uuid: string, dsl: string): Promise<void>;
  /** Hand the keys back to Logseq with the macro block selected. */
  selectBlock(uuid: string): void;
  openUrl?(url: string): void;
  report(e: unknown): void;
  graphPath?(): string | undefined;
  assetScheme?(): AssetScheme;
}

/** What a view remembers between paints (Logseq redraws the block on every copy count). */
interface CardState {
  dsl: string;
  cards: Card[];
  order: string[];
  selected?: string;
  filter: string;
  notes: string[];
  error?: string;
  toast?: { text: string; until: number };
  scroll: { list: number; pv: number };
}

type Focus = { field: 'q' | 'filter'; caret: number } | { snip: string } | 'root' | null;

const TOAST_MS = 1500;
const MOUSE = ['mousedown', 'mouseup', 'click', 'dblclick'] as const;

/** The DQcards views: one state per macro block, painted into each slot that shows it. */
export class CardViews {
  private slots = new Map<string, string>();
  private states = new Map<string, CardState>();
  private last = new Map<string, string>();
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private off: Array<() => void> = [];

  constructor(private doc: Document, private deps: CardViewsDeps) {
    const on = <K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void) => {
      doc.addEventListener(type, fn as EventListener, true);
      this.off.push(() => doc.removeEventListener(type, fn as EventListener, true));
    };
    on('keydown', (e) => this.onKey(e));
    on('input', (e) => this.onInput(e));
    for (const t of MOUSE) on(t, (e) => this.onMouse(e as MouseEvent));
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off = [];
    clearTimeout(this.toastTimer);
  }

  /** Logseq (re)created the slot: read the cards and order them afresh. */
  async show(slot: string, uuid: string, dsl: string): Promise<void> {
    this.slots.set(slot, uuid);
    const st = this.states.get(uuid) ?? { dsl, cards: [], order: [], filter: '', notes: [], scroll: { list: 0, pv: 0 } };
    st.dsl = dsl;
    this.states.set(uuid, st);
    await this.load(uuid, true);
    this.paintUuid(uuid);
  }

  /** The graph changed: new counts and contents, the order on screen stays. */
  async refreshAll(): Promise<void> {
    for (const [slot] of [...this.slots]) if (!this.deps.exists(slot)) this.slots.delete(slot);
    for (const uuid of new Set(this.slots.values())) {
      await this.load(uuid, false);
      this.paintUuid(uuid);
    }
  }

  private async load(uuid: string, reorder: boolean): Promise<void> {
    const st = this.states.get(uuid)!;
    st.notes = cardsNotes(st.dsl);
    const parsed = parseQuery(st.dsl);
    if (!parsed.ok) {
      st.error = parsed.error.message;
      return;
    }
    try {
      st.cards = await this.deps.fetch(parsed.query.refs, uuid);
      st.error = undefined;
    } catch (e) {
      console.warn('[dataquery] could not read the cards', e);
      st.error = e instanceof Error ? e.message : String(e);
      return;
    }
    const fresh = cardOrder(st.cards, parsed.query.sort);
    if (reorder || !st.order.length) st.order = fresh;
    else {
      // Keep what is on screen still; blocks tagged meanwhile go last.
      const have = new Set(fresh);
      const kept = st.order.filter((u) => have.has(u));
      const seen = new Set(kept);
      st.order = kept.concat(fresh.filter((u) => !seen.has(u)));
    }
  }

  private reorder(uuid: string): void {
    const st = this.states.get(uuid)!;
    const parsed = parseQuery(st.dsl);
    st.order = cardOrder(st.cards, parsed.ok ? parsed.query.sort : undefined);
  }

  private viewOf(el: EventTarget | null): { root: HTMLElement; uuid: string; st: CardState } | null {
    const root = (el as Element | null)?.closest?.<HTMLElement>('.dqc');
    const uuid = root?.dataset.uuid;
    const st = uuid ? this.states.get(uuid) : undefined;
    return root && uuid && st ? { root, uuid, st } : null;
  }

  private slotEl(slot: string): HTMLElement | null {
    return this.doc.getElementById(slot);
  }

  private focusOf(slot: string): Focus {
    const el = this.slotEl(slot);
    const a = this.doc.activeElement as HTMLElement | null;
    if (!el || !a || !el.contains(a)) return null;
    if (a.matches('input.dqc-q, input.dqc-filter'))
      return { field: a.classList.contains('dqc-q') ? 'q' : 'filter', caret: (a as HTMLInputElement).selectionStart ?? 0 };
    if (a.dataset.snip !== undefined) return { snip: a.dataset.snip };
    return a.matches('.dqc') ? 'root' : null;
  }

  private paintUuid(uuid: string, focus?: Focus): void {
    for (const [slot, u] of this.slots) if (u === uuid) this.paint(slot, focus);
  }

  private paint(slot: string, focus: Focus = this.focusOf(slot)): void {
    const uuid = this.slots.get(slot)!;
    const st = this.states.get(uuid)!;
    const old = this.slotEl(slot)?.querySelector<HTMLElement>('.dqc') ?? null;
    if (old) {
      st.scroll = {
        list: old.querySelector<HTMLElement>('.dqc-list')?.scrollTop ?? st.scroll.list,
        pv: old.querySelector<HTMLElement>('.dqc-pv')?.scrollTop ?? st.scroll.pv,
      };
    }
    const html = cardsHtml({
      uuid, dsl: st.dsl, cards: st.cards, order: st.order, selected: st.selected, filter: st.filter,
      notes: st.notes, error: st.error, graphPath: this.deps.graphPath?.(), assetScheme: this.deps.assetScheme?.(),
    });
    if (html === this.last.get(slot) && old) return this.restore(slot, st, focus);
    this.last.set(slot, html);
    this.deps.provide(slot, html);
    this.afterPaint(slot, old, () => this.restore(slot, st, focus));
  }

  /** Logseq puts the new HTML in asynchronously; wait (a few frames at most) until the slot holds it. */
  private afterPaint(slot: string, old: HTMLElement | null, fn: () => void, tries = 20): void {
    const now = this.slotEl(slot)?.querySelector<HTMLElement>('.dqc');
    if ((now && now !== old) || tries <= 0) return fn();
    setTimeout(() => this.afterPaint(slot, old, fn, tries - 1), 16);
  }

  private restore(slot: string, st: CardState, focus: Focus): void {
    const root = this.slotEl(slot)?.querySelector<HTMLElement>('.dqc');
    if (!root) return;
    const list = root.querySelector<HTMLElement>('.dqc-list');
    const pv = root.querySelector<HTMLElement>('.dqc-pv');
    if (list) list.scrollTop = st.scroll.list;
    if (pv) pv.scrollTop = st.scroll.pv;
    if (focus === 'root') root.focus();
    else if (focus && 'field' in focus) {
      const f = root.querySelector<HTMLInputElement>(focus.field === 'q' ? 'input.dqc-q' : 'input.dqc-filter');
      f?.focus();
      f?.setSelectionRange(focus.caret, focus.caret);
    } else if (focus && 'snip' in focus) root.querySelector<HTMLElement>(`[data-snip="${focus.snip}"]`)?.focus();
    const toast = root.querySelector<HTMLElement>('.dqc-toast');
    if (toast && st.toast && st.toast.until > Date.now()) {
      toast.textContent = st.toast.text;
      toast.classList.add('show');
    }
  }

  private toast(uuid: string, text: string): void {
    const st = this.states.get(uuid);
    if (!st) return;
    st.toast = { text, until: Date.now() + TOAST_MS };
    for (const [slot, u] of this.slots) {
      if (u !== uuid) continue;
      const t = this.slotEl(slot)?.querySelector<HTMLElement>('.dqc-toast');
      if (t) {
        t.textContent = text;
        t.classList.add('show');
      }
    }
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      for (const t of this.doc.querySelectorAll('.dqc-toast.show')) t.classList.remove('show');
    }, TOAST_MS);
  }

  private shownRows(root: HTMLElement): string[] {
    return [...root.querySelectorAll<HTMLElement>('li.dqc-row')].map((r) => r.dataset.card!);
  }

  private selectedOf(root: HTMLElement): string | undefined {
    return root.querySelector<HTMLElement>('section.dqc-pv')?.dataset.card;
  }

  private select(uuid: string, card: string, focus: Focus): void {
    const st = this.states.get(uuid)!;
    if (st.selected === card) return;
    st.selected = card;
    st.scroll.pv = 0;
    this.paintUuid(uuid, focus);
    for (const [slot, u] of this.slots)
      if (u === uuid) [...(this.slotEl(slot)?.querySelectorAll<HTMLElement>('li.dqc-row') ?? [])].find((r) => r.dataset.card === card)?.scrollIntoView?.({ block: 'nearest' });
  }

  private copy(uuid: string, card: string, target: CopyTarget): void {
    const st = this.states.get(uuid);
    const c = st?.cards.find((x) => x.root.uuid === card);
    const title = c ? cardTitle(c.root) : '';
    this.deps.copier.copy(card, target).then(
      (n) => this.toast(uuid, `コピーしました（${title}・${n} 回目）`),
      async (e) => {
        if (!(e instanceof StaleSnippet)) return this.deps.report(e);
        this.toast(uuid, e.message);
        await this.load(uuid, false);
        this.paintUuid(uuid);
      },
    );
  }

  private snipTarget(el: HTMLElement): CopyTarget {
    return { kind: el.dataset.kind as 'code' | 'image' | 'link', index: Number(el.dataset.snip), id: el.dataset.id! };
  }

  private onMouse(e: MouseEvent): void {
    const v = this.viewOf(e.target);
    if (!v) return;
    // Inside the view a press must not open the macro block for editing.
    e.stopPropagation();
    const t = e.target as HTMLElement;
    if (e.type === 'click') {
      const link = t.closest<HTMLAnchorElement>('a.dq-url');
      if (link) {
        e.preventDefault();
        if (link.dataset.href) this.deps.openUrl?.(link.dataset.href);
        return;
      }
      const btn = t.closest<HTMLElement>('button.dqc-copy');
      const snip = btn?.closest<HTMLElement>('[data-snip]');
      const card = this.selectedOf(v.root);
      if (snip && card) return this.copy(v.uuid, card, this.snipTarget(snip));
      if (t.closest('button.dqc-whole') && card) return this.copy(v.uuid, card, 'whole');
      const row = t.closest<HTMLElement>('li.dqc-row');
      if (row?.dataset.card) {
        if (v.st.selected !== row.dataset.card && this.selectedOf(v.root) !== row.dataset.card) this.select(v.uuid, row.dataset.card, 'root');
        else v.st.selected = row.dataset.card;
      }
    } else if (e.type === 'dblclick') {
      const row = t.closest<HTMLElement>('li.dqc-row');
      if (row?.dataset.card) this.copy(v.uuid, row.dataset.card, 'whole');
    }
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (!t.matches?.('input.dqc-filter')) return;
    const v = this.viewOf(t);
    if (!v) return;
    v.st.filter = t.value;
    this.reorder(v.uuid);
    v.st.scroll.list = 0;
    this.paintUuid(v.uuid, { field: 'filter', caret: t.selectionStart ?? t.value.length });
  }

  private onKey(e: KeyboardEvent): void {
    const v = this.viewOf(e.target);
    if (!v || e.isComposing) return;
    const t = e.target as HTMLElement;
    if (t.matches('input.dqc-q')) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const dsl = (t as HTMLInputElement).value.trim();
        this.deps.save(v.uuid, dsl).catch(this.deps.report);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        v.root.focus();
      }
      return;
    }
    if (t.matches('input.dqc-filter')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        v.root.focus();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    const card = this.selectedOf(v.root);
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        const rows = this.shownRows(v.root);
        const i = card ? rows.indexOf(card) : -1;
        const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        done();
        if (next) this.select(v.uuid, next, 'root');
        return;
      }
      case 'Tab': {
        const snips = [...v.root.querySelectorAll<HTMLElement>('section.dqc-pv [data-snip]')];
        if (!snips.length) return done();
        const i = snips.indexOf(t);
        const n = i < 0 ? (e.shiftKey ? snips.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + snips.length) % snips.length;
        done();
        snips[n].focus();
        return;
      }
      case 'Enter':
        done();
        if (!card) return;
        if (t.dataset.snip !== undefined) this.copy(v.uuid, card, this.snipTarget(t));
        else this.copy(v.uuid, card, 'whole');
        return;
      case 'Escape':
        done();
        v.root.blur();
        this.deps.selectBlock(v.uuid);
        return;
    }
  }
}
