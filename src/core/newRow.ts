import type { Query } from './dsl';

/** What a new row of the table starts with, so that it matches the query that shows the table. */
export interface NewRow {
  /** The block's header line, which labels the row. */
  title: string;
  /** Block text: the header line, then `tags::` for the `#tag` / `[[page]]` terms, then `key:: value` for each `key==value`. */
  content: string;
  /** The same `key:: value` pairs, shown in the row before Logseq has the block. */
  values: Record<string, string>;
}

/** `n` is the row's number in the table; it names the header line. */
export function newRowFor(q: Query, n = 1): NewRow {
  const values: Record<string, string> = {};
  for (const c of q.conds) if (c.kind === 'cmp' && c.op === '==' && c.values.length === 1 && !(c.key in values)) values[c.key] = c.values[0];
  // The header line makes the block a normal block with text of its own; a block that starts with
  // a property line is read by Logseq as a property block, and the row would vanish on its first edit.
  const title = `row ${n}`;
  const lines: string[] = [title];
  // `tags::` makes the block reference each page, which is what `#tag` and `[[page]]` ask for.
  if (q.refs.length) lines.push(`tags:: ${q.refs.map((r) => `[[${r}]]`).join(', ')}`);
  for (const [k, v] of Object.entries(values)) lines.push(`${k}:: ${v}`);
  return { title, content: lines.join('\n'), values };
}
