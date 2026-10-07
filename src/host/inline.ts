import { parseQuery, type Kind } from '../core/dsl';
import { renderInline, type ViewData } from '../core/view';
import { errorText } from './actions';
import type { Engine } from './engine';

interface SlotInfo { uuid: string; kind: Kind; dsl: string; gen: number }

/** Tracks rendered macro slots so DB changes can re-render them. */
export class InlineViews {
  private slots = new Map<string, SlotInfo>();
  private views = new Map<string, ViewData>();

  constructor(
    private engine: Engine,
    private provide: (slot: string, html: string) => void,
    private exists: (slot: string) => boolean,
  ) {}

  async show(slot: string, uuid: string, kind: Kind, dsl: string): Promise<void> {
    this.slots.set(slot, { uuid, kind, dsl, gen: 0 });
    await this.render(slot);
  }

  async refreshAll(): Promise<void> {
    for (const slot of [...this.slots.keys()]) {
      if (!this.exists(slot)) this.slots.delete(slot);
      else await this.render(slot);
    }
  }

  private async render(slot: string): Promise<void> {
    const info = this.slots.get(slot)!;
    const gen = ++info.gen;
    const { uuid, kind, dsl } = info;
    let html: string;
    let view: ViewData | undefined;
    try {
      const ev = await this.engine.evaluate(dsl, kind, uuid);
      html = renderInline({ kind, macroUuid: uuid, dsl, ...ev });
      if (ev.result && ev.parsed.ok) view = { kind, query: ev.parsed.query, result: ev.result };
    } catch (e) {
      console.error('[dataquery] could not render the query view', e);
      html = renderInline({ kind, macroUuid: uuid, dsl, parsed: parseQuery(dsl), error: errorText(e) });
    }
    // A slower render that started on older data must not overwrite a newer one.
    if (this.slots.get(slot) === info && info.gen === gen) {
      if (view) this.views.set(uuid, view);
      else this.views.delete(uuid);
      this.provide(slot, html);
    }
  }

  /** What the view of `uuid` last showed: rows, columns, axes and the query. */
  view(uuid: string): ViewData | undefined {
    return this.views.get(uuid);
  }
}
