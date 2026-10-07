import type { ChartOpts } from '../core/chart';
import { parseQuery, type Kind } from '../core/dsl';
import { renderInline, type InlineInput, type ViewData } from '../core/view';
import { errorText } from './actions';
import type { Engine } from './engine';

interface SlotInfo { uuid: string; kind: Kind; dsl: string; gen: number; last?: string; held?: boolean }

export interface InlineHooks {
  /** The query as the block holds it now; a refresh re-reads it so a stale slot query does not stick. */
  readDsl?(uuid: string): Promise<string>;
  /** Size and transient state (zoom, scale, hidden traces) to draw a chart at on first paint. */
  chartOpts?(uuid: string): ChartOpts | undefined;
  /** Whether the user expanded the table under the chart of `uuid` (transient, kept by the host). */
  tableOpen?(uuid: string): boolean;
  /** Whether the slot still shows our last paint; an emptied slot is painted again even if unchanged. */
  painted?(slot: string): boolean;
  /**
   * Whether the user is typing in a field of the slot's view. Painting replaces the view's HTML,
   * which would drop the focus and the half-typed text, so the repaint waits for `resume()`.
   */
  busy?(slot: string): boolean;
}

/** Tracks rendered macro slots so DB changes can re-render them. */
export class InlineViews {
  private slots = new Map<string, SlotInfo>();
  private views = new Map<string, ViewData>();

  constructor(
    private engine: Engine,
    private provide: (slot: string, html: string) => void,
    private exists: (slot: string) => boolean,
    private hooks: InlineHooks = {},
  ) {}

  /** Logseq (re)created the slot: it is empty, so it is always painted. */
  async show(slot: string, uuid: string, kind: Kind, dsl: string): Promise<void> {
    this.slots.set(slot, { uuid, kind, dsl, gen: 0 });
    await this.render(slot, false);
  }

  /** Paint what was held back while a field had the focus (called when the field is left). */
  async resume(): Promise<void> {
    for (const [slot, info] of [...this.slots]) {
      if (!info.held) continue;
      if (!this.exists(slot)) this.slots.delete(slot);
      else await this.render(slot, true);
    }
  }

  async refreshAll(): Promise<void> {
    for (const slot of [...this.slots.keys()]) {
      if (!this.exists(slot)) this.slots.delete(slot);
      else await this.render(slot, true);
    }
  }

  private async render(slot: string, reread: boolean): Promise<void> {
    const info = this.slots.get(slot)!;
    const gen = ++info.gen;
    const { uuid, kind } = info;
    if (reread && this.hooks.readDsl) {
      try {
        info.dsl = await this.hooks.readDsl(uuid);
      } catch (e) {
        console.warn('[dataquery] could not re-read the macro text; keeping the last query', e);
      }
    }
    const dsl = info.dsl;
    let input: InlineInput;
    let view: ViewData | undefined;
    try {
      const ev = await this.engine.evaluate(dsl, kind, uuid);
      input = { kind, macroUuid: uuid, dsl, ...ev };
      if (ev.result && ev.parsed.ok) view = { kind, query: ev.parsed.query, result: ev.result };
    } catch (e) {
      console.error('[dataquery] could not render the query view', e);
      input = { kind, macroUuid: uuid, dsl, parsed: parseQuery(dsl), error: errorText(e) };
    }
    // A slower render that started on older data must not overwrite a newer one.
    if (this.slots.get(slot) !== info || info.gen !== gen) return;
    if (view) this.views.set(uuid, view);
    else this.views.delete(uuid);
    // The data alone decides whether anything changed; the chart size and zoom are the host's.
    const key = renderInline(input);
    // A macro rewrite both re-slots the macro and fires a DB change: paint once, not twice.
    if (info.last === key && (this.hooks.painted?.(slot) ?? true)) return;
    if (this.hooks.busy?.(slot)) {
      info.held = true;
      return;
    }
    info.held = false;
    info.last = key;
    const opts = this.hooks.chartOpts?.(uuid);
    const open = this.hooks.tableOpen?.(uuid) ?? false;
    this.provide(slot, opts || open ? renderInline({ ...input, chartOpts: opts, tableOpen: open }) : key);
  }

  /** What the view of `uuid` last showed: rows, columns, axes and the query. */
  view(uuid: string): ViewData | undefined {
    return this.views.get(uuid);
  }
}
