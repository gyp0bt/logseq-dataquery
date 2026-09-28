import type { BarPlot, ScatterPlot } from './dsl';
import { esc } from './html';
import { canonical, rowLabel, type Row } from './rows';
import { compareValues, toNumber, type ValueType } from './types';

export interface LegendItem { label: string; color: string; shape: 'dot' | 'square' | 'dash' | 'none' }
export interface Chart { html: string; legend: LegendItem[] }
export interface BarGroup { cat: string; n: number; stats: Array<{ mean: number; min: number; max: number; n: number } | null> }

export const PALETTE_SIZE = 8;
export const colorFor = (i: number): string => (i < PALETTE_SIZE ? `var(--dq-c${i})` : 'var(--dq-muted)');

// viewBox and plot margins; the SVG scales to its container.
const W = 640, H = 360, L = 56, R = 16, T = 14, B = 48;
const PW = W - L - R, PH = H - T - B;
const NONE = '(none)';
const f1 = (n: number) => n.toFixed(1);

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!isFinite(lo) || !isFinite(hi)) return [0, 1];
  if (lo === hi) {
    const d = Math.abs(lo) || 1;
    lo -= d / 3;
    hi += d / 3;
  }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const r = raw / mag;
  const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  const first = Math.floor(lo / step + 1e-9);
  const last = Math.ceil(hi / step - 1e-9);
  const out: number[] = [];
  for (let i = first; i <= last; i++) out.push(Number((i * step).toPrecision(12)));
  return out;
}

export function formatTick(v: number, step: number): string {
  return v.toFixed(Math.min(6, Math.max(0, -Math.floor(Math.log10(step) + 1e-9))));
}

/** Shared prefix of point labels, cut back to the last '-' so labels stay readable. */
export function commonPrefix(labels: string[]): string {
  if (labels.length < 2) return '';
  let p = labels[0];
  for (const l of labels) while (!l.startsWith(p)) p = p.slice(0, -1);
  const cut = p.lastIndexOf('-');
  return cut >= 0 ? p.slice(0, cut + 1) : '';
}

function sortCats(cats: string[], t: ValueType): string[] {
  return [...cats].sort((a, b) => (a === NONE ? 1 : b === NONE ? -1 : compareValues(t, a, b)));
}

function axisTitle(key: string, t: ValueType | undefined): string {
  return esc(key) + (t === 'ratio' ? ' (ratio)' : '');
}

function frame(inner: string, label: string): string {
  return `<svg class="dq-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${inner}</svg>`;
}

const catOf = (v: string | undefined) => (v === undefined ? NONE : canonical(v));

const empty = (msg: string): Chart => ({ html: `<p class="dq-empty">${esc(msg)}</p>`, legend: [] });

export function scatterSvg(rows: Row[], plot: ScatterPlot, types: Record<string, ValueType>, mergeBy?: string): Chart {
  const pts = rows
    .map((r) => ({ r, x: toNumber(r.values[plot.x]), y: toNumber(r.values[plot.y]) }))
    .filter((p) => !isNaN(p.x) && !isNaN(p.y));
  if (!pts.length) return empty(`No rows have numeric ${plot.x} and ${plot.y}.`);
  const rx = types[plot.x] === 'ratio';
  const ry = types[plot.y] === 'ratio';
  // Ratio axes always include 1.00 so the threshold line is on screen.
  const xs = pts.map((p) => p.x).concat(rx ? [1] : []);
  const ys = pts.map((p) => p.y).concat(ry ? [1] : []);
  const tx = niceTicks(Math.min(...xs), Math.max(...xs));
  const ty = niceTicks(Math.min(...ys), Math.max(...ys));
  const [x0, x1, y0, y1] = [tx[0], tx[tx.length - 1], ty[0], ty[ty.length - 1]];
  const X = (v: number) => L + ((v - x0) / (x1 - x0)) * PW;
  const Y = (v: number) => T + PH - ((v - y0) / (y1 - y0)) * PH;
  let g = '';
  if (rx && ry) g += `<rect class="dq-passzone" x="${f1(L)}" y="${f1(Y(1))}" width="${f1(X(1) - L)}" height="${f1(T + PH - Y(1))}"/>`;
  for (const v of tx)
    g += `<line class="dq-grid" x1="${f1(X(v))}" y1="${T}" x2="${f1(X(v))}" y2="${T + PH}"/><text class="dq-tick" x="${f1(X(v))}" y="${T + PH + 15}" text-anchor="middle">${formatTick(v, tx[1] - tx[0])}</text>`;
  for (const v of ty)
    g += `<line class="dq-grid" x1="${L}" y1="${f1(Y(v))}" x2="${L + PW}" y2="${f1(Y(v))}"/><text class="dq-tick" x="${L - 6}" y="${f1(Y(v) + 3.5)}" text-anchor="end">${formatTick(v, ty[1] - ty[0])}</text>`;
  g += `<line class="dq-axis" x1="${L}" y1="${T + PH}" x2="${L + PW}" y2="${T + PH}"/><line class="dq-axis" x1="${L}" y1="${T}" x2="${L}" y2="${T + PH}"/>`;
  if (rx) g += `<line class="dq-ref" x1="${f1(X(1))}" y1="${T}" x2="${f1(X(1))}" y2="${T + PH}"/>`;
  if (ry) g += `<line class="dq-ref" x1="${L}" y1="${f1(Y(1))}" x2="${L + PW}" y2="${f1(Y(1))}"/>`;
  g += `<text class="dq-title" x="${L + PW / 2}" y="${H - 8}" text-anchor="middle">${axisTitle(plot.x, types[plot.x])}</text>`;
  g += `<text class="dq-title" x="14" y="${T + PH / 2}" text-anchor="middle" transform="rotate(-90 14 ${T + PH / 2})">${axisTitle(plot.y, types[plot.y])}</text>`;

  const legend: LegendItem[] = [];
  const colorOf = new Map<string, string>();
  if (plot.color) {
    const cats = sortCats([...new Set(pts.map((p) => catOf(p.r.values[plot.color!])))], types[plot.color] ?? 'string');
    cats.forEach((c, i) => {
      colorOf.set(c, colorFor(i));
      legend.push({ label: `${plot.color} = ${c}`, color: colorFor(i), shape: 'dot' });
    });
  }
  const labels = pts.map((p) => rowLabel(p.r, mergeBy));
  const prefix = plot.labels ? commonPrefix(labels) : '';
  pts.forEach((p, i) => {
    const fill = plot.color ? colorOf.get(catOf(p.r.values[plot.color]))! : 'var(--dq-c0)';
    const cx = f1(X(p.x));
    const cy = f1(Y(p.y));
    g += `<circle class="dq-pt" cx="${cx}" cy="${cy}" r="5.5" fill="${fill}" data-uuid="${esc(p.r.sources[0].uuid)}" data-on-click="dqJump"><title>${esc(labels[i])}  ${esc(plot.x)}=${esc(p.r.values[plot.x])}  ${esc(plot.y)}=${esc(p.r.values[plot.y])}</title></circle>`;
    if (plot.labels) g += `<text class="dq-lbl" x="${f1(X(p.x) + 8)}" y="${f1(Y(p.y) + 3.5)}">${esc(labels[i].slice(prefix.length) || labels[i])}</text>`;
  });
  if (rx || ry) legend.push({ label: 'ratio 1.00', color: 'var(--dq-fail)', shape: 'dash' });
  if (prefix) legend.push({ label: `labels omit '${prefix}'`, color: '', shape: 'none' });
  return { html: frame(g, `${plot.y} against ${plot.x}`), legend };
}

export function barGroups(rows: Row[], plot: BarPlot, types: Record<string, ValueType>): BarGroup[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const v = r.values[plot.x];
    const c = v === undefined ? NONE : canonical(v);
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(r);
  }
  return sortCats([...groups.keys()], types[plot.x] ?? 'string').map((cat) => {
    const rs = groups.get(cat)!;
    return {
      cat,
      n: rs.length,
      stats: plot.ys.map((k) => {
        const v = rs.map((r) => toNumber(r.values[k])).filter((x) => !isNaN(x));
        if (!v.length) return null;
        return { mean: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v), n: v.length };
      }),
    };
  });
}

export function barSvg(rows: Row[], plot: BarPlot, types: Record<string, ValueType>): Chart {
  const groups = barGroups(rows, plot, types);
  const all = groups.flatMap((gr) => gr.stats.filter((s): s is NonNullable<typeof s> => s !== null));
  if (!all.length) return empty(`No rows have numeric ${plot.ys.join(', ')}.`);
  const anyRatio = plot.ys.some((k) => types[k] === 'ratio');
  const lo = Math.min(0, ...all.map((s) => s.min));
  const hi = Math.max(0, ...all.map((s) => s.max), anyRatio ? 1 : -Infinity);
  const ty = niceTicks(lo, hi);
  const [y0, y1] = [ty[0], ty[ty.length - 1]];
  const Y = (v: number) => T + PH - ((v - y0) / (y1 - y0)) * PH;
  let g = '';
  for (const v of ty)
    g += `<line class="dq-grid" x1="${L}" y1="${f1(Y(v))}" x2="${L + PW}" y2="${f1(Y(v))}"/><text class="dq-tick" x="${L - 6}" y="${f1(Y(v) + 3.5)}" text-anchor="end">${formatTick(v, ty[1] - ty[0])}</text>`;
  const gw = PW / groups.length;
  const bw = Math.min(40, (gw * 0.8) / plot.ys.length);
  groups.forEach((gr, i) => {
    const cx = L + gw * (i + 0.5);
    const left = cx - (bw * plot.ys.length) / 2;
    gr.stats.forEach((s, j) => {
      if (!s) return;
      const x = left + j * bw;
      const top = Math.min(Y(s.mean), Y(0));
      g += `<rect class="dq-bar" x="${f1(x + 1)}" y="${f1(top)}" width="${f1(bw - 2)}" height="${f1(Math.abs(Y(0) - Y(s.mean)))}" fill="${colorFor(j)}"><title>${esc(gr.cat)} ${esc(plot.ys[j])}: mean ${s.mean.toPrecision(4)} (min ${s.min}, max ${s.max}, n=${s.n})</title></rect>`;
      if (s.n >= 2) {
        const m = f1(x + bw / 2);
        const a = f1(x + bw / 2 - 5);
        const b = f1(x + bw / 2 + 5);
        g += `<g class="dq-whisker"><line x1="${m}" y1="${f1(Y(s.max))}" x2="${m}" y2="${f1(Y(s.min))}"/><line x1="${a}" y1="${f1(Y(s.max))}" x2="${b}" y2="${f1(Y(s.max))}"/><line x1="${a}" y1="${f1(Y(s.min))}" x2="${b}" y2="${f1(Y(s.min))}"/></g>`;
      }
    });
    g += `<text class="dq-cat" x="${f1(cx)}" y="${T + PH + 16}" text-anchor="middle">${esc(gr.cat)}</text><text class="dq-tick" x="${f1(cx)}" y="${T + PH + 30}" text-anchor="middle">n=${gr.n}</text>`;
  });
  g += `<line class="dq-axis" x1="${L}" y1="${f1(Y(0))}" x2="${L + PW}" y2="${f1(Y(0))}"/><line class="dq-axis" x1="${L}" y1="${T}" x2="${L}" y2="${T + PH}"/>`;
  if (anyRatio) g += `<line class="dq-ref" x1="${L}" y1="${f1(Y(1))}" x2="${L + PW}" y2="${f1(Y(1))}"/>`;
  const legend: LegendItem[] = plot.ys.map((k, j) => ({ label: k, color: colorFor(j), shape: 'square' }));
  legend.push({ label: 'whiskers: min–max (n ≥ 2)', color: '', shape: 'none' });
  if (anyRatio) legend.push({ label: 'ratio 1.00', color: 'var(--dq-fail)', shape: 'dash' });
  return { html: frame(g, `${plot.ys.join(', ')} by ${plot.x}`), legend };
}

export function legendHtml(items: LegendItem[]): string {
  if (!items.length) return '';
  const mark = (i: LegendItem) =>
    i.shape === 'none' ? '' : `<i class="dq-mark dq-${i.shape}" style="${i.shape === 'dash' ? 'border-color' : 'background'}:${i.color}"></i>`;
  return `<div class="dq-legend">${items.map((i) => `<span>${mark(i)}${esc(i.label)}</span>`).join('')}</div>`;
}
