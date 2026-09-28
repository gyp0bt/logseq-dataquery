import { parseDsl } from '../core/dsl';
import { renderInline } from '../core/view';
import { errorText } from './actions';
import type { Engine } from './engine';

interface SlotInfo { uuid: string; dsl: string; gen: number }

/** Tracks rendered macro slots so DB changes can re-render them. */
export class InlineViews {
  private slots = new Map<string, SlotInfo>();

  constructor(
    private engine: Engine,
    private provide: (slot: string, html: string) => void,
    private exists: (slot: string) => boolean,
  ) {}

  async show(slot: string, uuid: string, dsl: string): Promise<void> {
    this.slots.set(slot, { uuid, dsl, gen: 0 });
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
    const { uuid, dsl } = info;
    let html: string;
    try {
      html = renderInline({ macroUuid: uuid, dsl, ...(await this.engine.evaluate(dsl, uuid)) });
    } catch (e) {
      console.error('[dataquery] could not render the query view', e);
      html = renderInline({ macroUuid: uuid, dsl, parsed: parseDsl(dsl), error: errorText(e) });
    }
    // A slower render that started on older data must not overwrite a newer one.
    if (this.slots.get(slot) === info && info.gen === gen) this.provide(slot, html);
  }
}
