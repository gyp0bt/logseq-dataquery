import type { Query } from './dsl';

/** What a new row of the table starts with, so that it matches the query that shows the table. */
export interface NewRow {
  /** Block text: `tags::` for the `#tag` / `[[page]]` terms, then `key:: value` for each `key==value`. */
  content: string;
  /** The same `key:: value` pairs, shown in the row before Logseq has the block. */
  values: Record<string, string>;
}

export function newRowFor(q: Query): NewRow {
  const values: Record<string, string> = {};
  for (const c of q.conds) if (c.kind === 'cmp' && c.op === '==' && c.values.length === 1 && !(c.key in values)) values[c.key] = c.values[0];
  const lines: string[] = [];
  // `tags::` makes the block reference each page, which is what `#tag` and `[[page]]` ask for.
  if (q.refs.length) lines.push(`tags:: ${q.refs.map((r) => `[[${r}]]`).join(', ')}`);
  for (const [k, v] of Object.entries(values)) lines.push(`${k}:: ${v}`);
  return { content: lines.join('\n'), values };
}
