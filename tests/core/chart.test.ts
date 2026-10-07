import { describe, expect, it } from 'vitest';
import { barGroups, barSvg, colorFor, commonPrefix, dragAxis, formatTick, legendHtml, niceTicks, scatterSvg } from '../../src/core/chart';
import type { Row } from '../../src/core/rows';

const row = (id: string, values: Record<string, string>): Row => ({
  id, title: id, values, sources: [{ uuid: id, pageTitle: 'P', journalDay: null }], conflicts: {},
});
const rows = [
  row('fsz-a', { x: '1.27', y: '0.96', seed: '0', combine: 'none' }),
  row('fsz-b', { x: '1.51', y: '1.32', seed: '0', combine: 'mean' }),
  row('fsz-c', { x: '1.49', y: '1.96', seed: '1', combine: 'mean' }),
  row('fsz-d', { x: '1.29', y: '1.36', seed: '2', combine: 'mean' }),
  row('fsz-e', { x: 'n/a', y: '1', seed: '2', combine: 'gate' }),
];
const types = { x: 'ratio', y: 'ratio', seed: 'category', combine: 'string' } as const;

describe('ticks', () => {
  it('nice steps covering the range', () => {
    expect(niceTicks(0.96, 1.96)).toEqual([0.8, 1, 1.2, 1.4, 1.6, 1.8, 2]);
    expect(niceTicks(0, 16.42)).toEqual([0, 5, 10, 15, 20]);
    expect(niceTicks(3, 3)).toEqual([2, 2.5, 3, 3.5, 4]);
    expect(formatTick(1.2, 0.2)).toBe('1.2');
    expect(formatTick(1, 0.2)).toBe('1.0');
  });
  it('palette cycles after 10 like plotly', () => {
    expect(colorFor(0)).toBe('var(--dq-c0)');
    expect(colorFor(10)).toBe('var(--dq-c0)');
  });
  it('common prefix cuts at the last dash', () => {
    expect(commonPrefix(['fsz-p8-o6', 'fsz-p8-o6-seed1', 'fsz-ms'])).toBe('fsz-');
    expect(commonPrefix(['a'])).toBe('');
  });
});

describe('scatterSvg', () => {
  const c = scatterSvg(rows, { x: 'x', y: 'y', labels: true, err: 'bar' }, types);
  const cc = scatterSvg(rows, { x: 'x', y: 'y', color: 'seed', labels: false, err: 'bar' }, types);
  it('draws one point per numeric row, with row ids and hover text', () => {
    expect(c.html.match(/<circle /g)).toHaveLength(4);
    expect(c.html).toContain('data-uuid="fsz-a" data-tip="fsz-a\nx: 1.27\ny: 0.96"');
    expect(c.html).toContain('<title>');
  });
  it('a pixel-sized chart draws at that size, drops <title> and records its domain', () => {
    const s = scatterSvg(rows, { x: 'x', y: 'y', labels: false, err: 'bar' }, types, undefined, { size: { w: 900, h: 360 } });
    expect(s.html).toContain('viewBox="0 0 900 360" width="900" height="360"');
    expect(s.html).not.toContain('<title>');
    expect(s.html).toMatch(/data-dom="1,1\.6,0\.8,2" data-box="64,16,816,292"/);
  });
  it('a zoomed view keeps its exact range and hides points outside it', () => {
    const z = scatterSvg(rows, { x: 'x', y: 'y', labels: false, err: 'bar' }, types, undefined, { view: { x0: 1.25, x1: 1.3, y0: 0.9, y1: 1.4 } });
    expect(z.html.match(/<circle /g)).toHaveLength(2);
    expect(z.html).toContain('data-dom="1.25,1.3,0.9,1.4"');
  });
  it('ratio axes get reference lines and a pass region', () => {
    expect(c.html.match(/class="dq-ref"/g)).toHaveLength(2);
    expect(c.html).toContain('class="dq-passzone"');
  });
  it('labels drop the common prefix; legend lists colours and the ratio line', () => {
    expect(c.html).toContain('>a</text>');
    expect(c.legend).toEqual([
      { label: 'ratio 1.00', color: 'var(--dq-fail)', shape: 'dash' },
      { label: "labels omit 'fsz-'", color: '', shape: 'none' },
    ]);
    expect(cc.legend).toEqual([
      { label: 'seed = 0', color: 'var(--dq-c0)', shape: 'dot', trace: 'seed = 0', off: false },
      { label: 'seed = 1', color: 'var(--dq-c1)', shape: 'dot', trace: 'seed = 1', off: false },
      { label: 'seed = 2', color: 'var(--dq-c2)', shape: 'dot', trace: 'seed = 2', off: false },
      { label: 'ratio 1.00', color: 'var(--dq-fail)', shape: 'dash' },
    ]);
  });
  it('labels=off removes point labels', () => {
    const off = scatterSvg(rows, { x: 'x', y: 'y', labels: false, err: 'bar' }, types);
    expect(off.html).not.toContain('class="dq-lbl"');
  });
  it('explains when nothing is plottable', () => {
    const none = scatterSvg(rows, { x: 'combine', y: 'y', labels: true, err: 'bar' }, types);
    expect(none.html).toBe('<p class="dq-empty">No rows have numeric combine and y.</p>');
  });
});

describe('bar with negative means', () => {
  it('keeps the zero axis inside the chart', () => {
    const neg = [row('p', { g: 'a', v: '-3' }), row('q', { g: 'b', v: '-1' })];
    const html = barSvg(neg, { x: 'g', ys: ['v'] }, { g: 'string', v: 'number' }).html;
    const heights = [...html.matchAll(/class="dq-bar" x="[^"]+" y="([^"]+)" width="[^"]+" height="([^"]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    for (const [y, h] of heights) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y + h).toBeLessThanOrEqual(360);
    }
  });
});

describe('bar', () => {
  const plot = { x: 'combine', ys: ['x', 'y'] } as const;
  it('groups, sorts categories and computes mean/min/max', () => {
    const g = barGroups(rows, { ...plot, ys: [...plot.ys] }, types);
    expect(g.map((x) => [x.cat, x.n])).toEqual([['gate', 1], ['mean', 3], ['none', 1]]);
    expect(g[0].stats[0]).toBeNull();
    const mean = g[1].stats[0]!;
    expect(mean.min).toBe(1.29);
    expect(mean.max).toBe(1.51);
    expect(mean.mean).toBeCloseTo(1.43, 10);
  });
  it('whiskers only where n >= 2', () => {
    const c = barSvg(rows, { ...plot, ys: [...plot.ys] }, types);
    expect(c.html.match(/class="dq-whisker"/g)).toHaveLength(2);
    expect(c.html).toContain('n=3');
  });
});

describe('several values in one row', () => {
  const multi = [
    row('p', { x: '3', y: '1.27/1.31/1.29', s: 'a' }),
    row('q', { x: '1', y: '1.3', s: 'a' }),
    row('r', { x: '2/4', y: '2', s: 'b' }),
    row('t', { x: '2', y: '1.0, 1.4', s: 'a' }),
  ];
  const mt = { x: 'numlist', y: 'numlist', s: 'string' } as const;
  const draw = (err: 'bar' | 'band' | 'off', color?: string) => scatterSvg(multi, { x: 'x', y: 'y', color, labels: false, err }, mt).html;
  const nums = (s: string) => s.split(/[ ,LMZ]+/).filter(Boolean).map(Number);

  it('points sit at the mean; hover shows mean, min, max and n', () => {
    const html = draw('off');
    expect(html.match(/<circle /g)).toHaveLength(4);
    expect(html).toContain('y: mean 1.29 · min 1.27 · max 1.31 · n=3');
    // Several x numbers give only the x position (their mean), never an x range.
    expect(html).toContain('x: 3\ny: 2');
    expect(html).toContain('y: 1.3');
  });
  it('err:bar draws vertical bars for rows with several y and never a horizontal bar', () => {
    const html = draw('bar');
    // p and t have several y; r has several x (no bar); q is a plain point.
    expect(html.match(/class="dq-err"/g)).toHaveLength(2);
    for (const m of html.matchAll(/<g class="dq-err"[^>]*><line x1="([^"]+)" y1="[^"]+" x2="([^"]+)"/g)) expect(m[1]).toBe(m[2]);
    expect(html).toContain('class="dq-clip"');
    const single = scatterSvg([row('q', { x: '1', y: '1.3' }), row('w', { x: '2', y: '1.5' })], { x: 'x', y: 'y', labels: false, err: 'bar' }, mt).html;
    expect(single).not.toContain('dq-err');
  });
  it('err:off draws points only', () => {
    const html = draw('off');
    expect(html).not.toContain('dq-err');
    expect(html).not.toContain('dq-band');
  });
  it('bar charts reduce each row to its mean first', () => {
    const g = barGroups([row('a', { c: 'k', v: '1/3' }), row('b', { c: 'k', v: '4' })], { x: 'c', ys: ['v'] }, { c: 'string', v: 'numlist' });
    expect(g[0].stats[0]).toEqual({ mean: 3, min: 2, max: 4, n: 2 });
  });
});

describe('scatter with by:', () => {
  const merged = [row('blk1', { run: 'r1', x: '1', y: '2' }), row('blk2', { run: 'r2', x: '2', y: '3' })];
  const mt = { run: 'string', x: 'number', y: 'number', seed: 'category' } as const;
  it('hover title is the by value and points are coloured by it', () => {
    const c = scatterSvg(merged, { x: 'x', y: 'y', labels: false, err: 'bar' }, mt, 'run');
    expect(c.html).toContain('data-tip="r1\nx: 1\ny: 2"');
    expect(c.legend.map((l) => l.label)).toEqual(['run = r1', 'run = r2']);
    expect(c.html).toContain('fill="var(--dq-c1)"');
  });
  it('an explicit color: wins over by', () => {
    const c = scatterSvg([row('a', { run: 'r1', x: '1', y: '2', seed: '0' })], { x: 'x', y: 'y', color: 'seed', labels: false, err: 'bar' }, mt, 'run');
    expect(c.legend[0].label).toBe('seed = 0');
  });
});

describe('hidden traces', () => {
  const plot = { x: 'x', y: 'y', color: 'seed', labels: false, err: 'bar' } as const;
  it('are not drawn, leave the autoscale and stay in the legend, greyed', () => {
    const all = scatterSvg(rows, plot, types, undefined, { size: { w: 800, h: 360 } });
    const some = scatterSvg(rows, plot, types, undefined, { size: { w: 800, h: 360 }, hidden: ['seed = 1'] });
    expect(all.html).toContain('data-trace="seed = 1"');
    expect(some.html).not.toMatch(/<circle[^>]*data-trace="seed = 1"/);
    expect(some.html.match(/<circle /g)).toHaveLength(3);
    // fsz-c (y 1.96) was the highest point; without it the y range shrinks.
    const top = (h: string) => Number(/data-dom="[^,]+,[^,]+,[^,]+,([^"]+)"/.exec(h)![1]);
    expect(top(some.html)).toBeLessThan(top(all.html));
    expect(some.legend.find((l) => l.label === 'seed = 1')!.off).toBe(true);
    const lg = legendHtml(some.legend);
    expect(lg).toContain('<span class="dq-trace dq-off" data-trace="seed = 1">');
    expect(lg).toContain('<span class="dq-trace" data-trace="seed = 0">');
  });
  it('bar series can be hidden too', () => {
    const c = barSvg(rows, { x: 'combine', ys: ['x', 'y'] }, types, { hidden: ['x'] });
    expect(c.html).not.toContain('data-trace="x"');
    expect(c.html).toContain('data-trace="y"');
    expect(c.legend[0]).toMatchObject({ label: 'x', trace: 'x', off: true });
  });
});

describe('font and marker scale', () => {
  it('scales markers, margins and fonts', () => {
    const one = scatterSvg(rows, { x: 'x', y: 'y', labels: false, err: 'bar' }, types, undefined, { size: { w: 800, h: 360 } });
    const two = scatterSvg(rows, { x: 'x', y: 'y', labels: false, err: 'bar' }, types, undefined, { size: { w: 800, h: 360 }, scale: 2 });
    expect(one.html).toContain('r="3"');
    expect(one.html).not.toContain('--dq-s');
    expect(two.html).toContain('r="6"');
    expect(two.html).toContain('style="--dq-s:2"');
    expect(two.html).toMatch(/data-box="128,/);
    // The legend keeps its size.
    expect(legendHtml(two.legend)).not.toContain('--dq-s');
  });
});

describe('axis drag', () => {
  const a = { L: 0, T: 0, PW: 100, PH: 100 };
  const d = { x0: 0, x1: 10, y0: 0, y1: 10 };
  it('scatter draws hit strips on both axes: two ends and a middle', () => {
    const h = scatterSvg(rows, { x: 'x', y: 'y', labels: false, err: 'bar' }, types, undefined, { size: { w: 800, h: 360 } }).html;
    for (const ax of ['x', 'y']) for (const end of ['0', '1', 'pan']) expect(h).toContain(`class="dq-axdrag" data-ax="${ax}" data-end="${end}"`);
  });
  it('the middle pans, an end moves only that end and keeps the grabbed value under the pointer', () => {
    expect(dragAxis(d, a, 'x', 'pan', { x: 50, y: 0 }, { x: 60, y: 0 })).toEqual({ x0: -1, x1: 9, y0: 0, y1: 10 });
    expect(dragAxis(d, a, 'y', 'pan', { x: 0, y: 50 }, { x: 0, y: 60 })).toEqual({ x0: 0, x1: 10, y0: 1, y1: 11 });
    // Grab x=8 at 80 px and pull it to 40 px: x1 becomes 20, x0 stays.
    expect(dragAxis(d, a, 'x', '1', { x: 80, y: 0 }, { x: 40, y: 0 })).toEqual({ x0: 0, x1: 20, y0: 0, y1: 10 });
    // Grab x=2 at 20 px and pull it to 60 px: 2 stays under the pointer, x1 fixed.
    const left = dragAxis(d, a, 'x', '0', { x: 20, y: 0 }, { x: 60, y: 0 });
    expect(left.x1).toBe(10);
    expect(left.x0 + 0.6 * (left.x1 - left.x0)).toBeCloseTo(2, 10);
    // Top end of y: grab y=8 (20 px from the top), pull it down to 60 px from the top.
    const top = dragAxis(d, a, 'y', '1', { x: 0, y: 20 }, { x: 0, y: 60 });
    expect(top.y0).toBe(0);
    expect(top.y1).toBeCloseTo(20, 10);
    const bottom = dragAxis(d, a, 'y', '0', { x: 0, y: 80 }, { x: 0, y: 40 });
    expect(bottom.y1).toBe(10);
    expect(bottom.y0 + 0.6 * (bottom.y1 - bottom.y0)).toBeCloseTo(2, 10);
  });
});

describe('bar with many categories', () => {
  it('gives each category a minimum width and records the requested width', () => {
    const many = Array.from({ length: 30 }, (_, i) => row(`r${i}`, { c: `cat-${i}`, v: String(i) }));
    const h = barSvg(many, { x: 'c', ys: ['v'] }, { c: 'string', v: 'number' }, { size: { w: 600, h: 360 } }).html;
    const w = Number(/ width="(\d+)"/.exec(h)![1]);
    expect(w).toBeGreaterThanOrEqual(30 * 56 + 64);
    expect(h).toContain('data-w="600"');
    const few = barSvg(many.slice(0, 3), { x: 'c', ys: ['v'] }, { c: 'string', v: 'number' }, { size: { w: 600, h: 360 } }).html;
    expect(few).toContain('width="600"');
  });
});

describe('scatter groups by by:', () => {
  const gt = { run: 'string', x: 'number', y: 'numlist', seed: 'category' } as const;
  const one = [row('a', { run: 'r1', x: '2', y: '1.27/1.31', seed: '0' }), row('b', { run: 'r1', x: '2', y: '1.4', seed: '1' })];
  const many = [
    row('c', { run: 'r2', x: '3', y: '2' }), row('d', { run: 'r2', x: '1', y: '1/3' }),
    row('e', { run: 'r2', x: '3', y: '4' }), row('f', { run: 'r2', x: '2', y: '5' }),
  ];
  const draw = (rs: Row[], err: 'bar' | 'band' | 'off', color?: string) =>
    scatterSvg(rs, { x: 'x', y: 'y', color, labels: false, err }, gt, 'run', { size: { w: 800, h: 360 } });
  const yOf = (html: string) => {
    const dom = /data-dom="([^"]+)" data-box="([^"]+)"/.exec(html)!;
    const [, , y0, y1] = dom[1].split(',').map(Number);
    const [, T, , PH] = dom[2].split(',').map(Number);
    return (py: number) => y0 + ((T + PH - py) / PH) * (y1 - y0);
  };

  it('one x in a group: one marker at the mean of every y and one vertical bar from min to max', () => {
    const c = draw(one, 'bar');
    expect(c.html.match(/<circle /g)).toHaveLength(1);
    expect(c.html).toContain('data-tip="r1\nx: 2\ny: mean 1.327 · min 1.27 · max 1.4 · n=3"');
    const bars = [...c.html.matchAll(/<g class="dq-err"[^>]*><line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/g)];
    expect(bars).toHaveLength(1);
    const Y = yOf(c.html);
    expect(Y(Number(bars[0][2]))).toBeCloseTo(1.4, 1);
    expect(Y(Number(bars[0][4]))).toBeCloseTo(1.27, 1);
    expect(c.html).not.toContain('dq-line');
  });
  it('several x in a group: a line through the per-x means in x order, a marker and a bar at each x', () => {
    const c = draw(many, 'bar');
    expect(c.html.match(/<circle /g)).toHaveLength(3);
    const line = /<polyline class="dq-line" points="([^"]+)"/.exec(c.html)!;
    const pts = line[1].split(' ').map((p) => p.split(',').map(Number));
    expect(pts.map((p) => p[0])).toEqual([...pts.map((p) => p[0])].sort((m, n) => m - n));
    const Y = yOf(c.html);
    expect(pts.map((p) => Number(Y(p[1]).toFixed(1)))).toEqual([2, 5, 3]);
    // x = 1 (1/3) and x = 3 (2 and 4) have a spread; x = 2 has one value.
    expect(c.html.match(/class="dq-err"/g)).toHaveLength(2);
  });
  it('err:band fills only groups with several x; a single-x group keeps its bar', () => {
    const c = draw([...one, ...many], 'band');
    expect(c.html.match(/class="dq-band"/g)).toHaveLength(1);
    expect(c.html).toMatch(/<path class="dq-band"[^>]*data-trace="run = r2"/);
    expect(c.html.match(/class="dq-err"/g)).toHaveLength(1);
    expect(c.html).toMatch(/<g class="dq-err" data-trace="run = r1"/);
  });
  it('err:off keeps the line of a multi-x group but draws no bar or band', () => {
    const c = draw([...one, ...many], 'off');
    expect(c.html).toContain('class="dq-line"');
    expect(c.html).not.toContain('dq-err');
    expect(c.html).not.toContain('dq-band');
  });
  it('an explicit color: colours each group by the value of its first row', () => {
    const c = draw([...one, ...many], 'bar', 'seed');
    expect(c.legend.filter((l) => l.trace).map((l) => l.label)).toEqual(['seed = 0', 'seed = (none)']);
    expect(c.html).toMatch(/<circle[^>]*data-trace="seed = 0"[^>]*data-key="r1"/);
  });
});

describe('scatter groups by color: (no by:)', () => {
  const gt = { g: 'string', x: 'number', y: 'numlist' } as const;
  const rs = [
    row('p', { g: 'A', x: '2', y: '1' }), row('q', { g: 'A', x: '2', y: '3' }),
    row('r', { g: 'B', x: '3', y: '2' }), row('s', { g: 'B', x: '1', y: '5' }), row('t', { g: 'B', x: '2', y: '4/4.5' }),
  ];
  const draw = (err: 'bar' | 'band' | 'off', color?: string) =>
    scatterSvg(rs, { x: 'x', y: 'y', color, labels: false, err }, gt, undefined, { size: { w: 800, h: 360 } });

  it('rows sharing a colour and an x pool into one mean marker with the min–max of their y', () => {
    const c = draw('bar', 'g');
    expect(c.html.match(/<circle /g)).toHaveLength(4);
    expect(c.html).toContain('data-key="A" data-tip="A\nx: 2\ny: mean 2 · min 1 · max 3 · n=2"');
    expect(c.html).toMatch(/<g class="dq-err" data-trace="g = A"/);
  });
  it('a colour group with several x draws a line through its means sorted by x', () => {
    const c = draw('bar', 'g');
    const lines = [...c.html.matchAll(/<polyline class="dq-line" points="([^"]+)"[^>]*data-trace="([^"]+)"/g)];
    expect(lines.map((l) => l[2])).toEqual(['g = B']);
    const xs = lines[0][1].split(' ').map((p) => Number(p.split(',')[0]));
    expect(xs).toEqual([...xs].sort((m, n) => m - n));
    expect(xs).toHaveLength(3);
  });
  it('err:band bands the multi-x colour group; err:off keeps its line only', () => {
    expect(draw('band', 'g').html.match(/class="dq-band"/g)).toHaveLength(1);
    const off = draw('off', 'g').html;
    expect(off).toContain('class="dq-line"');
    expect(off).not.toContain('dq-err');
  });
  it('without by: or color: each row is its own point', () => {
    const c = draw('bar');
    expect(c.html.match(/<circle /g)).toHaveLength(5);
    expect(c.html).not.toContain('dq-line');
    expect(c.html).not.toContain('data-key=');
  });
});

describe('bar chart width with several y columns', () => {
  const cats = Array.from({ length: 10 }, (_, i) => row(`r${i}`, { c: `c${i}`, a: '1', b: '2', d: '3' }));
  const t = { c: 'string', a: 'number', b: 'number', d: 'number' } as const;
  const width = (ys: string[]) => Number(/width="(\d+)"/.exec(barSvg(cats, { x: 'c', ys }, t, { size: { w: 300, h: 360 } }).html)![1]);
  it('each extra y series widens the minimum category width', () => {
    expect(width(['a'])).toBeGreaterThanOrEqual(10 * 56);
    expect(width(['a', 'b'])).toBeGreaterThan(width(['a']));
    expect(width(['a', 'b', 'd'])).toBeGreaterThan(width(['a', 'b']));
  });
});
