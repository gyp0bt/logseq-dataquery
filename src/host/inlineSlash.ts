import { isInlineLine } from '../core/macroText';

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
/** Logseq's autocomplete (slash commands, `#` page search): Enter belongs to it while it is open. */
const POPUP = '#ui__ac, #ui__ac-inner';
/** Some line of the text may be an inline `/DQ…` (the exact test is `expandInline`). */
const HAS_INLINE = /^\s*\/dq ?(?:table|scatter|bar|cards)\b/im;
/** Wait for Logseq to save the editor's text before rewriting the block. */
export const CONVERT_DELAY = 80;

export interface InlineSlashDeps {
  /** The block was left with a `/DQ… <query>` line in it: rewrite that line into the macro. */
  convert(uuid: string): Promise<void>;
  /** Leave Logseq's block editor (it saves the text as it leaves). */
  leaveEditing(): void;
  report(e: unknown): void;
}

/** The block uuid of a Logseq editor textarea (`edit-block-…-<uuid>`), or null for any other element. */
export function editorUuid(el: EventTarget | null): string | null {
  const t = el as HTMLTextAreaElement | null;
  if (t?.tagName !== 'TEXTAREA' || !t.id.startsWith('edit-block')) return null;
  return UUID.exec(t.id)?.[1] ?? null;
}

/**
 * `/DQscatter #tips` typed in a block. Logseq's slash popup drops what follows the command name,
 * so the line is kept as text and turned into `{{renderer :DQscatter, #tips}}` when the block is
 * left: Enter on that line (instead of a new block), Esc, or a click elsewhere.
 */
export function installInlineSlash(doc: Document, deps: InlineSlashDeps): () => void {
  const due = new Map<string, ReturnType<typeof setTimeout>>();
  // After Logseq's own save of the text as the editor closes; once per block however it was left.
  const later = (uuid: string) => {
    clearTimeout(due.get(uuid));
    due.set(uuid, setTimeout(() => {
      due.delete(uuid);
      deps.convert(uuid).catch(deps.report);
    }, CONVERT_DELAY));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.isComposing || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLTextAreaElement;
    const uuid = editorUuid(t);
    if (!uuid) return;
    if (e.key === 'Escape') {
      if (HAS_INLINE.test(t.value)) later(uuid);
      return;
    }
    if (e.key !== 'Enter' || doc.querySelector(POPUP)) return;
    if (!isInlineLine(t.value, t.selectionStart ?? t.value.length)) return;
    e.preventDefault();
    e.stopPropagation();
    deps.leaveEditing();
    later(uuid);
  };
  // A removed textarea may send no focusout (Chrome), hence the keys above; a click elsewhere does.
  const onOut = (e: FocusEvent) => {
    const uuid = editorUuid(e.target);
    if (uuid && HAS_INLINE.test((e.target as HTMLTextAreaElement).value)) later(uuid);
  };
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('focusout', onOut, true);
  return () => {
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('focusout', onOut, true);
    for (const t of due.values()) clearTimeout(t);
  };
}
