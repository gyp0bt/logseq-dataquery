import { splitUnit } from './unit';
import { barSvg, legendHtml, scatterSvg, type Chart, type ChartOpts } from './chart';
import { IMG_DEFAULT, type Kind, type ParseResult, type Query } from './dsl';
import { esc } from './html';
import { cellHtml, imagePieces, type AssetScheme } from './images';
import { isAxisNumeric, typeOf, type QueryResult } from './query';
import { canonical, rowLabel, type Row } from './rows';
import { cellMean, isNumericType, type ValueType } from './types';

export interface InlineInput {
  kind: Kind;
  macroUuid: string;
  dsl: string;
  parsed: ParseResult;
  result?: QueryResult;
  error?: string;
  /** Size and transient state to draw the chart at on first paint, so the host need not redraw it. */
  chartOpts?: ChartOpts;
  /** Whether the table under a chart starts expanded (it is collapsed by default). */
  tableOpen?: boolean;
  /** The graph folder, to resolve `../assets/…` images in cells. */
  graphPath?: string;
  assetScheme?: AssetScheme;
  /** Columns added with the table's `+` that no block holds yet (transient, kept by the host). */
  extraCols?: string[];
  /** The view fills the window (transient, kept by the host). */
  full?: boolean;
}

export interface TableOpts { graphPath?: string; assetScheme?: AssetScheme; extraCols?: string[] }

/** The data columns the table shows: not hidden, plus the transient ones from `+`. */
export function shownCols(result: QueryResult, q: Query, extra: string[] = []): string[] {
  const cols = result.cols.filter((k) => !q.hide.includes(k));
  for (const k of extra) if (!cols.includes(k) && !result.cols.includes(k) && k !== q.by && !q.hide.includes(k)) cols.push(k);
  return cols;
}

/** Whether a shown cell holds an image (then the side panel offers Img − / +). */
export function hasImages(result: QueryResult, q: Query): boolean {
  const cols = shownCols(result, q);
  return result.rows.some((r) => cols.some((k) => r.values[k] !== undefined && imagePieces(r.values[k]) !== null));
}

/** Everything a view needs to draw its chart again or copy its table. */
export interface ViewData { kind: Kind; query: Query; result: QueryResult }

export function cellClass(t: ValueType, v: string | undefined): string {
  if (t !== 'ratio') return '';
  const n = cellMean(v);
  return isNaN(n) ? '' : n < 1 ? 'dq-pass' : 'dq-fail';
}

const alignRight = (t: ValueType) => isNumericType(t) || t === 'numlist';

const sortAttrs = (uuid: string, key: string, q: Query) => {
  // Each click moves one step along none → ascending → descending → none.
  const next = q.sort?.key !== key ? key : q.sort.desc ? '' : `-${key}`;
  return ` data-on-click="dqSet" data-macro="${esc(uuid)}" data-name="sort" data-value="${esc(next)}"`;
};
const arrowOf = (key: string, q: Query) => (q.sort?.key === key ? (q.sort.desc ? ' ▼' : ' ▲') : '');

const ADD_ROW_TITLE = 'Add a row below the last one (or press Enter on the last row)';

export function tableHtml(result: QueryResult, q: Query, uuid: string, opts: TableOpts = {}): string {
  if (!result.rows.length)
    return `<div class="dq-tbl dq-nodata" data-on-click="dqNoop" data-macro="${esc(uuid)}"><p class="dq-empty">No rows match. <button class="dq-sb" data-act="addrow" title="${ADD_ROW_TITLE}">+ row</button></p></div>`;
  const cols = shownCols(result, q, opts.extraCols);
  const by = q.by && !q.hide.includes(q.by) ? q.by : undefined;
  const head = cols
    .map((k) => {
      const t = result.types[k] ?? 'string';
      const { name, unit } = splitUnit(k);
      return `<th class="dq-sortable${alignRight(t) ? ' dq-num' : ''}"${sortAttrs(uuid, k, q)}>${esc(name)}${arrowOf(k, q)}<span class="dq-type" title="unit: ${esc(unit)}">${esc(unit)} · ${t}</span></th>`;
    })
    .join('');
  const first = by ? `<th class="dq-sortable"${sortAttrs(uuid, by, q)}>${esc(by)}${arrowOf(by, q)}</th>` : '<th>block</th>';
  const body = result.rows
    .map((r, i) => {
      const cells = cols
        .map((k) => {
          const t = result.types[k] ?? 'string';
          const v = r.values[k];
          const f = r.formulas?.[k];
          const bad = r.errors?.[k];
          const cls = [alignRight(t) ? 'dq-num' : '', cellClass(t, v), r.conflicts[k] ? 'dq-conflict' : '', f ? 'dq-formula' : '', bad ? 'dq-fail' : ''].filter(Boolean).join(' ');
          const tip = bad ? `${f} → ${bad}` : f ?? (r.conflicts[k] ? r.conflicts[k].map((c) => `${c.value} (${c.pageTitle})`).join(' / ') : '');
          const alt = tip ? ` title="${esc(tip)}"` : '';
          // `data-col` + the row's `data-row` let a double-click find the block to edit.
          return `<td class="${cls}" data-col="${esc(k)}"${alt}>${bad ? '#ERR' : cellHtml(v ?? '', opts.graphPath, opts.assetScheme)}${r.conflicts[k] ? '<sup>⚠</sup>' : ''}</td>`;
        })
        .join('');
      // A chart point finds its rows by the value of its group key: `color` (every row of that
      // colour), else `by` (one merged row).
      const gk = q.color ?? q.by;
      const key = gk && r.values[gk] !== undefined ? ` data-key="${esc(canonical(r.values[gk]))}"` : '';
      return `<tr data-uuid="${esc(r.sources[0].uuid)}" data-row="${i}"${key}><td class="dq-link" data-on-click="dqJump" data-uuid="${esc(r.sources[0].uuid)}">${esc(rowLabel(r, by))}</td>${cells}<td></td></tr>`;
    })
    .join('');
  const add = '<th class="dq-addcol" data-act="addcol" title="Add a property">+</th>';
  const addRow = `<tr class="dq-addrow"><td colspan="${cols.length + 2}" data-act="addrow" title="${ADD_ROW_TITLE}">+</td></tr>`;
  // `tabindex` lets the table take the keyboard: arrows move the cell, typing edits it (host script).
  return `<div class="dq-tbl" tabindex="0" data-on-click="dqNoop" data-macro="${esc(uuid)}" style="--dq-img:${q.img ?? IMG_DEFAULT}px"><table><thead><tr>${first}${head}${add}</tr></thead><tbody>${body}</tbody><tfoot>${addRow}</tfoot></table></div>`;
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The rows and columns on screen as CSV (RFC 4180: CRLF between records, quotes doubled). */
export function toCsv(result: QueryResult, by?: string, hide: string[] = []): string {
  const cols = result.cols.filter((k) => !hide.includes(k));
  const b = by && !hide.includes(by) ? by : undefined;
  const lines = [[b ?? 'block', ...cols]];
  for (const r of result.rows) lines.push([rowLabel(r, b), ...cols.map((k) => r.values[k] ?? '')]);
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n');
}

/** The chart of a view, or null for a table or when its axes cannot be chosen. */
export function chartOf(d: ViewData, opts: ChartOpts = {}): Chart | null {
  const { kind, query: q, result: res } = d;
  const { x, ys, color } = res.axes;
  if (kind === 'table' || !x || !ys.length) return null;
  if (kind === 'scatter')
    return scatterSvg(res.chartRows ?? res.rows, { x, y: ys[0], color, labels: q.labels, err: q.err }, res.types, q.by, opts);
  // With `x:` or `color:` on the `by` key each bar is one `by` value; it spans that value's blocks
  // (unmerged), so the whisker shows their min–max instead of a single merged row.
  const rows = q.by && (x === q.by || color === q.by) ? res.chartRows ?? res.rows : res.rows;
  return barSvg(rows, { x, ys, color }, res.types, opts);
}

/** The caret message shown under the query field. */
export function errorHtml(dsl: string, message: string, col: number): string {
  return `<pre>${esc(dsl)}\n${' '.repeat(col)}^</pre><p>${esc(message)}</p>`;
}

/** Enter saves (handled by the host script); `dqNoop` keeps clicks here from opening the block editor. */
const dslInput = (uuid: string, dsl: string, bad: boolean) =>
  `<input class="dq-dsl${bad ? ' dq-bad' : ''}" type="text" spellcheck="false" value="${esc(dsl)}" placeholder="#tag key==value x:column — Enter to apply" data-on-click="dqNoop" data-macro="${esc(uuid)}">`;

/** On/off button over `err:`; the host works out the next value from the macro text when clicked. */
const errToggle = (uuid: string, mode: 'bar' | 'band', on: boolean, icon: string, what: string) =>
  `<button class="dq-sb dq-tg" data-on-click="dqSet" data-macro="${esc(uuid)}" data-name="err" data-toggle="${mode}" aria-pressed="${on}" title="${what}: ${on ? 'on' : 'off'}" aria-label="${what}">${icon}</button>`;

function select(uuid: string, name: string, label: string, options: string[], current: string | undefined, none?: string): string {
  const opts = options.map((k) => [k, k]);
  if (current && !options.includes(current)) opts.unshift([current, current.split(',').join(', ')]);
  if (none !== undefined) opts.unshift(['', none]);
  else if (!current) opts.unshift(['', '—']);
  const html = opts.map(([v, l]) => `<option value="${esc(v)}"${v === (current ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
  return `<label class="dq-ctl"><span>${label}</span><select class="dq-sel" data-on-change="dqSet" data-macro="${esc(uuid)}" data-name="${name}" aria-label="${label}">${html}</select></label>`;
}

/**
 * Bar chart Y: a chip per column drawn, each with × to remove it (only once `y:` is written), and
 * a `+ Y` select of the numeric columns not drawn yet. The host rewrites `y:` from the macro text
 * as it is when clicked; `data-default` is only the column drawn while there is no `y:`.
 */
function yChips(uuid: string, q: Query, ys: string[], numeric: string[]): string {
  const m = esc(uuid);
  const chips = ys
    .map((k) => {
      const x = q.ys.length
        ? `<button class="dq-chipx" data-on-click="dqSet" data-macro="${m}" data-name="y" data-op="remove" data-col="${esc(k)}" title="Remove ${esc(k)}" aria-label="Remove ${esc(k)}">×</button>`
        : '';
      return `<span class="dq-chip">${esc(k)}${x}</span>`;
    })
    .join('');
  const rest = numeric.filter((k) => !ys.includes(k));
  const add = rest.length
    ? `<select class="dq-sel dq-addy" data-on-change="dqSet" data-macro="${m}" data-name="y" data-op="add" data-default="${esc(ys.join(','))}" aria-label="Add a Y column"><option value="" selected>+ Y</option>${rest.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join('')}</select>`
    : '';
  return `<div class="dq-ctl dq-ys"><span>Y</span><div class="dq-chips">${chips}</div>${add}</div>`;
}

const button = (act: string, icon: string, title: string) =>
  `<button class="dq-sb" data-act="${act}" title="${title}" aria-label="${title}">${icon}</button>`;

/** Cols ▾: one checkbox per column (the `by` key too); unticking writes it into `hide:`. */
function colsMenu(uuid: string, q: Query, cols: string[]): string {
  const m = esc(uuid);
  const items = cols
    .map((k) => `<label><input type="checkbox" data-on-change="dqSet" data-macro="${m}" data-name="hide" data-op="toggle" data-col="${esc(k)}"${q.hide.includes(k) ? '' : ' checked'}>${esc(k)}</label>`)
    .join('');
  return `<details class="dq-cols"><summary>Cols ▾</summary><div class="dq-colsl">${items}</div></details>`;
}

/** Img − / +: the height of every thumbnail in the table, one ×1.25 step per press. */
function imgButtons(uuid: string): string {
  const b = (op: string, icon: string, what: string) =>
    `<button class="dq-sb" data-on-click="dqSet" data-macro="${esc(uuid)}" data-name="img" data-op="${op}" title="${what}" aria-label="${what}">${icon}</button>`;
  return `<div class="dq-ctl dq-imgs"><span>Img</span>${b('dec', '−', 'Smaller images (or Ctrl+wheel on one)')}${b('inc', '+', 'Larger images (or Ctrl+wheel on one)')}</div>`;
}

/** The column of controls on the right; every choice rewrites the macro except reset and enlarge. */
function sideHtml(inp: InlineInput, q: Query, res: QueryResult): string {
  const uuid = inp.macroUuid;
  const csv = button('csv', 'CSV', 'Copy the table as CSV');
  const full = button('full', '⛶', 'Table full screen (Esc to leave)');
  let html = '';
  // The `by` key is the table's first column; the axes may take it too.
  const cols = q.by ? [q.by, ...res.cols] : res.cols;
  const numeric = cols.filter((k) => isAxisNumeric(typeOf(res.types, k)));
  if (inp.kind === 'scatter') {
    html += select(uuid, 'x', 'X', numeric, res.axes.x);
    html += select(uuid, 'y', 'Y', numeric, res.axes.ys[0]);
    // Without `color:` the points group and colour by `by:`; the blank choice says so.
    html += select(uuid, 'color', 'Color', cols, res.axes.color, q.by ? `by: ${q.by}` : 'none');
    html += errToggle(uuid, 'bar', q.err === 'bar', '±', 'Pool groups: mean and min–max error bars');
    html += errToggle(uuid, 'band', q.err === 'band', '▤', 'Pool groups: mean and min–max band');
    html += button('reset', '⟲', 'Reset axes (or double-click the plot)') + button('expand', '⤢', 'Enlarge') + full + csv;
  } else if (inp.kind === 'bar') {
    html += select(uuid, 'x', 'X', cols, res.axes.x);
    html += yChips(uuid, q, res.axes.ys, numeric);
    // `color:` splits each category into one bar per value.
    html += select(uuid, 'color', 'Color', cols, res.axes.color, 'none');
    html += button('expand', '⤢', 'Enlarge') + full + csv;
  } else html += full + csv;
  html += colsMenu(uuid, q, cols);
  if (hasImages(res, q)) html += imgButtons(uuid);
  return `<div class="dq-side" data-on-click="dqNoop" data-macro="${esc(uuid)}">${html}</div>`;
}

/** Label of the one-line toggle over a chart's table. */
export const tableToggleText = (open: boolean, n: number): string => `${open ? '▾' : '▸'} Table (${n} rows)`;

/** Under a chart the table is folded behind a one-line toggle; the host flips it (`data-act="table"`). */
function foldedTable(table: string, n: number, open: boolean): string {
  return `<div class="dq-fold${open ? ' dq-open' : ''}" data-on-click="dqNoop" data-n="${n}"><button class="dq-foldtg" data-act="table" aria-expanded="${open}">${tableToggleText(open, n)}</button>${table}</div>`;
}

const CHART_HINT: Record<Kind, string> = {
  table: '',
  scatter: 'Pick X and Y on the right: no two numeric columns to plot.',
  bar: 'Pick X and Y on the right: no category and numeric column to plot.',
};

/**
 * Whole inline view as an HTML string for `provideUI`; every data value is escaped.
 * Clicking blank space opens the block for editing, like Logseq's own renderers; parts that
 * take clicks themselves carry their own `data-on-click` so the nearest handler wins.
 */
export function renderInline(inp: InlineInput): string {
  const uuid = esc(inp.macroUuid);
  const root = (bad: boolean, meta: string, body: string, msg = '') =>
    `<div class="dq dq-${inp.kind}${inp.full ? ' dq-full' : ''}" data-on-click="dqEdit" data-macro="${uuid}"><div class="dq-head">${dslInput(inp.macroUuid, inp.dsl, bad)}${meta}</div><div class="dq-msg">${msg}</div>${body}</div>`;
  if (!inp.parsed.ok) {
    const { message, col } = inp.parsed.error;
    return root(true, '', '', errorHtml(inp.dsl, message, col));
  }
  if (inp.error || !inp.result) return root(false, '', '', `<p>Data query failed: ${esc(inp.error ?? 'no result')}</p>`);
  const q = inp.parsed.query;
  const res = inp.result;
  const nConflicts = res.rows.filter((r: Row) => Object.keys(r.conflicts).length).length;
  const meta = `<span class="dq-meta">${res.rows.length} rows${nConflicts ? ` · <span class="dq-warn">⚠ ${nConflicts}</span>` : ''}</span>`;
  let chart = '';
  if (inp.kind !== 'table') {
    const c = chartOf({ kind: inp.kind, query: q, result: res }, inp.chartOpts);
    const inner = c ? `<div class="dq-plot">${c.html}</div>${legendHtml(c.legend)}` : `<p class="dq-empty">${CHART_HINT[inp.kind]}</p>`;
    chart = `<div class="dq-chartbox" data-on-click="dqNoop" data-macro="${uuid}">${inner}</div>`;
  }
  const tbl = tableHtml(res, q, inp.macroUuid, { graphPath: inp.graphPath, assetScheme: inp.assetScheme, extraCols: inp.extraCols });
  const table = inp.kind === 'table' ? tbl : foldedTable(tbl, res.rows.length, !!inp.tableOpen);
  const notes = res.warnings.map((w) => `<p class="dq-note">${esc(w)}</p>`).join('');
  return root(false, meta, `<div class="dq-body"><div class="dq-main">${chart}${table}${notes}</div>${sideHtml(inp, q, res)}</div>`);
}

/** Shown in place of the first design's `{{renderer :dataquery}}`. */
export function renderLegacy(): string {
  return '<div class="dq dq-legacy"><p class="dq-note">Data query now uses DQtable, DQscatter and DQbar. Replace this macro, e.g. {{renderer :DQtable, #tag}}.</p></div>';
}
