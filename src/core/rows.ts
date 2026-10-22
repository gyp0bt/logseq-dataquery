import { resolveFormulas } from './formula';
import { parseContent } from './text';
import { toList } from './types';

/** A block as read from the graph; `page` and `pathRefs` are lower-cased page names. */
export interface SourceBlock {
  uuid: string;
  content: string;
  page: string;
  pageTitle: string;
  journalDay: number | null;
  pathRefs: string[];
  preBlock: boolean;
  /** Text of the nearest ancestor block that has any; names a block whose own text is empty. */
  parentTitle?: string;
  /** Database id; roughly document order, used when tree position is unknown. */
  seq: number;
}
export interface Source { uuid: string; pageTitle: string; journalDay: number | null }
export interface Conflict { value: string; pageTitle: string }
export interface Row {
  id: string;
  title: string;
  values: Record<string, string>;
  /** Highest priority first; `sources[0]` is where clicks jump to. */
  sources: Source[];
  conflicts: Record<string, Conflict[]>;
  /** Formula cells: the `=…` text behind the computed value in `values`. */
  formulas?: Record<string, string>;
  /** Formula cells that failed: why. They have no entry in `values`. */
  errors?: Record<string, string>;
  /** Merged rows only: the blocks holding each key, highest priority first. */
  owners?: Record<string, string[]>;
}

/** The properties of a block with formulas worked out, plus the formula text and failures. */
export function readProps(content: string): { props: Record<string, string>; title: string; formulas: Record<string, string>; errors: Record<string, string> } {
  const { props, title } = parseContent(content);
  const r = resolveFormulas(props);
  return { props: r.values, title, formulas: r.formulas, errors: r.errors };
}

export function blockToRow(b: SourceBlock): Row | null {
  if (b.preBlock) return null;
  const { props, title, formulas, errors } = readProps(b.content);
  if (Object.keys(props).length === 0 && Object.keys(errors).length === 0) return null;
  const row: Row = {
    id: b.uuid,
    // A block that holds only properties is named after its parent: `## Item` over `- status:: ok`.
    title: title || b.parentTitle || '',
    values: props,
    sources: [{ uuid: b.uuid, pageTitle: b.pageTitle, journalDay: b.journalDay }],
    conflicts: {},
  };
  if (Object.keys(formulas).length) {
    row.formulas = formulas;
    row.errors = errors;
  }
  return row;
}

/** Newest journal first, then non-journal pages by title. */
export function comparePriority(a: Source, b: Source): number {
  if (a.journalDay !== null && b.journalDay !== null) return b.journalDay - a.journalDay;
  if (a.journalDay !== null) return -1;
  if (b.journalDay !== null) return 1;
  return a.pageTitle < b.pageTitle ? -1 : a.pageTitle > b.pageTitle ? 1 : 0;
}

/** Text that treats `0.2`, `0.20` and `8/16.0`, `8/16` as the same value. */
export function canonical(v: string): string {
  const l = toList(v);
  return l ? l.join('/') : v;
}
const same = (a: string, b: string) => canonical(a) === canonical(b);

export function mergeRows(rows: Row[], key: string): Row[] {
  const groups = new Map<string, Row[]>();
  const order: Array<Row | string> = [];
  for (const r of rows) {
    const raw = r.values[key];
    if (raw === undefined) {
      order.push(r);
      continue;
    }
    const k = canonical(raw);
    if (!groups.has(k)) {
      groups.set(k, []);
      order.push(k);
    }
    groups.get(k)!.push(r);
  }
  return order.map((x) => (typeof x === 'string' ? combine(groups.get(x)!) : x));
}

function combine(rows: Row[]): Row {
  if (rows.length === 1) return rows[0];
  const ranked = [...rows].sort((a, b) => comparePriority(a.sources[0], b.sources[0]));
  const values: Record<string, string> = {};
  const conflicts: Record<string, Conflict[]> = {};
  for (const r of ranked) for (const [k, v] of Object.entries(r.values)) if (!(k in values)) values[k] = v;
  for (const k of Object.keys(values)) {
    const seen = ranked
      .filter((r) => k in r.values)
      .map((r) => ({ value: r.values[k], pageTitle: r.sources[0].pageTitle }));
    if (seen.some((s) => !same(s.value, seen[0].value))) conflicts[k] = seen;
  }
  const owners: Record<string, string[]> = {};
  for (const k of Object.keys(values)) owners[k] = ranked.filter((r) => k in r.values).map((r) => r.sources[0].uuid);
  const formulas: Record<string, string> = {};
  const errors: Record<string, string> = {};
  // The block whose value won a key decides whether that cell is a formula.
  for (const k of new Set(ranked.flatMap((r) => Object.keys(r.formulas ?? {})))) {
    const win = ranked.find((r) => k in r.values || k in (r.formulas ?? {}));
    if (win?.formulas && k in win.formulas) {
      formulas[k] = win.formulas[k];
      if (win.errors?.[k]) errors[k] = win.errors[k];
    }
  }
  const merged: Row = { id: ranked[0].id, title: ranked[0].title, values, sources: ranked.map((r) => r.sources[0]), conflicts, owners };
  if (Object.keys(formulas).length) {
    merged.formulas = formulas;
    merged.errors = errors;
  }
  return merged;
}

export function rowLabel(row: Row, mergeBy?: string): string {
  return (mergeBy && row.values[mergeBy]) || row.title || row.id.slice(0, 8);
}

export const SEVERAL_BLOCKS = 'Cell comes from several blocks; edit the block directly';

/**
 * The block a table cell edit writes `key` to: a single-block row's own block, or in a row merged
 * by `by:` the one block holding that key. null when the cell is read-only (the `by` key itself).
 */
export function cellTarget(row: Row, key: string, by?: string): { uuid: string } | { error: string } | null {
  if (by !== undefined && key === by) return null;
  if (row.sources.length === 1) return { uuid: row.sources[0].uuid };
  const own = row.owners?.[key] ?? [];
  return own.length === 1 ? { uuid: own[0] } : { error: SEVERAL_BLOCKS };
}

/** Why `key` cannot be a new table column, or null when it can (lower case, no spaces, not shown yet). */
export function validatePropKey(key: string, cols: string[]): string | null {
  if (!key) return 'Type a property name.';
  if (/\s/.test(key)) return 'No spaces in a property name.';
  if (/[:,]/.test(key)) return "A property name cannot hold ':' or ','.";
  if (key !== key.toLowerCase()) return `Use lower case: ${key.toLowerCase()}.`;
  if (cols.includes(key)) return `'${key}' is already a column.`;
  return null;
}
