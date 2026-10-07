import { barSvg, legendHtml, scatterSvg, type Chart, type ChartOpts } from './chart';
import type { ErrMode, Kind, ParseResult, Query } from './dsl';
import { esc } from './html';
import { isAxisNumeric, typeOf, type QueryResult } from './query';
import { rowLabel, type Row } from './rows';
import { cellMean, isNumericType, type ValueType } from './types';

export interface InlineInput {
  kind: Kind;
  macroUuid: string;
  dsl: string;
  parsed: ParseResult;
  result?: QueryResult;
  error?: string;
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

export function tableHtml(result: QueryResult, q: Query, uuid: string): string {
  if (!result.rows.length) return '<p class="dq-empty">No rows match.</p>';
  const head = result.cols
    .map((k) => {
      const t = result.types[k] ?? 'string';
      return `<th class="dq-sortable${alignRight(t) ? ' dq-num' : ''}"${sortAttrs(uuid, k, q)}>${esc(k)}${arrowOf(k, q)}<span class="dq-type">${t}</span></th>`;
    })
    .join('');
  const first = q.by ? `<th class="dq-sortable"${sortAttrs(uuid, q.by, q)}>${esc(q.by)}${arrowOf(q.by, q)}</th>` : '<th>block</th>';
  const body = result.rows
    .map((r) => {
      const cells = result.cols
        .map((k) => {
          const t = result.types[k] ?? 'string';
          const v = r.values[k];
          const cls = [alignRight(t) ? 'dq-num' : '', cellClass(t, v), r.conflicts[k] ? 'dq-conflict' : ''].filter(Boolean).join(' ');
          const alt = r.conflicts[k] ? ` title="${esc(r.conflicts[k].map((c) => `${c.value} (${c.pageTitle})`).join(' / '))}"` : '';
          return `<td class="${cls}"${alt}>${esc(v ?? '')}${r.conflicts[k] ? '<sup>⚠</sup>' : ''}</td>`;
        })
        .join('');
      return `<tr data-uuid="${esc(r.sources[0].uuid)}"><td class="dq-link" data-on-click="dqJump" data-uuid="${esc(r.sources[0].uuid)}">${esc(rowLabel(r, q.by))}</td>${cells}</tr>`;
    })
    .join('');
  return `<div class="dq-tbl" data-on-click="dqNoop"><table><thead><tr>${first}${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The rows and columns on screen as CSV (RFC 4180: CRLF between records, quotes doubled). */
export function toCsv(result: QueryResult, by?: string): string {
  const lines = [[by ?? 'block', ...result.cols]];
  for (const r of result.rows) lines.push([rowLabel(r, by), ...result.cols.map((k) => r.values[k] ?? '')]);
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n');
}

/** The chart of a view, or null for a table or when its axes cannot be chosen. */
export function chartOf(d: ViewData, opts: ChartOpts = {}): Chart | null {
  const { kind, query: q, result: res } = d;
  const { x, ys, color } = res.axes;
  if (kind === 'table' || !x || !ys.length) return null;
  return kind === 'scatter'
    ? scatterSvg(res.rows, { x, y: ys[0], color, labels: q.labels, err: q.err }, res.types, q.by, opts)
    : barSvg(res.rows, { x, ys }, res.types, opts);
}

/** The caret message shown under the query field. */
export function errorHtml(dsl: string, message: string, col: number): string {
  return `<pre>${esc(dsl)}\n${' '.repeat(col)}^</pre><p>${esc(message)}</p>`;
}

/** Enter saves (handled by the host script); `dqNoop` keeps clicks here from opening the block editor. */
const dslInput = (uuid: string, dsl: string, bad: boolean) =>
  `<input class="dq-dsl${bad ? ' dq-bad' : ''}" type="text" spellcheck="false" value="${esc(dsl)}" placeholder="#tag key==value x:column — Enter to apply" data-on-click="dqNoop" data-macro="${esc(uuid)}">`;

const NEXT_ERR: Record<ErrMode, string> = { bar: 'band', band: 'off', off: '' };

function select(uuid: string, name: string, label: string, options: string[], current: string | undefined, none?: string): string {
  const opts = options.map((k) => [k, k]);
  if (current && !options.includes(current)) opts.unshift([current, current.split(',').join(', ')]);
  if (none !== undefined) opts.unshift(['', none]);
  else if (!current) opts.unshift(['', '—']);
  const html = opts.map(([v, l]) => `<option value="${esc(v)}"${v === (current ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
  return `<label class="dq-ctl"><span>${label}</span><select class="dq-sel" data-on-change="dqSet" data-macro="${esc(uuid)}" data-name="${name}" aria-label="${label}">${html}</select></label>`;
}

const button = (act: string, icon: string, title: string) =>
  `<button class="dq-sb" data-act="${act}" title="${title}" aria-label="${title}">${icon}</button>`;

/** The column of controls on the right; every choice rewrites the macro except reset and enlarge. */
function sideHtml(inp: InlineInput, q: Query, res: QueryResult): string {
  const uuid = inp.macroUuid;
  const csv = button('csv', 'CSV', 'Copy the table as CSV');
  let html = '';
  if (inp.kind === 'scatter') {
    const numeric = res.cols.filter((k) => isAxisNumeric(typeOf(res.types, k)));
    const next = NEXT_ERR[q.err];
    html += select(uuid, 'x', 'X', numeric, res.axes.x);
    html += select(uuid, 'y', 'Y', numeric, res.axes.ys[0]);
    html += select(uuid, 'color', 'Color', res.cols, res.axes.color, 'none');
    html += `<button class="dq-sb" data-on-click="dqSet" data-macro="${esc(uuid)}" data-name="err" data-value="${next}" title="Min–max: ${q.err} (click for ${next || 'bar'})" aria-label="Min–max: ${q.err}">±</button>`;
    html += button('reset', '⟲', 'Reset axes (or double-click the plot)') + button('expand', '⤢', 'Enlarge') + csv;
  } else if (inp.kind === 'bar') {
    const cats = res.cols.filter((k) => ['category', 'string'].includes(typeOf(res.types, k)));
    const numeric = res.cols.filter((k) => isAxisNumeric(typeOf(res.types, k)));
    html += select(uuid, 'x', 'X', cats, res.axes.x);
    html += select(uuid, 'y', 'Y', numeric, res.axes.ys.join(',') || undefined);
    html += button('expand', '⤢', 'Enlarge') + csv;
  } else html += csv;
  return `<div class="dq-side" data-on-click="dqNoop" data-macro="${esc(uuid)}">${html}</div>`;
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
    `<div class="dq dq-${inp.kind}" data-on-click="dqEdit" data-macro="${uuid}"><div class="dq-head">${dslInput(inp.macroUuid, inp.dsl, bad)}${meta}</div><div class="dq-msg">${msg}</div>${body}</div>`;
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
    const c = chartOf({ kind: inp.kind, query: q, result: res });
    const inner = c ? `<div class="dq-plot">${c.html}</div>${legendHtml(c.legend)}` : `<p class="dq-empty">${CHART_HINT[inp.kind]}</p>`;
    chart = `<div class="dq-chartbox" data-on-click="dqNoop" data-macro="${uuid}">${inner}<div class="dq-tip" hidden></div></div>`;
  }
  const notes = res.warnings.map((w) => `<p class="dq-note">${esc(w)}</p>`).join('');
  return root(false, meta, `<div class="dq-body"><div class="dq-main">${chart}${tableHtml(res, q, inp.macroUuid)}${notes}</div>${sideHtml(inp, q, res)}</div>`);
}

/** Shown in place of the first design's `{{renderer :dataquery}}`. */
export function renderLegacy(): string {
  return '<div class="dq dq-legacy"><p class="dq-note">Data query now uses DQtable, DQscatter and DQbar. Replace this macro, e.g. {{renderer :DQtable, #tag}}.</p></div>';
}
