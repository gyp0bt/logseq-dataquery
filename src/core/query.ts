import type { Cond, Kind, Query } from './dsl';
import { blockToRow, canonical, comparePriority, mergeRows, readProps, type Row, type SourceBlock } from './rows';
import {
  cellMean, compareValues, inferType, isNumericType, resolveType, valuesEqual, type TypeOverrides, type ValueType,
} from './types';

export interface QueryContext {
  blocks: SourceBlock[];
  types: Record<string, ValueType>;
  macroUuid: string;
  /** Position of each block of the macro's page in outline order. */
  order?: Map<string, number>;
}
/** The columns a chart draws: settings from the query, else defaults for the macro kind. */
export interface Axes { x?: string; ys: string[]; color?: string }
export interface QueryResult {
  rows: Row[];
  /**
   * Rows a chart groups: with `by:KEY`, the unmerged blocks that carry KEY (the chart groups them by
   * their KEY value); otherwise the same rows as the table.
   */
  chartRows?: Row[];
  cols: string[];
  types: Record<string, ValueType>;
  axes: Axes;
  warnings: string[];
}

export function computeTypes(blocks: SourceBlock[], ov: TypeOverrides): Record<string, ValueType> {
  const values = new Map<string, string[]>();
  for (const b of blocks) {
    if (b.preBlock) continue;
    for (const [k, v] of Object.entries(readProps(b.content).props)) {
      if (!values.has(k)) values.set(k, []);
      values.get(k)!.push(v);
    }
  }
  const out: Record<string, ValueType> = {};
  for (const [k, vs] of values) out[k] = resolveType(k, inferType(vs), ov);
  return out;
}

export const typeOf = (types: Record<string, ValueType>, key: string): ValueType => types[key] ?? 'string';

/** Columns a numeric axis can take: numbers, ratios and cells holding several numbers. */
export const isAxisNumeric = (t: ValueType): boolean => isNumericType(t) || t === 'numlist';

export function matchCond(row: Row, c: Cond, types: Record<string, ValueType>): boolean {
  const v = row.values[c.key];
  if (c.kind === 'has') return v !== undefined;
  const t = typeOf(types, c.key);
  if (c.op === '==') return c.values.some((x) => valuesEqual(t, v, x));
  if (c.op === '!=') return !c.values.some((x) => valuesEqual(t, v, x));
  // A cell with several numbers compares by its mean, where the chart draws it.
  const x = cellMean(v);
  const y = Number(c.values[0]);
  if (isNaN(x)) return false;
  return c.op === '<' ? x < y : c.op === '<=' ? x <= y : c.op === '>' ? x > y : x >= y;
}

function sortRows(rows: Row[], sort: { key: string; desc: boolean }, types: Record<string, ValueType>): Row[] {
  return [...rows].sort((a, b) => {
    const va = a.values[sort.key];
    const vb = b.values[sort.key];
    const c = compareValues(typeOf(types, sort.key), va, vb);
    // Missing values stay last whatever the direction.
    if (!c || va === undefined || vb === undefined) return c;
    return sort.desc ? -c : c;
  });
}

function keysInOrder(rows: Row[]): string[] {
  const seen = new Set<string>();
  // A formula that failed has no value but is still a column.
  for (const r of rows) for (const k of [...Object.keys(r.values), ...Object.keys(r.errors ?? {})]) seen.add(k);
  return [...seen];
}

function referencedKeys(q: Query): string[] {
  const keys = q.conds.map((c) => c.key);
  if (q.sort) keys.push(q.sort.key);
  if (q.by) keys.push(q.by);
  if (q.x) keys.push(q.x);
  keys.push(...q.ys);
  if (q.color) keys.push(q.color);
  return [...new Set(keys)];
}

/** Settings win; otherwise scatter takes the first two numeric columns, bar a category against a number. */
export function defaultAxes(q: Query, kind: Kind, cols: string[], types: Record<string, ValueType>): Axes {
  const axes: Axes = { ys: [...q.ys] };
  if (q.x) axes.x = q.x;
  if (q.color) axes.color = q.color;
  if (kind === 'table') return axes;
  const numeric = cols.filter((k) => isAxisNumeric(typeOf(types, k)));
  if (kind === 'scatter') {
    axes.ys = axes.ys.slice(0, 1);
    axes.x ??= numeric.find((k) => k !== axes.ys[0]);
    if (!axes.ys.length) axes.ys = numeric.filter((k) => k !== axes.x).slice(0, 1);
  } else {
    axes.x ??= cols.find((k) => ['category', 'string'].includes(typeOf(types, k)));
    if (!axes.ys.length) axes.ys = numeric.filter((k) => k !== axes.x).slice(0, 1);
  }
  return axes;
}

/** The database returns blocks in no particular order; restore the order the user wrote them in. */
function inOutlineOrder(blocks: SourceBlock[], order: Map<string, number> | undefined): SourceBlock[] {
  return [...blocks].sort((a, b) => {
    const pa = order?.get(a.uuid);
    const pb = order?.get(b.uuid);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined || pb !== undefined) return pa !== undefined ? -1 : 1;
    return comparePriority(a, b) || a.seq - b.seq;
  });
}

/** refs → by → conditions → sort → cols and axes. */
export function runQuery(q: Query, kind: Kind, ctx: QueryContext): QueryResult {
  const tagged = ctx.blocks.filter((b) => b.uuid !== ctx.macroUuid && q.refs.every((r) => b.pathRefs.includes(r)));
  let all = inOutlineOrder(tagged, ctx.order)
    .map(blockToRow)
    .filter((r): r is Row => r !== null);
  const pass = (r: Row) => q.conds.every((c) => matchCond(r, c, ctx.types));
  let chartRows: Row[] | undefined;
  // `by:KEY`: rows are the blocks that carry KEY, one row per KEY value.
  if (q.by) {
    const by = q.by;
    const carriers = all.filter((r) => by in r.values);
    all = mergeRows(carriers, by);
    // The chart keeps the blocks apart and groups them itself. A block lacking a key a condition
    // asks about takes it from its merged row, but only when the blocks of that row agree on it.
    const mergedOf = new Map(all.map((m) => [canonical(m.values[by]), m]));
    chartRows = carriers.filter((r) => {
      const m = mergedOf.get(canonical(r.values[by]));
      const values = { ...r.values };
      if (m) for (const [k, v] of Object.entries(m.values)) if (!(k in values) && !m.conflicts[k]) values[k] = v;
      return pass({ ...r, values });
    });
  }
  let rows = all.filter(pass);
  if (q.sort) rows = sortRows(rows, q.sort, ctx.types);
  const present = keysInOrder(all);
  const cols = present.filter((k) => k !== q.by);
  const warnings: string[] = [];
  if (!all.length)
    warnings.push(q.refs.length ? `No blocks with properties are tagged ${q.refs.map((r) => '#' + r).join(' ')}.` : 'No blocks with properties.');
  else for (const k of referencedKeys(q)) if (!present.includes(k)) warnings.push(`No block has '${k}'.`);
  return { rows, chartRows: chartRows ?? rows, cols, types: ctx.types, axes: defaultAxes(q, kind, cols, ctx.types), warnings };
}
