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
          return `<td class="${cls}">${esc(v ?? '')}${r.conflicts[k] ? '<sup>⚠</sup>' : ''}</td>`;
        })
        .join('');
      return `<tr><td class="dq-link" data-on-click="dqJump" data-uuid="${esc(r.sources[0].uuid)}">${esc(rowLabel(r, q.mergeBy))}</td>${cells}</tr>`;
    })
    .join('');
  return `<div class="dq-tbl"><table><thead><tr><th>${esc(q.mergeBy ?? 'block')}</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function conflictNotes(result: QueryResult, q: Query): string {
  const lines: string[] = [];
  for (const r of result.rows)
    for (const [k, list] of Object.entries(r.conflicts))
      lines.push(`⚠ ${esc(rowLabel(r, q.mergeBy))}: ${esc(k)} is ${list.map((c) => `${esc(c.value)} (${esc(c.pageTitle)})`).join(' / ')}. Showing the first.`);
  return lines.length ? `<div class="dq-conflicts">${lines.map((l) => `<p>${l}</p>`).join('')}</div>` : '';
}

/** Whole inline view as an HTML string for `provideUI`; every data value is escaped. */
/** Clicks inside plugin UI never reach Logseq's editor, so the view offers its own way back to the text. */
const editBtn = (uuid: string) => `<button class="dq-btn" data-on-click="dqEdit" data-macro="${esc(uuid)}">Edit</button>`;

export function renderInline(inp: InlineInput): string {
  if (!inp.parsed.ok) {
    const { message, col } = inp.parsed.error;
    return `<div class="dq dq-error"><pre>${esc(inp.dsl)}\n${' '.repeat(col)}^</pre><p>${esc(message)}</p>${editBtn(inp.macroUuid)}</div>`;
  }
  if (inp.error || !inp.result) {
    return `<div class="dq dq-error"><p>Data query failed: ${esc(inp.error ?? 'no result')}</p>${editBtn(inp.macroUuid)}</div>`;
  }
  const q = inp.parsed.query;
  const res = inp.result;
  const nConflicts = res.rows.filter((r) => Object.keys(r.conflicts).length).length;
  const uuid = esc(inp.macroUuid);
  const labelsBtn =
    q.plot?.kind === 'scatter'
      ? `<button class="dq-btn" data-on-click="dqToggleLabels" data-macro="${uuid}">${q.plot.labels ? 'Hide labels' : 'Show labels'}</button>`
      : '';
  const head = `<div class="dq-head"><code class="dq-dsl">${esc(inp.dsl) || 'all blocks with properties here'}</code><span class="dq-meta">${res.rows.length} rows${nConflicts ? ` · <span class="dq-warn">⚠ ${nConflicts}</span>` : ''}</span>${labelsBtn}${editBtn(inp.macroUuid)}<button class="dq-btn dq-open" data-on-click="dqOpen" data-macro="${uuid}">Open ↗</button></div>`;
  let chart = '';
  if (q.plot) {
    const c = q.plot.kind === 'scatter' ? scatterSvg(res.rows, q.plot, res.types, q.mergeBy) : barSvg(res.rows, q.plot, res.types);
    chart = `<div class="dq-chartbox">${c.html}${legendHtml(c.legend)}</div>`;
  }
  const notes = res.warnings.map((w) => `<p class="dq-note">${esc(w)}</p>`).join('');
  return `<div class="dq">${head}${chart}${tableHtml(res, q)}${conflictNotes(res, q)}${notes}</div>`;
}
