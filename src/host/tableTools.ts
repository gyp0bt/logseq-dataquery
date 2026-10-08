import { IMG_DEFAULT, IMG_MAX, IMG_MIN } from '../core/dsl';
import { esc } from '../core/html';
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
  /** Ctrl+wheel over a table image: write the height it ended on as `img:`. */
  setImg?(macroUuid: string, px: number): Promise<void>;
}

/** Ctrl+wheel over a table image changes the size live, and writes `img:` once it stops for this long. */
export const IMG_WRITE_DELAY = 400;
const IMG_WHEEL_STEP = 1.1;

/** An open cell or `+` editor: what to put back if it is left without Enter. */
interface Editing { input: HTMLInputElement; cell: HTMLElement; html: string; done: boolean }

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
    const td = (e.target as Element | null)?.closest?.('.dq-tbl td[data-col]') as HTMLElement | null;
    if (!td || td.querySelector('input')) return false;
    const tbl = td.closest<HTMLElement>('.dq-tbl');
    const tr = td.closest<HTMLElement>('tr[data-row]');
    const data = tbl?.dataset.macro ? this.deps.view(tbl.dataset.macro) : undefined;
    const row = tr ? data?.result.rows[Number(tr.dataset.row)] : undefined;
    if (!data || !row) return false;
    e.preventDefault();
    e.stopPropagation();
    const key = td.dataset.col!;
    const target = cellTarget(row, key, data.query.by);
    if (target === null) return true;
    if ('error' in target) {
      this.deps.notify(target.error);
      return true;
    }
    const input = this.open(td, 'dq-cellin', row.values[key] ?? '', `Value of ${key}: Enter to save, empty to remove, Esc to cancel`);
    input.dataset.block = target.uuid;
    input.dataset.key = key;
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
    this.editing = { input, cell, html, done: false };
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
  }

  /** Keys in one of our table fields; true when the key was ours. */
  onKey(e: KeyboardEvent): boolean {
    const ed = this.editing;
    const input = (e.target as Element | null)?.closest?.('input.dq-cellin, input.dq-keyin') as HTMLInputElement | null;
    if (!ed || !input || input !== ed.input) return false;
    if (e.isComposing || e.keyCode === 229) return true;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.cancel();
      return true;
    }
    if (e.key !== 'Enter') return true;
    e.preventDefault();
    if (input.classList.contains('dq-cellin')) this.saveCell(ed);
    else this.addColumn(ed);
    return true;
  }

  /** A field of ours lost the focus without Enter: put the cell back. */
  onFocusOut(e: FocusEvent): void {
    if (this.editing && e.target === this.editing.input) this.cancel();
  }

  private saveCell(ed: Editing): void {
    const { block, key } = ed.input.dataset;
    const value = ed.input.value.replace(/[\r\n]+/g, ' ');
    const tbl = ed.cell.closest<HTMLElement>('.dq-tbl');
    const old = ed.input.defaultValue;
    ed.done = true;
    this.editing = undefined;
    if (value.trim() === old.trim()) {
      ed.cell.innerHTML = ed.html;
      return;
    }
    if (tbl) this.keepScroll(tbl);
    // Shown at once; the repaint after Logseq saves draws it properly (images, colours).
    ed.cell.textContent = value.trim();
    if (!this.deps.saveCell) return this.deps.report(new Error('Cell editing is not available here.'));
    this.deps.saveCell(block!, key!, value).catch((err) => {
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

  private keepScroll(tbl: HTMLElement): void {
    if (tbl.dataset.macro) this.keep.set(tbl.dataset.macro, { left: tbl.scrollLeft, top: tbl.scrollTop });
  }

  private message(cell: HTMLElement, html: string): void {
    const msg = cell.closest('.dq')?.querySelector('.dq-msg');
    if (msg) msg.innerHTML = html ? `<p class="dq-note">${html}</p>` : '';
  }
}
