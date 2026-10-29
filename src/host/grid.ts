import { cellTarget, type Row } from '../core/rows';
import { parseTsv, toHtmlTable, toTsv } from '../core/tsv';
import type { ViewData } from '../core/view';
import { clipboardImage, imageToDataUrl } from './clipboardImage';
import type { Move, TableDeps, TableTools } from './tableTools';

export type GridDeps = Pick<TableDeps, 'view' | 'report' | 'notify' | 'saveCell' | 'addRow'>;

interface Pos { r: number; c: number }
/** One table's cursor (`h`, the head) and range anchor (`a`), by position and by what they sit on. */
interface Saved { a: Pos; h: Pos; uuid?: string; key?: string; active: boolean }

const FAR = 1e9;
const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));

/**
 * The table as a spreadsheet: click or drag to select cells, arrows move, typing edits the cell,
 * Enter / Tab move on (Enter on the last row adds a row), Delete clears, Ctrl+C / X / V copy, cut and
 * paste (text, tab-separated cells, or a picture). The keyboard belongs to the table element
 * (`.dq-tbl`, focusable) while it has the focus; the cell editor itself is TableTools' input.
 * The cursor is kept per table by row block and column, so it survives Logseq repainting the view.
 */
export class Grid {
  private cur = new Map<string, Saved>();
  private drag?: HTMLElement;
  private adding = false;

  constructor(
    private doc: Document,
    private deps: GridDeps,
    private tools: TableTools,
    /** `f`: toggle the full screen of the view the table is in. */
    private toggleFull: (tbl: HTMLElement) => void,
  ) {
    tools.onEditEnd = (cell, move) => this.afterEdit(cell, move);
  }

  // ---- layout ----

  private layout(tbl: HTMLElement): { rows: HTMLElement[]; keys: string[] } {
    const rows = [...tbl.querySelectorAll<HTMLElement>('tbody tr[data-row]')];
    const keys = [...(rows[0]?.querySelectorAll<HTMLElement>('td[data-col]') ?? [])].map((td) => td.dataset.col!);
    return { rows, keys };
  }

  private cellAt(tbl: HTMLElement, p: Pos): HTMLElement | undefined {
    const { rows, keys } = this.layout(tbl);
    const key = keys[p.c];
    return rows[p.r] ? [...rows[p.r].querySelectorAll<HTMLElement>('td[data-col]')].find((td) => td.dataset.col === key) : undefined;
  }

  private posOf(td: HTMLElement): Pos | null {
    const tbl = td.closest<HTMLElement>('.dq-tbl');
    const tr = td.closest<HTMLElement>('tr[data-row]');
    if (!tbl || !tr) return null;
    const { keys } = this.layout(tbl);
    const c = keys.indexOf(td.dataset.col ?? '');
    return c < 0 ? null : { r: Number(tr.dataset.row), c };
  }

  private state(tbl: HTMLElement): Saved | undefined {
    return tbl.dataset.macro ? this.cur.get(tbl.dataset.macro) : undefined;
  }

  // ---- selection ----

  private select(tbl: HTMLElement, a: Pos, h: Pos): void {
    const macro = tbl.dataset.macro;
    if (!macro) return;
    const { rows, keys } = this.layout(tbl);
    if (!rows.length || !keys.length) return;
    const fit = (p: Pos): Pos => ({ r: clamp(p.r, rows.length - 1), c: clamp(p.c, keys.length - 1) });
    const sv: Saved = { a: fit(a), h: fit(h), active: true };
    sv.uuid = rows[sv.h.r].dataset.uuid;
    sv.key = keys[sv.h.c];
    this.cur.set(macro, sv);
    this.paint(tbl);
    const td = this.cellAt(tbl, sv.h);
    if (td) this.reveal(tbl, td);
  }

  private paint(tbl: HTMLElement): void {
    tbl.querySelectorAll('td.dq-sel, td.dq-cur').forEach((td) => td.classList.remove('dq-sel', 'dq-cur'));
    const sv = this.state(tbl);
    if (!sv) return;
    const r0 = Math.min(sv.a.r, sv.h.r);
    const r1 = Math.max(sv.a.r, sv.h.r);
    const c0 = Math.min(sv.a.c, sv.h.c);
    const c1 = Math.max(sv.a.c, sv.h.c);
    const { rows, keys } = this.layout(tbl);
    for (let r = r0; r <= r1; r++) {
      const tds = [...(rows[r]?.querySelectorAll<HTMLElement>('td[data-col]') ?? [])];
      for (let c = c0; c <= c1; c++) tds.find((td) => td.dataset.col === keys[c])?.classList.add('dq-sel');
    }
    const head = this.cellAt(tbl, sv.h);
    head?.classList.remove('dq-sel');
    head?.classList.add('dq-cur');
    if (r0 === r1 && c0 === c1) head?.classList.remove('dq-sel');
  }

  /** Scroll the table (not the page) just enough to show a cell. */
  private reveal(tbl: HTMLElement, td: HTMLElement): void {
    const box = tbl.getBoundingClientRect();
    const t = td.getBoundingClientRect();
    if (t.left < box.left) tbl.scrollLeft -= box.left - t.left;
    else if (t.right > box.right) tbl.scrollLeft += t.right - box.right;
    if (t.top < box.top) tbl.scrollTop -= box.top - t.top;
    else if (t.bottom > box.bottom) tbl.scrollTop += t.bottom - box.bottom;
  }

  /** A view was painted: put the cursor back (on the same block and column if they are still there) and the focus. */
  restore(view: HTMLElement): void {
    const tbl = view.querySelector<HTMLElement>('.dq-tbl');
    const sv = tbl ? this.state(tbl) : undefined;
    if (!tbl || !sv) return;
    tbl.tabIndex = 0;
    const { rows, keys } = this.layout(tbl);
    if (!rows.length || !keys.length) return;
    const ri = sv.uuid ? rows.findIndex((tr) => tr.dataset.uuid === sv.uuid) : -1;
    const ci = sv.key ? keys.indexOf(sv.key) : -1;
    const h = { r: ri >= 0 ? ri : clamp(sv.h.r, rows.length - 1), c: ci >= 0 ? ci : clamp(sv.h.c, keys.length - 1) };
    const moved = h.r !== sv.h.r || h.c !== sv.h.c;
    sv.a = moved ? h : { r: clamp(sv.a.r, rows.length - 1), c: clamp(sv.a.c, keys.length - 1) };
    sv.h = h;
    this.paint(tbl);
    if (sv.active) tbl.focus({ preventScroll: true });
  }

  /** Put the cursor on a block's row (it may not be in the table yet: the last row stands in until it is). */
  private goto(macro: string, uuid: string, key?: string): void {
    const old = this.cur.get(macro);
    const h = { r: FAR, c: old?.h.c ?? 0 };
    this.cur.set(macro, { a: h, h, uuid, key: key ?? old?.key, active: true });
  }

  // ---- mouse ----

  onMouseDown(e: MouseEvent): void {
    const t = e.target as Element | null;
    const tbl = t?.closest?.<HTMLElement>('.dq-tbl') ?? null;
    if (!tbl) {
      for (const sv of this.cur.values()) sv.active = false;
      return;
    }
    if (e.button !== 0 || t!.closest('input')) return;
    if (this.tools.formulaClick(e)) return;
    const td = t!.closest<HTMLElement>('td[data-col]');
    if (!td) return;
    const pos = this.posOf(td);
    if (!pos) return;
    // Pointing at another cell finishes the edit in progress, as in a spreadsheet.
    this.tools.commit();
    tbl.tabIndex = 0;
    const sv = this.state(tbl);
    this.select(tbl, e.shiftKey && sv ? sv.a : pos, pos);
    this.drag = tbl;
    tbl.focus({ preventScroll: true });
    // Logseq's own press handlers may move the focus away after ours; take it back once they are done.
    setTimeout(() => {
      if (tbl.isConnected && this.state(tbl)?.active && !this.tools.busy) tbl.focus({ preventScroll: true });
    }, 0);
  }

  /** The table that has the cursor (clicked last, not left since), if it is still on the page. */
  activeTable(): HTMLElement | null {
    for (const tbl of this.doc.querySelectorAll<HTMLElement>('.dq-tbl')) if (this.state(tbl)?.active) return tbl;
    return null;
  }

  onMouseMove(e: MouseEvent): void {
    if (!this.drag) return;
    if (!(e.buttons & 1)) {
      this.drag = undefined;
      return;
    }
    const td = (e.target as Element | null)?.closest?.<HTMLElement>('td[data-col]');
    const sv = this.state(this.drag);
    if (!td || !sv || td.closest('.dq-tbl') !== this.drag) return;
    const pos = this.posOf(td);
    if (pos && (pos.r !== sv.h.r || pos.c !== sv.h.c)) this.select(this.drag, sv.a, pos);
  }

  onMouseUp(): void {
    this.drag = undefined;
  }

  // ---- keyboard ----

  /** Keys while the table itself has the focus. */
  onKey(e: KeyboardEvent, tbl: HTMLElement): void {
    const { rows, keys } = this.layout(tbl);
    if (!rows.length || !keys.length || this.tools.busy) return;
    const sv = this.state(tbl);
    const h = sv?.h ?? { r: 0, c: 0 };
    const a = sv?.a ?? h;
    const mod = e.ctrlKey || e.metaKey;
    const lastR = rows.length - 1;
    const lastC = keys.length - 1;
    const go = (r: number, c: number, extend = e.shiftKey) => {
      e.preventDefault();
      const p = { r: clamp(r, lastR), c: clamp(c, lastC) };
      this.select(tbl, extend ? a : p, p);
    };
    switch (e.key) {
      case 'ArrowUp': return go(mod ? 0 : h.r - 1, h.c);
      case 'ArrowDown': return go(mod ? lastR : h.r + 1, h.c);
      case 'ArrowLeft': return go(h.r, mod ? 0 : h.c - 1);
      case 'ArrowRight': return go(h.r, mod ? lastC : h.c + 1);
      case 'Home': return go(mod ? 0 : h.r, 0);
      case 'End': return go(mod ? lastR : h.r, lastC);
      case 'Tab': {
        const next = e.shiftKey ? h.c - 1 : h.c + 1;
        if (next < 0) return go(h.r - 1, lastC, false);
        if (next > lastC) return go(h.r + 1, 0, false);
        return go(h.r, next, false);
      }
      case 'Enter':
        if (e.shiftKey) return go(h.r - 1, h.c, false);
        if (h.r < lastR) return go(h.r + 1, h.c, false);
        e.preventDefault();
        void this.addRowFor(tbl.dataset.macro!);
        return;
      case 'F2': {
        e.preventDefault();
        const td = this.cellAt(tbl, h);
        if (td) this.tools.edit(td, false);
        return;
      }
      case 'f':
        if (mod || e.altKey) break;
        e.preventDefault();
        return this.toggleFull(tbl);
      case 'Escape': {
        e.preventDefault();
        if (a.r !== h.r || a.c !== h.c) return this.select(tbl, h, h);
        if (sv) sv.active = false;
        tbl.blur();
        return;
      }
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        void this.clear(tbl);
        return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      return this.select(tbl, { r: 0, c: 0 }, { r: lastR, c: lastC });
    }
    // Typing (or the first key of an IME composition) opens the cell empty; the key itself is not
    // cancelled, so the browser types it into the field that has just taken the focus.
    if (!mod && !e.altKey && (e.key.length === 1 || e.key === 'Process' || e.keyCode === 229)) {
      const td = this.cellAt(tbl, h);
      if (td) this.tools.edit(td, true);
    }
  }

  /** An editor was left with Esc (no move) or Enter / Tab: take the focus back and step on. */
  private afterEdit(cell: HTMLElement, move: Move | null): void {
    const tbl = cell.closest<HTMLElement>('.dq-tbl');
    const pos = this.posOf(cell);
    if (!tbl || !pos) return;
    tbl.focus({ preventScroll: true });
    const { rows, keys } = this.layout(tbl);
    const at = (r: number, c: number) => this.select(tbl, { r, c }, { r, c });
    if (!move) return at(pos.r, pos.c);
    // Enter that saves a cell on the last row stays there; only Enter on a selected cell adds a row.
    if (move === 'down' && pos.r === rows.length - 1) return at(pos.r, pos.c);
    if (move === 'down') at(pos.r + 1, pos.c);
    else if (move === 'up') at(pos.r - 1, pos.c);
    else if (move === 'left') pos.c > 0 ? at(pos.r, pos.c - 1) : at(pos.r - 1, keys.length - 1);
    else pos.c < keys.length - 1 ? at(pos.r, pos.c + 1) : at(pos.r + 1, 0);
  }

  // ---- rows ----

  /** Add a row below the last one and put the cursor on it (same column). */
  async addRowFor(macro: string): Promise<string | undefined> {
    if (!this.deps.addRow || this.adding) return undefined;
    this.adding = true;
    try {
      const uuid = await this.deps.addRow(macro);
      if (uuid) this.goto(macro, uuid);
      return uuid;
    } catch (err) {
      this.deps.report(err);
      return undefined;
    } finally {
      this.adding = false;
    }
  }

  // ---- cells in the selection ----

  private range(sv: Saved): { r0: number; r1: number; c0: number; c1: number } {
    return { r0: Math.min(sv.a.r, sv.h.r), r1: Math.max(sv.a.r, sv.h.r), c0: Math.min(sv.a.c, sv.h.c), c1: Math.max(sv.a.c, sv.h.c) };
  }

  private context(tbl: HTMLElement): { data: ViewData; keys: string[]; sv: Saved } | null {
    const data = tbl.dataset.macro ? this.deps.view(tbl.dataset.macro) : undefined;
    const sv = this.state(tbl);
    if (!data || !sv) return null;
    return { data, keys: this.layout(tbl).keys, sv };
  }

  private target(row: Row | undefined, key: string, by?: string): string | null {
    if (!row) return null;
    const t = cellTarget(row, key, by);
    return t && 'uuid' in t ? t.uuid : null;
  }

  private async write(tbl: HTMLElement, items: Array<{ block: string; key: string; value: string }>): Promise<void> {
    const save = this.deps.saveCell;
    if (!save) throw new Error('Cell editing is not available here.');
    this.tools.keepScroll(tbl);
    try {
      for (const it of items) await save(it.block, it.key, it.value);
    } catch (err) {
      this.deps.report(err);
    }
  }

  private async clear(tbl: HTMLElement): Promise<number> {
    const cx = this.context(tbl);
    if (!cx) return 0;
    const { r0, r1, c0, c1 } = this.range(cx.sv);
    const items: Array<{ block: string; key: string; value: string }> = [];
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const row = cx.data.result.rows[r];
        const block = this.target(row, cx.keys[c], cx.data.query.by);
        if (block && (row.values[cx.keys[c]] !== undefined || row.formulas?.[cx.keys[c]] !== undefined)) items.push({ block, key: cx.keys[c], value: '' });
      }
    await this.write(tbl, items);
    return items.length;
  }

  // ---- clipboard ----

  /** Ctrl+C / Ctrl+X: the selected cells as tab-separated text and as an HTML table. */
  onCopy(e: ClipboardEvent, tbl: HTMLElement, cut: boolean): void {
    const cx = this.context(tbl);
    if (!cx || !e.clipboardData || this.tools.busy) return;
    const { r0, r1, c0, c1 } = this.range(cx.sv);
    const cells: string[][] = [];
    for (let r = r0; r <= r1; r++) {
      const row = cx.data.result.rows[r];
      const line: string[] = [];
      for (let c = c0; c <= c1; c++) line.push(row?.values[cx.keys[c]] ?? '');
      cells.push(line);
    }
    e.preventDefault();
    e.clipboardData.setData('text/plain', toTsv(cells));
    e.clipboardData.setData('text/html', toHtmlTable(cells));
    this.deps.notify(`${(r1 - r0 + 1) * (c1 - c0 + 1)} cells ${cut ? 'cut' : 'copied'}`);
    if (cut) void this.clear(tbl);
  }

  /** Ctrl+V: a picture goes into the cell as an image; text is read as cells and pasted from the cursor. */
  onPaste(e: ClipboardEvent, tbl: HTMLElement): void {
    const cx = this.context(tbl);
    if (!cx || this.tools.busy) return;
    const { r0, r1, c0, c1 } = this.range(cx.sv);
    const img = clipboardImage(e.clipboardData);
    if (img) {
      e.preventDefault();
      const win = this.doc.defaultView;
      const block = this.target(cx.data.result.rows[cx.sv.h.r], cx.keys[cx.sv.h.c], cx.data.query.by);
      if (!win || !block) return this.deps.notify('This cell cannot take a picture.');
      imageToDataUrl(win, img).then(
        (url) => this.write(tbl, [{ block, key: cx.keys[cx.sv.h.c], value: `![pasted image](${url})` }]),
        (err) => this.deps.report(new Error('Could not paste the picture.', { cause: err })),
      );
      return;
    }
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    e.preventDefault();
    const cells = parseTsv(text);
    const items: Array<{ block: string; key: string; value: string }> = [];
    let outside = 0;
    const put = (r: number, c: number, value: string) => {
      const row = cx.data.result.rows[r];
      const block = c < cx.keys.length ? this.target(row, cx.keys[c], cx.data.query.by) : null;
      if (block) items.push({ block, key: cx.keys[c], value });
      else outside++;
    };
    if (cells.length === 1 && cells[0].length === 1 && (r1 > r0 || c1 > c0)) {
      // One value into a bigger selection fills all of it.
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) put(r, c, cells[0][0]);
    } else cells.forEach((line, i) => line.forEach((v, j) => put(r0 + i, c0 + j, v)));
    if (!items.length) return this.deps.notify('Nothing to paste here.');
    void this.write(tbl, items).then(() =>
      this.deps.notify(`${items.length} cells pasted${outside ? `; ${outside} fell outside the table or on a cell that cannot be edited` : ''}`));
  }
}
