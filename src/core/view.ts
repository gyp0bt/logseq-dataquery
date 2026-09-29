import { barSvg, legendHtml, scatterSvg } from './chart';
import type { ParseResult, Query } from './dsl';
import { esc } from './html';
import type { QueryResult } from './query';
import { rowLabel } from './rows';
import { isNumericType, toNumber, type ValueType } from './types';

export interface InlineInput {
  macroUuid: string;
  dsl: string;
  parsed: ParseResult;
  result?: QueryResult;
  error?: string;
}

export function cellClass(t: ValueType, v: string | undefined): string {
  if (t !== 'ratio') return '';
  const n = toNumber(v);
  return isNaN(n) ? '' : n < 1 ? 'dq-pass' : 'dq-fail';
}

const alignRight = (t: ValueType) => isNumericType(t) || t === 'numlist';

export function tableHtml(result: QueryResult, q: Query): string {
  if (!result.rows.length) return '<p class="dq-empty">No rows match.</p>';
  const sorted = q.sort[0];
  const head = result.cols
    .map((k) => {
      const t = result.types[k] ?? 'string';
      const arrow = sorted?.key === k ? (sorted.desc ? ' ▼' : ' ▲') : '';
      return `<th class="${alignRight(t) ? 'dq-num' : ''}">${esc(k)}${arrow}<span class="dq-type">${t}</span></th>`;
    })
    .join('');
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
      return `<tr data-uuid="${esc(r.sources[0].uuid)}"><td class="dq-link" data-on-click="dqJump" data-uuid="${esc(r.sources[0].uuid)}">${esc(rowLabel(r, q.mergeBy))}</td>${cells}</tr>`;
    })
    .join('');
  return `<div class="dq-tbl" data-on-click="dqNoop"><table><thead><tr><th>${esc(q.mergeBy ?? 'block')}</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** The caret message shown under the query field. */
export function errorHtml(dsl: string, message: string, col: number): string {
  return `<pre>${esc(dsl)}\n${' '.repeat(col)}^</pre><p>${esc(message)}</p>`;
}

/** Enter saves (handled by the host script); `dqNoop` keeps clicks here from opening the block editor. */
const dslInput = (uuid: string, dsl: string, bad: boolean) =>
  `<input class="dq-dsl${bad ? ' dq-bad' : ''}" type="text" spellcheck="false" value="${esc(dsl)}" placeholder="all blocks with properties — type a query, Enter to apply" data-on-click="dqNoop" data-macro="${esc(uuid)}">`;

const MODEBAR = [
  ['zoomin', '+', 'Zoom in'],
  ['zoomout', '−', 'Zoom out'],
  ['reset', '⟲', 'Reset axes (or double-click the plot)'],
  ['expand', '⤢', 'Enlarge'],
];

/**
 * Whole inline view as an HTML string for `provideUI`; every data value is escaped.
 * Clicking blank space opens the block for editing, like Logseq's own renderers; parts that
 * take clicks themselves carry their own `data-on-click` so the nearest handler wins.
 */
export function renderInline(inp: InlineInput): string {
  const uuid = esc(inp.macroUuid);
  const root = (bad: boolean, meta: string, body: string, msg = '') =>
    `<div class="dq" data-on-click="dqEdit" data-macro="${uuid}"><div class="dq-head">${dslInput(inp.macroUuid, inp.dsl, bad)}${meta}<button class="dq-btn dq-open" data-on-click="dqOpen" data-macro="${uuid}">Open ↗</button></div><div class="dq-msg">${msg}</div>${body}</div>`;
  if (!inp.parsed.ok) {
    const { message, col } = inp.parsed.error;
    return root(true, '', '', errorHtml(inp.dsl, message, col));
  }
  if (inp.error || !inp.result) return root(false, '', '', `<p>Data query failed: ${esc(inp.error ?? 'no result')}</p>`);
  const q = inp.parsed.query;
  const res = inp.result;
  const nConflicts = res.rows.filter((r) => Object.keys(r.conflicts).length).length;
  const meta = `<span class="dq-meta">${res.rows.length} rows${nConflicts ? ` · <span class="dq-warn">⚠ ${nConflicts}</span>` : ''}</span>`;
  let chart = '';
  if (q.plot) {
    const c = q.plot.kind === 'scatter' ? scatterSvg(res.rows, q.plot, res.types, q.mergeBy) : barSvg(res.rows, q.plot, res.types);
    const acts = q.plot.kind === 'scatter' ? MODEBAR : MODEBAR.filter(([a]) => a === 'expand');
    const bar = acts.map(([a, icon, title]) => `<button class="dq-mb" data-act="${a}" title="${title}" aria-label="${title}">${icon}</button>`).join('');
    chart = `<div class="dq-chartbox" data-on-click="dqNoop" data-macro="${uuid}"><div class="dq-modebar">${bar}</div><div class="dq-plot">${c.html}</div>${legendHtml(c.legend)}<div class="dq-tip" hidden></div></div>`;
  }
  const notes = res.warnings.map((w) => `<p class="dq-note">${esc(w)}</p>`).join('');
  return root(false, meta, `${chart}${tableHtml(res, q)}${notes}`);
}
