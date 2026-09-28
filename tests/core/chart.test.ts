import { describe, expect, it } from 'vitest';
import { barGroups, barSvg, colorFor, commonPrefix, formatTick, niceTicks, scatterSvg } from '../../src/core/chart';
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
  it('palette wraps to muted after 8', () => {
    expect(colorFor(0)).toBe('var(--dq-c0)');
    expect(colorFor(8)).toBe('var(--dq-muted)');
  });
  it('common prefix cuts at the last dash', () => {
    expect(commonPrefix(['fsz-p8-o6', 'fsz-p8-o6-seed1', 'fsz-ms'])).toBe('fsz-');
    expect(commonPrefix(['a'])).toBe('');
  });
});

describe('scatterSvg', () => {
  const c = scatterSvg(rows, { kind: 'scatter', x: 'x', y: 'y', color: 'seed', labels: true }, types);
  it('draws one point per numeric row, with jump hooks', () => {
    expect(c.html.match(/<circle /g)).toHaveLength(4);
    expect(c.html).toContain('data-uuid="fsz-a" data-on-click="dqJump"');
  });
  it('ratio axes get reference lines and a pass region', () => {
    expect(c.html.match(/class="dq-ref"/g)).toHaveLength(2);
    expect(c.html).toContain('class="dq-passzone"');
  });
  it('labels drop the common prefix; legend lists colours and the ratio line', () => {
    expect(c.html).toContain('>a</text>');
    expect(c.legend).toEqual([
      { label: 'seed = 0', color: 'var(--dq-c0)', shape: 'dot' },
      { label: 'seed = 1', color: 'var(--dq-c1)', shape: 'dot' },
      { label: 'seed = 2', color: 'var(--dq-c2)', shape: 'dot' },
      { label: 'ratio 1.00', color: 'var(--dq-fail)', shape: 'dash' },
      { label: "labels omit 'fsz-'", color: '', shape: 'none' },
    ]);
  });
  it('labels=off removes point labels', () => {
    const off = scatterSvg(rows, { kind: 'scatter', x: 'x', y: 'y', labels: false }, types);
    expect(off.html).not.toContain('class="dq-lbl"');
  });
  it('explains when nothing is plottable', () => {
    const none = scatterSvg(rows, { kind: 'scatter', x: 'combine', y: 'y', labels: true }, types);
    expect(none.html).toBe('<p class="dq-empty">No rows have numeric combine and y.</p>');
  });
});

describe('bar with negative means', () => {
  it('keeps the zero axis inside the chart', () => {
    const neg = [row('p', { g: 'a', v: '-3' }), row('q', { g: 'b', v: '-1' })];
    const html = barSvg(neg, { kind: 'bar', x: 'g', ys: ['v'] }, { g: 'string', v: 'number' }).html;
    const heights = [...html.matchAll(/class="dq-bar" x="[^"]+" y="([^"]+)" width="[^"]+" height="([^"]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    for (const [y, h] of heights) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y + h).toBeLessThanOrEqual(360);
    }
  });
});

describe('bar', () => {
  const plot = { kind: 'bar', x: 'combine', ys: ['x', 'y'] } as const;
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
