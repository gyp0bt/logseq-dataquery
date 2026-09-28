import { parseContent } from './text';
import { isNumberText } from './types';

/** A block as read from the graph; `page` and `pathRefs` are lower-cased page names. */
export interface SourceBlock {
  uuid: string;
  content: string;
  page: string;
  pageTitle: string;
  journalDay: number | null;
  pathRefs: string[];
  preBlock: boolean;
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
}

export function blockToRow(b: SourceBlock): Row | null {
  if (b.preBlock) return null;
  const { props, title } = parseContent(b.content);
  if (Object.keys(props).length === 0) return null;
  return {
    id: b.uuid,
    title,
    values: props,
    sources: [{ uuid: b.uuid, pageTitle: b.pageTitle, journalDay: b.journalDay }],
    conflicts: {},
  };
}

/** Newest journal first, then non-journal pages by title. */
export function comparePriority(a: Source, b: Source): number {
  if (a.journalDay !== null && b.journalDay !== null) return b.journalDay - a.journalDay;
  if (a.journalDay !== null) return -1;
  if (b.journalDay !== null) return 1;
  return a.pageTitle < b.pageTitle ? -1 : a.pageTitle > b.pageTitle ? 1 : 0;
}

const same = (a: string, b: string) => a === b || (isNumberText(a) && isNumberText(b) && Number(a) === Number(b));

export function mergeRows(rows: Row[], key: string): Row[] {
  const groups = new Map<string, Row[]>();
  const order: Array<Row | string> = [];
  for (const r of rows) {
    const k = r.values[key];
    if (k === undefined) {
      order.push(r);
      continue;
    }
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
  return { id: ranked[0].id, title: ranked[0].title, values, sources: ranked.map((r) => r.sources[0]), conflicts };
}

export function rowLabel(row: Row, mergeBy?: string): string {
  return (mergeBy && row.values[mergeBy]) || row.title || row.id.slice(0, 8);
}
