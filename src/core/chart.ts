import type { ErrMode } from './dsl';
import { esc } from './html';
import { canonical, rowLabel, type Row } from './rows';
import { cellMean, cellStats, compareValues, type CellStats, type ValueType } from './types';

export interface ScatterSpec { x: string; y: string; color?: string; labels: boolean; err: ErrMode }
export interface BarSpec { x: string; ys: string[] }

export interface LegendItem { label: string; color: string; shape: 'dot' | 'square' | 'dash' | 'none' }
export interface Chart { html: string; legend: LegendItem[] }
export interface BarGroup { cat: string; n: number; stats: Array<{ mean: number; min: number; max: number; n: number } | null> }

export const PALETTE_SIZE = 10;
/** Cycles through the colorway, as plotly does. */
export const colorFor = (i: number): string => `var(--dq-c${i % PALETTE_SIZE})`;

/** Pixel size to draw at. Without one the SVG uses a 640×360 viewBox and scales to its container. */
export interface ChartSize { w: number; h: number }
/** Visible data range of a zoomed scatter plot. */
export interface Domain { x0: number; x1: number; y0: number; y1: number }
export interface ChartOpts { size?: ChartSize; view?: Domain }

interface Box { W: number; H: number; L: number; T: number; PW: number; PH: number; sized: boolean }
function box(size?: ChartSize): Box {
  const W = Math.max(240, size?.w ?? 640), H = Math.max(200, size?.h ?? 360);
  const L = 64, R = 20, T = 16, B = 52;
  return { W, H, L, T, PW: W - L - R, PH: H - T - B, sized: !!size };
}
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

function frame(b: Box, inner: string, label: string, data = ''): string {
  const px = b.sized ? ` width="${b.W}" height="${b.H}"` : '';
  return `<svg class="dq-chart" viewBox="0 0 ${b.W} ${b.H}"${px} role="img" aria-label="${esc(label)}"${data}>${inner}</svg>`;
}

/** Ticks for an axis: a zoomed axis keeps its exact range and shows only the ticks inside it. */
function axis(values: number[], view?: [number, number]): { lo: number; hi: number; ticks: number[] } {
  if (!view) {
    const t = niceTicks(Math.min(...values), Math.max(...values));
    return { lo: t[0], hi: t[t.length - 1], ticks: t };
  }
  const [lo, hi] = view;
  const t = niceTicks(lo, hi, 6);
  const eps = (hi - lo) * 1e-9;
  return { lo, hi, ticks: t.filter((v) => v >= lo - eps && v <= hi + eps) };
}

const tipLine = (k: string, v: string | undefined) => `${k}: ${v ?? ''}`;
const p4 = (n: number) => Number(n.toPrecision(4));
/** Hover line for an axis value; a cell with several numbers shows their mean, range and count. */
const statLine = (k: string, v: string | undefined, st: CellStats) =>
  st.n >= 2 ? `${k}: mean ${p4(st.mean)} · min ${st.min} · max ${st.max} · n=${st.n}` : tipLine(k, v);

const catOf = (v: string | undefined) => (v === undefined ? NONE : canonical(v));

const empty = (msg: string): Chart => ({ html: `<p class="dq-empty">${esc(msg)}</p>`, legend: [] });

export function scatterSvg(rows: Row[], plot: ScatterSpec, types: Record<string, ValueType>, by?: string, opts: ChartOpts = {}): Chart {
  const b = box(opts.size);
  const { L, T, PW, PH, H } = b;
  // A cell with several numbers is drawn at their mean; its min–max is the error bar or band.
  const pts = rows
    .map((r) => ({ r, sx: cellStats(r.values[plot.x]), sy: cellStats(r.values[plot.y]) }))
    .filter((p): p is { r: Row; sx: CellStats; sy: CellStats } => p.sx !== null && p.sy !== null)
    .map((p) => ({ ...p, x: p.sx.mean, y: p.sy.mean }));
  if (!pts.length) return empty(`No rows have numeric ${plot.x} and ${plot.y}.`);
  const rx = types[plot.x] === 'ratio';
  const ry = types[plot.y] === 'ratio';
  const spread = plot.err !== 'off';
  // Ratio axes always include 1.00 so the threshold line is on screen; ranges include the error bars.
  const xs = pts.flatMap((p) => (spread ? [p.sx.min, p.sx.max] : [p.x])).concat(rx ? [1] : []);
  const ys = pts.flatMap((p) => (spread ? [p.sy.min, p.sy.max] : [p.y])).concat(ry ? [1] : []);
  const v = opts.view;
  const ax = axis(xs, v && [v.x0, v.x1]);
  const ay = axis(ys, v && [v.y0, v.y1]);
  const [tx, ty] = [ax.ticks, ay.ticks];
  const [x0, x1, y0, y1] = [ax.lo, ax.hi, ay.lo, ay.hi];
  const step = (t: number[]) => (t.length > 1 ? t[1] - t[0] : Math.abs(t[0]) || 1);
  const X = (v: number) => L + ((v - x0) / (x1 - x0)) * PW;
  const Y = (v: number) => T + PH - ((v - y0) / (y1 - y0)) * PH;
  const clip = (n: number, a: number, z: number) => Math.min(z, Math.max(a, n));
  let g = `<rect class="dq-area" x="${L}" y="${T}" width="${PW}" height="${PH}"/>`;
  if (rx && ry && X(1) >= L && Y(1) <= T + PH) {
    const zx = clip(X(1), L, L + PW), zy = clip(Y(1), T, T + PH);
    g += `<rect class="dq-passzone" x="${f1(L)}" y="${f1(zy)}" width="${f1(zx - L)}" height="${f1(T + PH - zy)}"/>`;
  }
  for (const v of tx)
    g += `<line class="dq-grid" x1="${f1(X(v))}" y1="${T}" x2="${f1(X(v))}" y2="${T + PH}"/><text class="dq-tick" x="${f1(X(v))}" y="${T + PH + 17}" text-anchor="middle">${formatTick(v, step(tx))}</text>`;
  for (const v of ty)
    g += `<line class="dq-grid" x1="${L}" y1="${f1(Y(v))}" x2="${L + PW}" y2="${f1(Y(v))}"/><text class="dq-tick" x="${L - 6}" y="${f1(Y(v) + 3.5)}" text-anchor="end">${formatTick(v, step(ty))}</text>`;
  // Plotly draws no axis box, only a thicker zero line when 0 is in range.
  if (x0 < 0 && x1 > 0) g += `<line class="dq-zero" x1="${f1(X(0))}" y1="${T}" x2="${f1(X(0))}" y2="${T + PH}"/>`;
  if (y0 < 0 && y1 > 0) g += `<line class="dq-zero" x1="${L}" y1="${f1(Y(0))}" x2="${L + PW}" y2="${f1(Y(0))}"/>`;
  if (rx && X(1) >= L && X(1) <= L + PW) g += `<line class="dq-ref" x1="${f1(X(1))}" y1="${T}" x2="${f1(X(1))}" y2="${T + PH}"/>`;
  if (ry && Y(1) >= T && Y(1) <= T + PH) g += `<line class="dq-ref" x1="${L}" y1="${f1(Y(1))}" x2="${L + PW}" y2="${f1(Y(1))}"/>`;
  g += `<text class="dq-title" x="${L + PW / 2}" y="${H - 10}" text-anchor="middle">${axisTitle(plot.x, types[plot.x])}</text>`;
  g += `<text class="dq-title" x="16" y="${T + PH / 2}" text-anchor="middle" transform="rotate(-90 16 ${T + PH / 2})">${axisTitle(plot.y, types[plot.y])}</text>`;

  const legend: LegendItem[] = [];
  const colorOf = new Map<string, string>();
  if (plot.color) {
    const cats = sortCats([...new Set(pts.map((p) => catOf(p.r.values[plot.color!])))], types[plot.color] ?? 'string');
    cats.forEach((c, i) => {
      colorOf.set(c, colorFor(i));
      legend.push({ label: `${plot.color} = ${c}`, color: colorFor(i), shape: 'dot' });
    });
  }
  const fillOf = (r: Row) => (plot.color ? colorOf.get(catOf(r.values[plot.color]))! : 'var(--dq-c0)');

  // Bars and bands sit in a nested <svg> the size of the plot area, which clips them when zoomed.
  let spreadG = '';
  const multi = pts.some((p) => p.sx.n >= 2 || p.sy.n >= 2);
  if (plot.err === 'bar') {
    for (const p of pts) {
      if (p.sy.n >= 2) {
        const cx = f1(X(p.x)), a = f1(X(p.x) - 4), z = f1(X(p.x) + 4), hi = f1(Y(p.sy.max)), lo = f1(Y(p.sy.min));
        spreadG += `<g class="dq-err"><line x1="${cx}" y1="${hi}" x2="${cx}" y2="${lo}"/><line x1="${a}" y1="${hi}" x2="${z}" y2="${hi}"/><line x1="${a}" y1="${lo}" x2="${z}" y2="${lo}"/></g>`;
      }
      if (p.sx.n >= 2) {
        const cy = f1(Y(p.y)), a = f1(Y(p.y) - 4), z = f1(Y(p.y) + 4), lo = f1(X(p.sx.min)), hi = f1(X(p.sx.max));
        spreadG += `<g class="dq-err"><line x1="${lo}" y1="${cy}" x2="${hi}" y2="${cy}"/><line x1="${lo}" y1="${a}" x2="${lo}" y2="${z}"/><line x1="${hi}" y1="${a}" x2="${hi}" y2="${z}"/></g>`;
      }
    }
    if (multi) legend.push({ label: 'bars: min–max in each row', color: '', shape: 'none' });
  } else if (plot.err === 'band') {
    // Like plotly's fill='tonexty': per colour, means joined in x order over a translucent min–max band.
    const groups = new Map<string, typeof pts>();
    for (const p of pts) {
      const f = fillOf(p.r);
      if (!groups.has(f)) groups.set(f, []);
      groups.get(f)!.push(p);
    }
    for (const [fill, ps] of groups) {
      const sorted = [...ps].sort((a, b) => a.x - b.x);
      const upper = sorted.map((p) => `${f1(X(p.x))},${f1(Y(p.sy.max))}`);
      const lower = sorted.map((p) => `${f1(X(p.x))},${f1(Y(p.sy.min))}`).reverse();
      spreadG += `<path class="dq-band" d="M${[...upper, ...lower].join(' L')} Z" fill="${fill}" fill-opacity="0.2"/>`;
      spreadG += `<polyline class="dq-line" points="${sorted.map((p) => `${f1(X(p.x))},${f1(Y(p.y))}`).join(' ')}" stroke="${fill}" fill="none"/>`;
    }
    if (multi) legend.push({ label: 'band: min–max in each row', color: '', shape: 'none' });
  }
  if (spreadG) g += `<svg class="dq-clip" x="${L}" y="${T}" width="${PW}" height="${PH}" viewBox="${L} ${T} ${PW} ${PH}">${spreadG}</svg>`;

  const labels = pts.map((p) => rowLabel(p.r, by));
  const prefix = plot.labels ? commonPrefix(labels) : '';
  const inside = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  let dots = '';
  pts.forEach((p, i) => {
    if (!inside(p.x, p.y)) return;
    const fill = fillOf(p.r);
    const tip = [labels[i], statLine(plot.x, p.r.values[plot.x], p.sx), statLine(plot.y, p.r.values[plot.y], p.sy)];
    if (plot.color) tip.push(tipLine(plot.color, p.r.values[plot.color]));
    // A pixel-sized chart gets hover boxes from the host script; the scaled one falls back to <title>.
    const title = b.sized ? '' : `<title>${esc(tip.join('\n'))}</title>`;
    dots += `<circle class="dq-pt" cx="${f1(X(p.x))}" cy="${f1(Y(p.y))}" r="3" fill="${fill}" data-uuid="${esc(p.r.sources[0].uuid)}" data-tip="${esc(tip.join('\n'))}">${title}</circle>`;
    if (plot.labels) dots += `<text class="dq-lbl" x="${f1(X(p.x) + 8)}" y="${f1(Y(p.y) + 4)}">${esc(labels[i].slice(prefix.length) || labels[i])}</text>`;
  });
  g += dots;
  if (rx || ry) legend.push({ label: 'ratio 1.00', color: 'var(--dq-fail)', shape: 'dash' });
  if (prefix) legend.push({ label: `labels omit '${prefix}'`, color: '', shape: 'none' });
  const data = ` data-dom="${[x0, x1, y0, y1].join(',')}" data-box="${[L, T, PW, PH].join(',')}"`;
  return { html: frame(b, g, `${plot.y} against ${plot.x}`, data), legend };
}

/** Each row counts once, at the mean of its cell; whiskers span the rows of a category. */
export function barGroups(rows: Row[], plot: BarSpec, types: Record<string, ValueType>): BarGroup[] {
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
        const v = rs.map((r) => cellMean(r.values[k])).filter((x) => !isNaN(x));
        if (!v.length) return null;
        return { mean: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v), n: v.length };
      }),
    };
  });
}

export function barSvg(rows: Row[], plot: BarSpec, types: Record<string, ValueType>, opts: ChartOpts = {}): Chart {
  const b = box(opts.size);
  const { L, T, PW, PH } = b;
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
      const tip = `${plot.x}: ${gr.cat}\n${plot.ys[j]}: mean ${s.mean.toPrecision(4)}\nmin ${s.min} · max ${s.max} · n=${s.n}`;
      const title = b.sized ? '' : `<title>${esc(tip)}</title>`;
      g += `<rect class="dq-bar" x="${f1(x + 1)}" y="${f1(top)}" width="${f1(bw - 2)}" height="${f1(Math.abs(Y(0) - Y(s.mean)))}" fill="${colorFor(j)}" data-tip="${esc(tip)}">${title}</rect>`;
      if (s.n >= 2) {
        const m = f1(x + bw / 2);
        const a = f1(x + bw / 2 - 5);
        const b = f1(x + bw / 2 + 5);
        g += `<g class="dq-whisker"><line x1="${m}" y1="${f1(Y(s.max))}" x2="${m}" y2="${f1(Y(s.min))}"/><line x1="${a}" y1="${f1(Y(s.max))}" x2="${b}" y2="${f1(Y(s.max))}"/><line x1="${a}" y1="${f1(Y(s.min))}" x2="${b}" y2="${f1(Y(s.min))}"/></g>`;
      }
    });
    g += `<text class="dq-cat" x="${f1(cx)}" y="${T + PH + 18}" text-anchor="middle">${esc(gr.cat)}</text><text class="dq-tick" x="${f1(cx)}" y="${T + PH + 34}" text-anchor="middle">n=${gr.n}</text>`;
  });
  g = `<rect class="dq-area" x="${L}" y="${T}" width="${PW}" height="${PH}"/>` + g;
  g += `<line class="dq-zero" x1="${L}" y1="${f1(Y(0))}" x2="${L + PW}" y2="${f1(Y(0))}"/>`;
  if (anyRatio) g += `<line class="dq-ref" x1="${L}" y1="${f1(Y(1))}" x2="${L + PW}" y2="${f1(Y(1))}"/>`;
  const legend: LegendItem[] = plot.ys.map((k, j) => ({ label: k, color: colorFor(j), shape: 'square' }));
  legend.push({ label: 'whiskers: min–max (n ≥ 2)', color: '', shape: 'none' });
  if (anyRatio) legend.push({ label: 'ratio 1.00', color: 'var(--dq-fail)', shape: 'dash' });
  return { html: frame(b, g, `${plot.ys.join(', ')} by ${plot.x}`), legend };
}

export function legendHtml(items: LegendItem[]): string {
  if (!items.length) return '';
  const mark = (i: LegendItem) =>
    i.shape === 'none' ? '' : `<i class="dq-mark dq-${i.shape}" style="${i.shape === 'dash' ? 'border-color' : 'background'}:${i.color}"></i>`;
  return `<div class="dq-legend">${items.map((i) => `<span>${mark(i)}${esc(i.label)}</span>`).join('')}</div>`;
}
