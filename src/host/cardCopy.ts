import { cardSnippets, readCopies, wholeText, type SnippetKind } from '../core/cards';
import type { LogseqLike } from './api';
import { toCardNode } from './cardsFetch';

/** What a press copies: the whole card, or one snippet as the preview drew it. */
export type CopyTarget = 'whole' | { kind: SnippetKind; index: number; id: string };

export interface CardCopyDeps {
  writeText(text: string): Promise<void>;
  /** Put the picture at `src` (as written in the block) on the clipboard as PNG; rejects when it cannot. */
  writeImage(src: string): Promise<void>;
}

/** The block no longer holds what the preview showed at that place: nothing was copied. */
export class StaleSnippet extends Error {
  constructor() {
    super('中身が変わったので選び直してください');
    this.name = 'StaleSnippet';
  }
}

/**
 * Copies from a card and counts it. The text always comes from the block as it is now (never from
 * the preview), and the count goes up only once the clipboard took it.
 */
export class CardCopier {
  /** Copies of one card run one after another, so two quick presses both count. */
  private chains = new Map<string, Promise<unknown>>();

  constructor(private api: LogseqLike, private deps: CardCopyDeps) {}

  copy(cardUuid: string, target: CopyTarget): Promise<number> {
    const prev = this.chains.get(cardUuid) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(() => this.copyNow(cardUuid, target));
    const tail = run.catch(() => {});
    this.chains.set(cardUuid, tail);
    void tail.then(() => {
      if (this.chains.get(cardUuid) === tail) this.chains.delete(cardUuid);
    });
    return run;
  }

  private async copyNow(cardUuid: string, target: CopyTarget): Promise<number> {
    let raw: any;
    try {
      raw = await this.api.Editor.getBlock(cardUuid, { includeChildren: true });
    } catch (e) {
      throw new Error('Could not read the card block from Logseq.', { cause: e });
    }
    const root = raw ? toCardNode(raw) : null;
    if (!root) throw new Error('The card block no longer exists.');
    try {
      if (target === 'whole') await this.deps.writeText(wholeText(root));
      else {
        const s = cardSnippets(root)[target.index];
        if (!s || s.kind !== target.kind || s.id !== target.id) throw new StaleSnippet();
        if (s.kind !== 'image') await this.deps.writeText(s.text);
        else {
          try {
            await this.deps.writeImage(s.text);
          } catch (e) {
            // Some pictures cannot go on the clipboard as PNG; the reference still pastes back into Logseq.
            console.warn('[dataquery] could not put the picture on the clipboard; copying its reference instead', e);
            await this.deps.writeText(`![](${s.text})`);
          }
        }
      }
    } catch (e) {
      if (e instanceof StaleSnippet) throw e;
      throw new Error('Could not copy to the clipboard.', { cause: e });
    }
    const next = readCopies(root.content) + 1;
    try {
      await this.api.Editor.upsertBlockProperty(cardUuid, 'copies', next);
    } catch (e) {
      throw new Error('Copied, but could not save the copy count.', { cause: e });
    }
    return next;
  }
}
