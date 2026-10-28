import { IMG_DEFAULT, IMG_MAX, IMG_MIN } from '../core/dsl';
import { esc } from '../core/html';
import { insertPick, stepPick, type RefPick } from '../core/formula';
import { cellTarget, validatePropKey } from '../core/rows';
import type { ViewData } from '../core/view';

export interface TableDeps {
  view(uuid: string): ViewData | undefined;
  report(e: unknown): void;
  notify(msg: string): void;
  leaveEditing?(): void;
  /** Write `key:: value` into a block (empty value: remove the property). */
  saveCell?(blockUuid: string, key: string, value: string): Promise<void>;
  /** Show a column added with `+` until a block holds it (transient: the macro does not change). */
  addColumn?(macroUuid: string, key: string): void;
  /** Rename a row: write the title line of its block. */
  saveTitle?(blockUuid: string, title: string): Promise<void>;
  /** Add a row below the last one (a block under the last row's block); resolves to its uuid. */
  addRow?(macroUuid: string): Promise<string | undefined>;
  /** Ctrl+wheel over a table image: write the height it ended on as `img:`. */
  setImg?(macroUuid: string, px: number): Promise<void>;
}

/** Ctrl+wheel over a table image changes the size live, and writes `img:` once it stops for this long. */
export const IMG_WRITE_DELAY = 400;
const IMG_WHEEL_STEP = 1.1;

/** An open cell or `+` editor: what to put back if it is left without Enter. */
interface Editing { input: HTMLInputElement; cell: HTMLElement; html: string; done: boolean; pick: RefPick | null; picked?: HTMLElement }

/** Where the cursor goes when an editor is left with a key. */
export type Move = 'up' | 'down' | 'left' | 'right';

/**
 * The table's own tools: image overlay, Ctrl+wheel image size, double-click cell editing and the
 * `+` column. Interact routes the events here; fields opened here are `input.dq-cellin` and
 * `input.dq-keyin`, which the window-capture shield and the repaint hold already cover.
 */
export class TableTools {
  private box?: HTMLElement;
  private editing?: Editing;
  /** Table scroll offsets to put back once the view is painted again after a write. */
  private keep = new Map<string, { left: number; top: number }>();
  private imgTimer?: ReturnType<typeof setTimeout>;
  /** The grid hears how a cell editor was left: Esc (no move) or Enter / Tab (a move). */
  onEditEnd?: (cell: HTMLElement, move: Move | null) => void;

  constructor(private doc: Document, private deps: TableDeps) {}

  /** A view was painted: put back the scroll of its table if a write from it caused the repaint. */
  restore(view: HTMLElement): void {
    const tbl = view.querySelector<HTMLElement>('.dq-tbl');
    const uuid = tbl?.dataset.macro;
    const k = uuid ? this.keep.get(uuid) : undefined;
    if (!tbl || !k) return;
    tbl.scrollLeft = k.left;
    tbl.scrollTop = k.top;
    this.keep.delete(uuid!);
  }

  // ---- image overlay ----

  /** True when the click was the table's (an image, the `+` header, the overlay). */
  onClick(e: MouseEvent): boolean {
    const t = e.target as Element | null;
    if (this.box && t && this.box.contains(t)) {
      e.preventDefault();
      e.stopPropagation();
      this.closeBox();
      return true;
    }
    const img = t?.closest?.('.dq-tbl img.dq-img') as HTMLImageElement | null;
    if (img) {
      e.preventDefault();
      e.stopPropagation();
      this.openBox(img);
      return true;
    }
    const row = t?.closest?.('.dq [data-act="addrow"]') as HTMLElement | null;
    const macro = row?.closest<HTMLElement>('.dq')?.dataset.macro;
    if (row && macro) {
      e.stopPropagation();
      this.deps.addRow?.(macro).catch((err) => this.deps.report(err));
      return true;
    }
    const add = t?.closest?.('.dq-tbl [data-act="addcol"]') as HTMLElement | null;
    if (add && !add.querySelector('input')) {
      e.stopPropagation();
      this.openKeyInput(add);
      return true;
    }
    return false;
  }

  private openBox(img: HTMLImageElement): void {
    this.closeBox();
    const box = this.doc.createElement('div');
    box.className = 'dq-lightbox';
    box.setAttribute('role', 'dialog');
    box.title = 'Click or press Esc to close';
    box.innerHTML = `<img src="${esc(img.src)}" alt="${esc(img.alt)}">`;
    this.doc.body.appendChild(box);
    this.box = box;
  }

  private closeBox(): void {
    this.box?.remove();
    this.box = undefined;
  }

  /** Esc closes the overlay; true when it did (the caller swallows the key). */
  escBox(e: KeyboardEvent): boolean {
    if (!this.box || e.type !== 'keydown' || e.key !== 'Escape') return false;
    e.preventDefault();
    this.closeBox();
    return true;
  }

  // ---- image size ----

  /** True when the wheel resized the table's images. */
  onWheel(e: WheelEvent): boolean {
    if (!e.ctrlKey || !e.deltaY) return false;
    const tbl = (e.target as Element | null)?.closest?.('.dq-tbl img.dq-img')?.closest('.dq-tbl') as HTMLElement | null;
    const uuid = tbl?.dataset.macro;
    if (!tbl || !uuid) return false;
    e.preventDefault();
    const cur = parseFloat(tbl.style.getPropertyValue('--dq-img')) || IMG_DEFAULT;
    const next = Math.round(Math.min(IMG_MAX, Math.max(IMG_MIN, e.deltaY < 0 ? cur * IMG_WHEEL_STEP : cur / IMG_WHEEL_STEP)));
    tbl.style.setProperty('--dq-img', `${next}px`);
    clearTimeout(this.imgTimer);
    this.imgTimer = setTimeout(() => {
      this.keepScroll(tbl);
      this.deps.setImg?.(uuid, next).catch((err) => this.deps.report(err));
    }, IMG_WRITE_DELAY);
    return true;
  }

  // ---- cell editing ----

  /** Double-click on a data cell: true when it was one (edited, or refused with a message). */
  onDblClick(e: MouseEvent): boolean {
    const td = (e.target as Element | null)?.closest?.('.dq-tbl td[data-col], .dq-tbl td[data-label]') as HTMLElement | null;
    if (!td || td.querySelector('input')) return false;
    e.preventDefault();
    e.stopPropagation();
    if (td.dataset.label) this.editLabel(td);
    else this.edit(td, false);
    return true;
  }

  /** Open the editor on a row's label: the title line of its block. */
  editLabel(td: HTMLElement): boolean {
    const tbl = td.closest<HTMLElement>('.dq-tbl');
    const tr = td.closest<HTMLElement>('tr[data-row]');
    const data = tbl?.dataset.macro ? this.deps.view(tbl.dataset.macro) : undefined;
    const row = tr ? data?.result.rows[Number(tr.dataset.row)] : undefined;
    if (!data || !row) return false;
    if (data.query.by) {
      this.deps.notify(`The label is the value of by:${data.query.by}; edit that column instead.`);
      return false;
    }
    // A block without a title of its own is labelled by its ancestor: renaming writes to that block.
    const raw = row.title;
    const input = this.open(td, 'dq-cellin', raw, 'Row name (the first line of its block): Enter to save, Esc to cancel');
    input.dataset.block = row.titleBlock ?? row.sources[0].uuid;
    input.dataset.kind = 'title';
    input.dataset.orig = raw;
    return true;
  }

  /**
   * Open the editor on a data cell: with its raw text (the formula for a formula cell), or empty when
   * typing started on the cell. Refused with a message when the cell has no single block to write to.
   */
  edit(td: HTMLElement, empty: boolean): boolean {
    if (td.querySelector('input')) return false;
    const tbl = td.closest<HTMLElement>('.dq-tbl');
    const tr = td.closest<HTMLElement>('tr[data-row]');
    const data = tbl?.dataset.macro ? this.deps.view(tbl.dataset.macro) : undefined;
    const row = tr ? data?.result.rows[Number(tr.dataset.row)] : undefined;
    if (!data || !row) return false;
    const key = td.dataset.col!;
    const target = cellTarget(row, key, data.query.by);
    if (target === null) return false;
    if ('error' in target) {
      this.deps.notify(target.error);
      return false;
    }
    const raw = row.formulas?.[key] ?? row.values[key] ?? '';
    const input = this.open(td, 'dq-cellin', empty ? '' : raw, `Value of ${key}: Enter to save, empty to remove, Esc to cancel. Start with = for a formula`);
    input.dataset.block = target.uuid;
    input.dataset.key = key;
    input.dataset.orig = raw;
    return true;
  }

  private openKeyInput(th: HTMLElement): void {
    this.open(th, 'dq-keyin', '', 'New property name: Enter to add the column, Esc to cancel').placeholder = 'property';
  }

  private open(cell: HTMLElement, cls: string, value: string, title: string): HTMLInputElement {
    this.cancel();
    // Logseq leaves a block's raw editing only on its own outside click, which this focus is not.
    this.deps.leaveEditing?.();
    const html = cell.innerHTML;
    cell.innerHTML = `<input class="${cls}" type="text" spellcheck="false" title="${esc(title)}" value="${esc(value)}">`;
    const input = cell.querySelector<HTMLInputElement>('input')!;
    this.editing = { input, cell, html, done: false, pick: null };
    input.focus();
    input.select();
    return input;
  }

  /** Put the cell back as it was (Esc, or the field left without Enter). */
  private cancel(): void {
    const ed = this.editing;
    if (!ed) return;
    this.editing = undefined;
    if (ed.done) return;
    ed.done = true;
    if (ed.cell.isConnected) ed.cell.innerHTML = ed.html;
    this.message(ed.cell, '');
    ed.picked?.classList.remove('dq-ref');
  }

  /** Keys in one of our table fields; true when the key was ours. */
  onKey(e: KeyboardEvent): boolean {
    const ed = this.editing;
    const input = (e.target as Element | null)?.closest?.('input.dq-cellin, input.dq-keyin') as HTMLInputElement | null;
    if (!ed || !input || input !== ed.input) return false;
    if (e.isComposing || e.keyCode === 229) return true;
    const cellIn = input.classList.contains('dq-cellin');
    if (e.key === 'Escape') {
      e.preventDefault();
      const cell = ed.cell;
      this.cancel();
      if (cellIn) this.onEditEnd?.(cell, null);
      return true;
    }
    if (cellIn && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.pickCell(ed, e);
      return true;
    }
    if (e.key === 'Tab' && cellIn) {
      e.preventDefault();
      this.finish(ed, e.shiftKey ? 'left' : 'right');
      return true;
    }
    if (e.key !== 'Enter') return true;
    e.preventDefault();
    if (cellIn) this.finish(ed, e.shiftKey ? 'up' : 'down');
    else this.addColumn(ed);
    return true;
  }

  private finish(ed: Editing, move: Move): void {
    const cell = ed.cell;
    this.saveCell(ed);
    this.onEditEnd?.(cell, move);
  }

  // ---- formula: pick cells of the row with the arrow keys or the mouse ----

  private rowKeys(cell: HTMLElement): string[] {
    return [...(cell.closest('tr')?.querySelectorAll<HTMLElement>('td[data-col]') ?? [])].map((td) => td.dataset.col!);
  }

  private showPick(ed: Editing): void {
    ed.picked?.classList.remove('dq-ref');
    ed.picked = undefined;
    if (!ed.pick) return;
    const td = [...(ed.cell.closest('tr')?.querySelectorAll<HTMLElement>('td[data-col]') ?? [])].find((c) => c.dataset.col === ed.pick!.key);
    td?.classList.add('dq-ref');
    ed.picked = td;
  }

  private applyPick(ed: Editing, r: { value: string; caret: number; pick: RefPick }): void {
    ed.input.value = r.value;
    ed.input.setSelectionRange(r.caret, r.caret);
    ed.pick = r.pick;
    this.showPick(ed);
  }

  /** ←/→ in a formula right after `=`, an operator or `(`: insert the neighbouring cell's name. */
  private pickCell(ed: Editing, e: KeyboardEvent): void {
    const { input } = ed;
    if (input.selectionStart !== input.selectionEnd) return;
    const r = stepPick(input.value, input.selectionStart ?? 0, ed.pick, this.rowKeys(ed.cell), input.dataset.key ?? '', e.key === 'ArrowRight' ? 1 : -1);
    if (!r) return;
    e.preventDefault();
    this.applyPick(ed, r);
  }

  /** A press on another cell of the row while a formula is typed inserts that cell (and keeps the field). */
  formulaClick(e: MouseEvent): boolean {
    const ed = this.editing;
    const td = (e.target as Element | null)?.closest?.('.dq-tbl td[data-col]') as HTMLElement | null;
    if (!ed || !td || !ed.input.classList.contains('dq-cellin') || td === ed.cell || td.closest('tr') !== ed.cell.closest('tr')) return false;
    const r = insertPick(ed.input.value, ed.input.selectionStart ?? ed.input.value.length, ed.pick, td.dataset.col!);
    if (!r) return false;
    e.preventDefault();
    e.stopPropagation();
    this.applyPick(ed, r);
    return true;
  }

  /** Save the cell editor if one is open (pointing at another cell does this). */
  commit(): void {
    const ed = this.editing;
    if (ed && ed.input.classList.contains('dq-cellin')) this.saveCell(ed);
  }

  /** Whether a cell or column editor is open (the grid then leaves the keys to it). */
  get busy(): boolean {
    return !!this.editing;
  }

  /** A field of ours lost the focus without Enter: put the cell back. */
  onFocusOut(e: FocusEvent): void {
    if (this.editing && e.target === this.editing.input) this.cancel();
  }

  private saveCell(ed: Editing): void {
    const { block, key } = ed.input.dataset;
    const value = ed.input.value.replace(/[\r\n]+/g, ' ');
    const tbl = ed.cell.closest<HTMLElement>('.dq-tbl');
    const old = ed.input.dataset.orig ?? ed.input.defaultValue;
    ed.done = true;
    this.editing = undefined;
    ed.picked?.classList.remove('dq-ref');
    if (value.trim() === old.trim()) {
      ed.cell.innerHTML = ed.html;
      return;
    }
    if (tbl) this.keepScroll(tbl);
    // Shown at once; the repaint after Logseq saves draws it properly (images, colours).
    ed.cell.textContent = value.trim();
    if (!this.deps.saveCell || (ed.input.dataset.kind === 'title' && !this.deps.saveTitle)) return this.deps.report(new Error('Cell editing is not available here.'));
    const save = ed.input.dataset.kind === 'title' ? this.deps.saveTitle?.(block!, value) : this.deps.saveCell(block!, key!, value);
    (save ?? Promise.reject(new Error('Row renaming is not available here.'))).catch((err) => {
      if (ed.cell.isConnected) ed.cell.innerHTML = ed.html;
      this.deps.report(err);
    });
  }

  private addColumn(ed: Editing): void {
    const key = ed.input.value.trim();
    const tbl = ed.cell.closest<HTMLElement>('.dq-tbl');
    const uuid = tbl?.dataset.macro;
    const data = uuid ? this.deps.view(uuid) : undefined;
    if (!tbl || !uuid || !data) return this.cancel();
    const shown = [...tbl.querySelectorAll<HTMLElement>('td[data-col]')].map((td) => td.dataset.col!);
    const cols = [...(data.query.by ? [data.query.by] : []), ...data.result.cols, ...shown];
    const bad = validatePropKey(key, cols);
    if (bad) return this.message(ed.cell, esc(bad));
    ed.done = true;
    this.editing = undefined;
    this.message(ed.cell, '');
    this.keepScroll(tbl);
    ed.cell.innerHTML = ed.html;
    this.deps.addColumn?.(uuid, key);
  }

  keepScroll(tbl: HTMLElement): void {
    if (tbl.dataset.macro) this.keep.set(tbl.dataset.macro, { left: tbl.scrollLeft, top: tbl.scrollTop });
  }

  private message(cell: HTMLElement, html: string): void {
    const msg = cell.closest('.dq')?.querySelector('.dq-msg');
    if (msg) msg.innerHTML = html ? `<p class="dq-note">${html}</p>` : '';
  }
}
