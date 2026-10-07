import type { ErrMode } from './dsl';
import { esc } from './html';
import { canonical, rowLabel, type Row } from './rows';
import { cellMean, cellStats, compareValues, toList, type ValueType } from './types';

export interface ScatterSpec { x: string; y: string; color?: string; labels: boolean; err: ErrMode }
export interface BarSpec { x: string; ys: string[] }

/** `trace` names a series a double-click can hide; `off` greys a hidden one. */
export interface LegendItem { label: string; color: string; shape: 'dot' | 'square' | 'dash' | 'none'; trace?: string; off?: boolean }
export interface Chart { html: string; legend: LegendItem[] }
export interface BarGroup { cat: string; n: number; stats: Array<{ mean: number; min: number; max: number; n: number } | null> }

export const PALETTE_SIZE = 10;
/** Cycles through the colorway, as plotly does. */
export const colorFor = (i: number): string => `var(--dq-c${i % PALETTE_SIZE})`;

/** Pixel size to draw at. Without one the SVG uses a 640×360 viewBox and scales to its container. */
export interface ChartSize { w: number; h: number }
/** Visible data range of a zoomed scatter plot. */
export interface Domain { x0: number; x1: number; y0: number; y1: number }
/**
 * `scale` multiplies markers, line widths and fonts (Ctrl + wheel); `hidden` names traces a
 * double-click switched off: they are not drawn and do not count for the autoscale.
 */
export interface ChartOpts { size?: ChartSize; view?: Domain; scale?: number; hidden?: string[] }
/** Plot area inside the SVG, in SVG units. */
export interface Area { L: number; T: number; PW: number; PH: number }

/** Narrowest a bar-chart category may get before the chart grows wider than its box. */
export const MIN_CAT_W = 56;
/** Width each y series past the first adds to that minimum, so grouped bars stay readable. */
export const MIN_SERIES_W = 24;

interface Box extends Area { W: number; H: number; B: number; s: number; sized: boolean; reqW?: number }
function box(size: ChartSize | undefined, s: number, minPW = 0, extraB = 0): Box {
  const L = Math.round(64 * s), R = 20, T = 16, B = Math.round(52 * s + extraB);
  const W = Math.max(240, size?.w ?? 640, L + R + minPW), H = Math.max(200, size?.h ?? 360);
  return { W, H, L, T, B, PW: W - L - R, PH: H - T - B, s, sized: !!size, reqW: size?.w };
}
/** Category labels: about 3 lines at most, each about this many px per character at 14px. */
const CAT_LINES = 3;
const CAT_CHAR_W = 8.4;
const CAT_LINE_H = 16;
const CAT_PAD = 4;

/**
 * Wrap a bar category label into lines of at most `maxChars` characters. Breaks at spaces and
 * after `-`, `_`, `/`, `.`; a piece with no break point is hard-broken by characters. Past
 * `maxLines` the last line ends with an ellipsis and `cut` is true.
 */
export function wrapLabel(text: string, maxChars: number, maxLines = CAT_LINES): { lines: string[]; cut: boolean } {
  const n = Math.max(1, Math.floor(maxChars));
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const pieces = word.match(/[^-_/.]*[-_/.]|[^-_/.]+/g) ?? [word];
    pieces.forEach((piece, i) => {
      const joined = cur + (i === 0 && cur ? ' ' : '') + piece;
      if (joined.length <= n) { cur = joined; return; }
      if (cur) lines.push(cur);
      cur = piece;
      while (cur.length > n) { lines.push(cur.slice(0, n)); cur = cur.slice(n); }
    });
  }
  if (cur || !lines.length) lines.push(cur);
  if (lines.length <= maxLines) return { lines, cut: false };
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = kept[maxLines - 1].slice(0, Math.max(0, n - 1)) + '…';
  return { lines: kept, cut: true };
}

const scaleOf = (opts: ChartOpts) => Math.min(3, Math.max(0.5, opts.scale ?? 1));
const traceAttr = (t: string | undefined) => (t === undefined ? '' : ` data-trace="${esc(t)}"`);
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
  const st = b.s !== 1 ? ` style="--dq-s:${b.s}"` : '';
  // `data-w` is the box width asked for, so the host can tell a chart already drawn at its width.
  const w = b.reqW !== undefined ? ` data-w="${b.reqW}"` : '';
  return `<svg class="dq-chart" viewBox="0 0 ${b.W} ${b.H}"${px}${st} role="img" aria-label="${esc(label)}"${data}${w}>${inner}</svg>`;
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

const p4 = (n: number) => Number(n.toPrecision(4));
const catOf = (v: string | undefined) => (v === undefined ? NONE : canonical(v));

const empty = (msg: string): Chart => ({ html: `<p class="dq-empty">${esc(msg)}</p>`, legend: [] });

/** One x position of a group: every y number found there, and the first block to jump to. */
export interface GroupPoint { x: number; ys: number[]; mean: number; min: number; max: number; uuid: string }
/** Points that belong together: the rows of one group-key value (`color`, else `by`), or a single row. */
export interface ScatterGroup { key?: string; label: string; first: Row; pts: GroupPoint[] }

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

/**
 * Groups rows for the scatter plot. With a group key (`color`, else `by`), rows sharing its value
 * form one group; without, each row is its own group. Inside a group the y numbers are pooled per distinct x (a row sits at
 * the mean of its x cell; every number of its y cell counts), and points come sorted by x.
 */
export function scatterGroups(rows: Row[], plot: { x: string; y: string }, groupKey?: string): ScatterGroup[] {
  const groups = new Map<string, { key?: string; label: string; first: Row; at: Map<number, { ys: number[]; uuid: string }> }>();
  rows.forEach((r, i) => {
    const sx = cellStats(r.values[plot.x]);
    const ly = toList(r.values[plot.y]);
    if (!sx || !ly) return;
    const key = groupKey ? catOf(r.values[groupKey]) : undefined;
    const id = key ?? `#${i}`;
    if (!groups.has(id)) groups.set(id, { key, label: key ?? rowLabel(r), first: r, at: new Map() });
    const g = groups.get(id)!;
    const x = Number(sx.mean.toPrecision(12));
    if (!g.at.has(x)) g.at.set(x, { ys: [], uuid: r.sources[0].uuid });
    g.at.get(x)!.ys.push(...ly);
  });
  return [...groups.values()].map(({ key, label, first, at }) => ({
    key, label, first,
    pts: [...at.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([x, { ys, uuid }]) => ({ x, ys, mean: mean(ys), min: Math.min(...ys), max: Math.max(...ys), uuid })),
  }));
}

export function scatterSvg(rows: Row[], plot: ScatterSpec, types: Record<string, ValueType>, by?: string, opts: ChartOpts = {}): Chart {
  const b = box(opts.size, scaleOf(opts));
  const { L, T, PW, PH, H, B, s } = b;
  // Rows group by `color`, else by `by`: a group pools its y per x (mean + min–max) and is one trace.
  const ckey = plot.color ?? by;
  const groups = scatterGroups(rows, plot, ckey);
  if (!groups.length) return empty(`No rows have numeric ${plot.x} and ${plot.y}.`);
  const traceOf = (g: ScatterGroup) => (ckey ? `${ckey} = ${catOf(g.first.values[ckey])}` : undefined);
  const hidden = new Set(opts.hidden ?? []);
  const shown = groups.filter((g) => !hidden.has(traceOf(g) ?? ''));
  const rx = types[plot.x] === 'ratio';
  const ry = types[plot.y] === 'ratio';
  const spread = plot.err !== 'off';
  // Ratio axes always include 1.00 so the threshold line is on screen; the y range includes the spread.
  const scaled = (shown.length ? shown : groups).flatMap((g) => g.pts);
  const xs = scaled.map((p) => p.x).concat(rx ? [1] : []);
  const ys = scaled.flatMap((p) => (spread ? [p.min, p.max] : [p.mean])).concat(ry ? [1] : []);
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
    g += `<line class="dq-grid" x1="${f1(X(v))}" y1="${T}" x2="${f1(X(v))}" y2="${T + PH}"/><text class="dq-tick" x="${f1(X(v))}" y="${f1(T + PH + 17 * s)}" text-anchor="middle">${formatTick(v, step(tx))}</text>`;
  for (const v of ty)
    g += `<line class="dq-grid" x1="${L}" y1="${f1(Y(v))}" x2="${L + PW}" y2="${f1(Y(v))}"/><text class="dq-tick" x="${f1(L - 6 * s)}" y="${f1(Y(v) + 3.5 * s)}" text-anchor="end">${formatTick(v, step(ty))}</text>`;
  // Plotly draws no axis box, only a thicker zero line when 0 is in range.
  if (x0 < 0 && x1 > 0) g += `<line class="dq-zero" x1="${f1(X(0))}" y1="${T}" x2="${f1(X(0))}" y2="${T + PH}"/>`;
  if (y0 < 0 && y1 > 0) g += `<line class="dq-zero" x1="${L}" y1="${f1(Y(0))}" x2="${L + PW}" y2="${f1(Y(0))}"/>`;
  if (rx && X(1) >= L && X(1) <= L + PW) g += `<line class="dq-ref" x1="${f1(X(1))}" y1="${T}" x2="${f1(X(1))}" y2="${T + PH}"/>`;
  if (ry && Y(1) >= T && Y(1) <= T + PH) g += `<line class="dq-ref" x1="${L}" y1="${f1(Y(1))}" x2="${L + PW}" y2="${f1(Y(1))}"/>`;
  const ty0 = f1(16 * s);
  g += `<text class="dq-title" x="${L + PW / 2}" y="${f1(H - 10 * s)}" text-anchor="middle">${axisTitle(plot.x, types[plot.x])}</text>`;
  g += `<text class="dq-title" x="${ty0}" y="${T + PH / 2}" text-anchor="middle" transform="rotate(-90 ${ty0} ${T + PH / 2})">${axisTitle(plot.y, types[plot.y])}</text>`;

  const legend: LegendItem[] = [];
  const colorOf = new Map<string, string>();
  if (ckey) {
    const cats = sortCats([...new Set(groups.map((gr) => catOf(gr.first.values[ckey])))], types[ckey] ?? 'string');
    cats.forEach((c, i) => {
      const label = `${ckey} = ${c}`;
      colorOf.set(c, colorFor(i));
      legend.push({ label, color: colorFor(i), shape: 'dot', trace: label, off: hidden.has(label) });
    });
  }
  const fillOf = (gr: ScatterGroup) => (ckey ? colorOf.get(catOf(gr.first.values[ckey]))! : 'var(--dq-c0)');

  // Only y spreads: a vertical min–max bar per x, or a band along a group with several x.
  // Bars, bands and lines sit in a nested <svg> the size of the plot area, which clips them when zoomed.
  let spreadG = '';
  let bars = false, bands = false;
  const cap = 4 * s;
  const pt = (p: GroupPoint, y: number) => `${f1(X(p.x))},${f1(Y(y))}`;
  for (const gr of shown) {
    const fill = fillOf(gr);
    const ta = traceAttr(traceOf(gr));
    const line = gr.pts.length >= 2;
    if (line && plot.err === 'band') {
      // Like plotly's fill='tonexty': the upper bounds in x order, then the lower bounds back.
      const d = [...gr.pts.map((p) => pt(p, p.max)), ...[...gr.pts].reverse().map((p) => pt(p, p.min))];
      spreadG += `<path class="dq-band" d="M${d.join(' L')} Z" fill="${fill}" fill-opacity="0.2"${ta}/>`;
      bands = true;
    }
    if (line) spreadG += `<polyline class="dq-line" points="${gr.pts.map((p) => pt(p, p.mean)).join(' ')}" stroke="${fill}" fill="none"${ta}/>`;
    // A group with one x has nothing to band, so it keeps its bar under `err:band` too.
    const barred = plot.err === 'bar' || (plot.err === 'band' && !line);
    if (barred)
      for (const p of gr.pts) {
        if (p.ys.length < 2) continue;
        const cx = f1(X(p.x)), a = f1(X(p.x) - cap), z = f1(X(p.x) + cap), hi = f1(Y(p.max)), lo = f1(Y(p.min));
        spreadG += `<g class="dq-err"${ta}><line x1="${cx}" y1="${hi}" x2="${cx}" y2="${lo}"/><line x1="${a}" y1="${hi}" x2="${z}" y2="${hi}"/><line x1="${a}" y1="${lo}" x2="${z}" y2="${lo}"/></g>`;
        bars = true;
      }
  }
  if (bars) legend.push({ label: 'bars: min–max of y', color: '', shape: 'none' });
  if (bands) legend.push({ label: 'band: min–max of y', color: '', shape: 'none' });
  if (spreadG) g += `<svg class="dq-clip" x="${L}" y="${T}" width="${PW}" height="${PH}" viewBox="${L} ${T} ${PW} ${PH}">${spreadG}</svg>`;

  const prefix = plot.labels ? commonPrefix(shown.map((gr) => gr.label)) : '';
  const inside = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  let dots = '';
  for (const gr of shown) {
    const fill = fillOf(gr);
    const key = gr.key !== undefined ? ` data-key="${esc(gr.key)}"` : '';
    for (const p of gr.pts) {
      if (!inside(p.x, p.mean)) continue;
      const n = p.ys.length;
      const tip = [gr.label, `${plot.x}: ${p4(p.x)}`, n >= 2 ? `${plot.y}: mean ${p4(p.mean)} · min ${p4(p.min)} · max ${p4(p.max)} · n=${n}` : `${plot.y}: ${p4(p.mean)}`];
      // A pixel-sized chart gets hover boxes from the host script; the scaled one falls back to <title>.
      const title = b.sized ? '' : `<title>${esc(tip.join('\n'))}</title>`;
      dots += `<circle class="dq-pt" cx="${f1(X(p.x))}" cy="${f1(Y(p.mean))}" r="${f1(3 * s).replace(/\.0$/, '')}" fill="${fill}"${traceAttr(traceOf(gr))} data-uuid="${esc(p.uuid)}"${key} data-tip="${esc(tip.join('\n'))}">${title}</circle>`;
      if (plot.labels) dots += `<text class="dq-lbl" x="${f1(X(p.x) + 8 * s)}" y="${f1(Y(p.mean) + 4 * s)}">${esc(gr.label.slice(prefix.length) || gr.label)}</text>`;
    }
  }
  g += dots;
  // Plotly-style axis handles: drag an end of an axis to move only that end, the middle to pan.
  const hit = (x: number, y: number, w: number, h: number, a: 'x' | 'y', end: string) =>
    `<rect class="dq-axdrag" data-ax="${a}" data-end="${end}" x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}"/>`;
  const q = PW / 4, r = PH / 4;
  g += hit(L, T + PH, q, B, 'x', '0') + hit(L + q, T + PH, 2 * q, B, 'x', 'pan') + hit(L + 3 * q, T + PH, q, B, 'x', '1');
  g += hit(0, T, L, r, 'y', '1') + hit(0, T + r, L, 2 * r, 'y', 'pan') + hit(0, T + 3 * r, L, r, 'y', '0');
  if (rx || ry) legend.push({ label: 'ratio 1.00', color: 'var(--dq-fail)', shape: 'dash' });
  if (prefix) legend.push({ label: `labels omit '${prefix}'`, color: '', shape: 'none' });
  // `data-step` is the tick step of each axis, so the host can format typed ranges like the ticks.
  const data = ` data-dom="${[x0, x1, y0, y1].join(',')}" data-box="${[L, T, PW, PH].join(',')}" data-step="${step(tx)},${step(ty)}"`;
  return { html: frame(b, g, `${plot.y} against ${plot.x}`, data), legend };
}

/** Fewest pixels an axis end may be pulled to, so a drag cannot flip or blow up the range. */
const MIN_PULL = 8;

/**
 * New view after dragging an axis handle from `from` to `to` (SVG units). The middle pans; an end
 * moves only that end so that the value grabbed stays under the pointer, as in plotly.
 */
export function dragAxis(d: Domain, a: Area, ax: 'x' | 'y', end: '0' | '1' | 'pan', from: { x: number; y: number }, to: { x: number; y: number }): Domain {
  if (ax === 'x') {
    const span = d.x1 - d.x0;
    if (end === 'pan') {
      const sh = (-(to.x - from.x) / a.PW) * span;
      return { ...d, x0: d.x0 + sh, x1: d.x1 + sh };
    }
    if (end === '1') {
      const p0 = from.x - a.L, p1 = Math.max(MIN_PULL, to.x - a.L);
      if (p0 < MIN_PULL) return d;
      const v = d.x0 + (p0 / a.PW) * span;
      return { ...d, x1: d.x0 + ((v - d.x0) * a.PW) / p1 };
    }
    const q0 = a.L + a.PW - from.x, q1 = Math.max(MIN_PULL, a.L + a.PW - to.x);
    if (q0 < MIN_PULL) return d;
    const v = d.x1 - (q0 / a.PW) * span;
    return { ...d, x0: d.x1 - ((d.x1 - v) * a.PW) / q1 };
  }
  const span = d.y1 - d.y0;
  if (end === 'pan') {
    const sh = ((to.y - from.y) / a.PH) * span;
    return { ...d, y0: d.y0 + sh, y1: d.y1 + sh };
  }
  if (end === '1') {
    const p0 = a.T + a.PH - from.y, p1 = Math.max(MIN_PULL, a.T + a.PH - to.y);
    if (p0 < MIN_PULL) return d;
    const v = d.y0 + (p0 / a.PH) * span;
    return { ...d, y1: d.y0 + ((v - d.y0) * a.PH) / p1 };
  }
  const q0 = from.y - a.T, q1 = Math.max(MIN_PULL, to.y - a.T);
  if (q0 < MIN_PULL) return d;
  const v = d.y1 - (q0 / a.PH) * span;
  return { ...d, y0: d.y1 - ((d.y1 - v) * a.PH) / q1 };
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
  const sc = scaleOf(opts);
  const groups = barGroups(rows, plot, types);
  const hidden = new Set(opts.hidden ?? []);
  const shownYs = plot.ys.map((k, j) => ({ k, j })).filter(({ k }) => !hidden.has(k));
  // Each category keeps a minimum width, more with each y series drawn side by side; past that
  // the chart grows wider than its box and scrolls.
  const catW = MIN_CAT_W + Math.max(0, shownYs.length - 1) * MIN_SERIES_W;
  const minPW = opts.size ? groups.length * catW * sc : 0;
  // Labels wrap at the category's width (approximate glyph width × Ctrl + wheel scale); the
  // bottom margin grows by the extra lines the longest label needs.
  const slotW = box(opts.size, sc, minPW).PW / Math.max(1, groups.length);
  const wraps = groups.map((gr) => wrapLabel(gr.cat, (slotW - 2 * CAT_PAD * sc) / (CAT_CHAR_W * sc)));
  const extra = (Math.max(1, ...wraps.map((w) => w.lines.length)) - 1) * CAT_LINE_H * sc;
  const b = box(opts.size, sc, minPW, extra);
  const { L, T, PW, PH, s } = b;
  const all = groups.flatMap((gr) => gr.stats.filter((s): s is NonNullable<typeof s> => s !== null));
  if (!all.length) return empty(`No rows have numeric ${plot.ys.join(', ')}.`);
  const visible = groups.flatMap((gr) => shownYs.map(({ j }) => gr.stats[j]).filter((s): s is NonNullable<typeof s> => !!s));
  const scaled = visible.length ? visible : all;
  const anyRatio = plot.ys.some((k) => types[k] === 'ratio');
  const lo = Math.min(0, ...scaled.map((s) => s.min));
  const hi = Math.max(0, ...scaled.map((s) => s.max), anyRatio ? 1 : -Infinity);
  const ty = niceTicks(lo, hi);
  const [y0, y1] = [ty[0], ty[ty.length - 1]];
  const Y = (v: number) => T + PH - ((v - y0) / (y1 - y0)) * PH;
  let g = '';
  for (const v of ty)
    g += `<line class="dq-grid" x1="${L}" y1="${f1(Y(v))}" x2="${L + PW}" y2="${f1(Y(v))}"/><text class="dq-tick" x="${f1(L - 6 * s)}" y="${f1(Y(v) + 3.5 * s)}" text-anchor="end">${formatTick(v, ty[1] - ty[0])}</text>`;
  const gw = PW / groups.length;
  const nb = Math.max(1, shownYs.length);
  const bw = Math.min(40 * s, (gw * 0.8) / nb);
  const cap = 5 * s;
  groups.forEach((gr, i) => {
    const cx = L + gw * (i + 0.5);
    const left = cx - (bw * nb) / 2;
    shownYs.forEach(({ k, j }, slot) => {
      const st = gr.stats[j];
      if (!st) return;
      const x = left + slot * bw;
      const top = Math.min(Y(st.mean), Y(0));
      const tip = `${plot.x}: ${gr.cat}\n${k}: mean ${st.mean.toPrecision(4)}\nmin ${st.min} · max ${st.max} · n=${st.n}`;
      const title = b.sized ? '' : `<title>${esc(tip)}</title>`;
      g += `<rect class="dq-bar" x="${f1(x + 1)}" y="${f1(top)}" width="${f1(bw - 2)}" height="${f1(Math.abs(Y(0) - Y(st.mean)))}" fill="${colorFor(j)}"${traceAttr(k)} data-tip="${esc(tip)}">${title}</rect>`;
      if (st.n >= 2) {
        const m = f1(x + bw / 2);
        const a = f1(x + bw / 2 - cap);
        const z = f1(x + bw / 2 + cap);
        g += `<g class="dq-whisker"><line x1="${m}" y1="${f1(Y(st.max))}" x2="${m}" y2="${f1(Y(st.min))}"/><line x1="${a}" y1="${f1(Y(st.max))}" x2="${z}" y2="${f1(Y(st.max))}"/><line x1="${a}" y1="${f1(Y(st.min))}" x2="${z}" y2="${f1(Y(st.min))}"/></g>`;
      }
    });
    const w = wraps[i];
    const tspans = w.lines.map((l, k) => `<tspan x="${f1(cx)}" dy="${k ? f1(CAT_LINE_H * s) : '0'}">${esc(l)}</tspan>`).join('');
    const full = w.cut ? `<title>${esc(gr.cat)}</title>` : '';
    const nY = T + PH + 34 * s + (w.lines.length - 1) * CAT_LINE_H * s;
    g += `<text class="dq-cat" x="${f1(cx)}" y="${f1(T + PH + 18 * s)}" text-anchor="middle">${full}${tspans}</text><text class="dq-tick" x="${f1(cx)}" y="${f1(nY)}" text-anchor="middle">n=${gr.n}</text>`;
  });
  g = `<rect class="dq-area" x="${L}" y="${T}" width="${PW}" height="${PH}"/>` + g;
  g += `<line class="dq-zero" x1="${L}" y1="${f1(Y(0))}" x2="${L + PW}" y2="${f1(Y(0))}"/>`;
  if (anyRatio) g += `<line class="dq-ref" x1="${L}" y1="${f1(Y(1))}" x2="${L + PW}" y2="${f1(Y(1))}"/>`;
  const legend: LegendItem[] = plot.ys.map((k, j) => ({ label: k, color: colorFor(j), shape: 'square', trace: k, off: hidden.has(k) }));
  legend.push({ label: 'whiskers: min–max (n ≥ 2)', color: '', shape: 'none' });
  if (anyRatio) legend.push({ label: 'ratio 1.00', color: 'var(--dq-fail)', shape: 'dash' });
  return { html: frame(b, g, `${plot.ys.join(', ')} by ${plot.x}`), legend };
}

/** The legend keeps its normal size: Ctrl + wheel scales the chart only. */
export function legendHtml(items: LegendItem[]): string {
  if (!items.length) return '';
  const mark = (i: LegendItem) =>
    i.shape === 'none' ? '' : `<i class="dq-mark dq-${i.shape}" style="${i.shape === 'dash' ? 'border-color' : 'background'}:${i.color}"></i>`;
  // A trace entry can be double-clicked to hide or show that trace.
  const span = (i: LegendItem) =>
    i.trace === undefined ? '<span>' : `<span class="dq-trace${i.off ? ' dq-off' : ''}" data-trace="${esc(i.trace)}">`;
  return `<div class="dq-legend">${items.map((i) => `${span(i)}${mark(i)}${esc(i.label)}</span>`).join('')}</div>`;
}
