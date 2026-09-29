import type { Cond, Query, Scope, SortKey } from './dsl';
import { blockToRow, comparePriority, mergeRows, type Row, type SourceBlock } from './rows';
import { parseContent } from './text';
import {
  compareValues, globToRegExp, inferType, resolveType, toList, toNumber, valuesEqual, type TypeOverrides, type ValueType,
} from './types';

export interface QueryContext {
  blocks: SourceBlock[];
  types: Record<string, ValueType>;
  macroUuid: string;
  /** Lower-cased name of the page holding the macro. */
  macroPage: string;
  /** Blocks under the macro's parent (or the whole page when the macro is top level). */
  hereIds: Set<string>;
  /** Position of each block of the macro's page in outline order. */
  order?: Map<string, number>;
}
export interface QueryResult {
  /** Rows after scope and merge, before filtering: the panel's filter domains. */
  scoped: Row[];
  rows: Row[];
  cols: string[];
  types: Record<string, ValueType>;
  warnings: string[];
}

export function computeTypes(blocks: SourceBlock[], ov: TypeOverrides): Record<string, ValueType> {
  const values = new Map<string, string[]>();
  for (const b of blocks) {
    if (b.preBlock) continue;
    for (const [k, v] of Object.entries(parseContent(b.content).props)) {
      if (!values.has(k)) values.set(k, []);
      values.get(k)!.push(v);
    }
  }
  const out: Record<string, ValueType> = {};
  for (const [k, vs] of values) out[k] = resolveType(k, inferType(vs), ov);
  return out;
}

export const typeOf = (types: Record<string, ValueType>, key: string): ValueType => types[key] ?? 'string';

function inScope(b: SourceBlock, scope: Scope, ctx: QueryContext): boolean {
  if (b.uuid === ctx.macroUuid) return false;
  if (scope.kind === 'all') return true;
  if (scope.kind === 'here') return ctx.hereIds.has(b.uuid);
  if (scope.kind === 'page') return b.page === ctx.macroPage;
  return b.pathRefs.includes(scope.page.toLowerCase());
}

export function matchCond(row: Row, c: Cond, types: Record<string, ValueType>): boolean {
  const t = typeOf(types, c.key);
  const v = row.values[c.key];
  if (c.kind === 'in') return c.values.some((x) => valuesEqual(t, v, x));
  if (c.kind === 'has') return toList(v)?.includes(Number(c.value)) ?? false;
  if (c.op === '=') return valuesEqual(t, v, c.value);
  if (c.op === '!=') return !valuesEqual(t, v, c.value);
  const x = toNumber(v);
  const y = Number(c.value);
  if (isNaN(x)) return false;
  return c.op === '<' ? x < y : c.op === '<=' ? x <= y : c.op === '>' ? x > y : x >= y;
}

function sortRows(rows: Row[], sort: SortKey[], types: Record<string, ValueType>): Row[] {
  return [...rows].sort((a, b) => {
    for (const s of sort) {
      const va = a.values[s.key];
      const vb = b.values[s.key];
      const c = compareValues(typeOf(types, s.key), va, vb);
      if (!c) continue;
      // Missing values stay last whatever the direction.
      if (va === undefined || vb === undefined) return c;
      return s.desc ? -c : c;
    }
    return 0;
  });
}

function keysInOrder(rows: Row[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.values)) seen.add(k);
  return [...seen];
}

function expandCols(patterns: string[], present: string[]): string[] {
  const out: string[] = [];
  for (const p of patterns) {
    if (!p.includes('*')) out.push(p);
    else out.push(...present.filter((k) => globToRegExp(p).test(k)));
  }
  return [...new Set(out)];
}

function referencedKeys(q: Query): string[] {
  const keys = [...q.where.map((c) => c.key), ...q.sort.map((s) => s.key)];
  if (q.mergeBy) keys.push(q.mergeBy);
  if (q.plot?.kind === 'scatter') keys.push(q.plot.x, q.plot.y, ...(q.plot.color ? [q.plot.color] : []));
  if (q.plot?.kind === 'bar') keys.push(q.plot.x, ...q.plot.ys);
  keys.push(...(q.cols ?? []).filter((c) => !c.includes('*')));
  return [...new Set(keys)];
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

/** scope → merge → where → sort → cols. */
export function runQuery(q: Query, ctx: QueryContext): QueryResult {
  let scoped = inOutlineOrder(ctx.blocks.filter((b) => inScope(b, q.scope, ctx)), ctx.order)
    .map(blockToRow)
    .filter((r): r is Row => r !== null);
  // `from KEY`: rows are the blocks that carry KEY, one row per KEY value.
  if (q.mergeBy) scoped = mergeRows(scoped.filter((r) => q.mergeBy! in r.values), q.mergeBy);
  let rows = scoped.filter((r) => q.where.every((c) => matchCond(r, c, ctx.types)));
  if (q.sort.length) rows = sortRows(rows, q.sort, ctx.types);
  const present = keysInOrder(scoped);
  const cols = (q.cols ? expandCols(q.cols, present) : present).filter((k) => k !== q.mergeBy);
  const warnings: string[] = [];
  if (!scoped.length) warnings.push('No blocks with properties in this scope.');
  else for (const k of referencedKeys(q)) if (!present.includes(k)) warnings.push(`No block in this scope has '${k}'.`);
  return { scoped, rows, cols, types: ctx.types, warnings };
}
