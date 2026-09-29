import { isNumberText } from './types';

export type CmpOp = '=' | '!=' | '<' | '<=' | '>' | '>=';
export type Scope = { kind: 'all' } | { kind: 'here' } | { kind: 'page' } | { kind: 'ref'; page: string };
export type Cond =
  | { kind: 'cmp'; key: string; op: CmpOp; value: string }
  | { kind: 'in'; key: string; values: string[] }
  | { kind: 'has'; key: string; value: string };
export interface SortKey { key: string; desc: boolean }
export type ScatterPlot = { kind: 'scatter'; x: string; y: string; color?: string; labels: boolean };
export type BarPlot = { kind: 'bar'; x: string; ys: string[] };
export type Plot = ScatterPlot | BarPlot;
export interface Query { scope: Scope; mergeBy?: string; where: Cond[]; sort: SortKey[]; cols?: string[]; plot?: Plot }
/** `col` is a 0-based offset into the query text, used to place the error caret. */
export interface DslError { message: string; col: number }
export type ParseResult = { ok: true; query: Query } | { ok: false; error: DslError };

export const emptyQuery = (): Query => ({ scope: { kind: 'all' }, where: [], sort: [] });

class DslSyntaxError extends Error {
  constructor(message: string, readonly col: number) {
    super(message);
  }
}

// Any Logseq property key (Unicode, `done?`), minus characters the DSL itself uses.
const KEY = /^[^\s<>=!|,()"*:{}[\]]+$/;
const PATTERN = /^[^\s<>=!|,()":{}[\]]+$/;
const NUMERIC_OPS: CmpOp[] = ['<', '<=', '>', '>='];

type Piece = { s: string; at: number };

/** Hide quoted text and [[links]] so separators inside them are not seen. */
function mask(text: string): string {
  return text
    .replace(/"[^"]*"/g, (m) => '"' + '_'.repeat(m.length - 2) + '"')
    .replace(/\[\[[^\]]*\]\]/g, (m) => '[[' + '_'.repeat(m.length - 4) + ']]');
}

function piece(raw: string, at: number): Piece {
  return { s: raw.trim(), at: at + (raw.length - raw.trimStart().length) };
}

/** Split on `sep` outside quotes/links, keeping each piece's offset in the original text. */
function splitOn(text: string, sep: RegExp, base: number): Piece[] {
  const flags = 'g' + (sep.flags.includes('i') ? 'i' : '');
  const out: Piece[] = [];
  let start = 0;
  for (const hit of mask(text).matchAll(new RegExp(sep.source, flags))) {
    out.push(piece(text.slice(start, hit.index), base + start));
    start = hit.index! + hit[0].length;
  }
  out.push(piece(text.slice(start), base + start));
  return out;
}

const unquote = (s: string) => (/^"[\s\S]*"$/.test(s) ? s.slice(1, -1) : s);

function key(s: string, at: number): string {
  if (!KEY.test(s)) throw new DslSyntaxError(`'${s}' is not a property key.`, at);
  return s.toLowerCase();
}

export function parseDsl(text: string): ParseResult {
  try {
    return { ok: true, query: parseOrThrow(text) };
  } catch (e) {
    if (e instanceof DslSyntaxError) return { ok: false, error: { message: e.message, col: e.col } };
    throw e;
  }
}

function parseOrThrow(text: string): Query {
  const q = emptyQuery();
  if (!text.trim()) return q;
  const brace = text.indexOf('}}');
  if (brace >= 0) throw new DslSyntaxError("'}}' would end the macro. Remove it from the query.", brace);
  const nl = text.search(/[\r\n]/);
  if (nl >= 0) throw new DslSyntaxError('Write the query on one line.', nl);
  const seen = new Set<string>();
  for (const { s, at } of splitOn(text, /\|/, 0)) {
    if (!s) throw new DslSyntaxError("Empty clause between '|'. Remove the extra '|'.", at);
    const m = /^(\S+)\s*([\s\S]*)$/.exec(s)!;
    const head = m[1].toLowerCase();
    const rest = m[2];
    const restAt = at + s.length - rest.length;
    if (seen.has(head)) throw new DslSyntaxError(`Duplicate '${head}' clause. Combine them into one.`, at);
    seen.add(head);
    switch (head) {
      case 'in': q.scope = parseScope(rest, restAt); break;
      case 'from':
      case 'merge':
        if (seen.has(head === 'from' ? 'merge' : 'from')) throw new DslSyntaxError("Use either 'from' or 'merge by', not both.", at);
        q.mergeBy = head === 'from' ? parseFrom(rest, restAt) : parseMerge(rest, restAt);
        break;
      case 'where': q.where = parseWhere(rest, restAt); break;
      case 'sort': q.sort = parseSort(rest, restAt); break;
      case 'cols': q.cols = parseCols(rest, restAt); break;
      case 'plot': q.plot = parsePlot(rest, restAt); break;
      default:
        throw new DslSyntaxError(`Unknown clause '${m[1]}'. Use from, in, where, sort, cols or plot.`, at);
    }
  }
  return q;
}

function parseScope(rest: string, at: number): Scope {
  const r = rest.trim();
  if (r === 'all') return { kind: 'all' };
  if (r === 'here') return { kind: 'here' };
  if (r === 'page') return { kind: 'page' };
  const m = /^\[\[(.+)\]\]$/.exec(r);
  if (m) return { kind: 'ref', page: m[1].trim() };
  throw new DslSyntaxError("'in' takes all, here, page or [[Page name]].", at);
}

function parseFrom(rest: string, at: number): string {
  const r = rest.trim();
  if (!r || /\s/.test(r)) throw new DslSyntaxError("Write 'from <key>', e.g. from run.", at);
  return key(r, at + rest.indexOf(r));
}

/** Older spelling of `from`. */
function parseMerge(rest: string, at: number): string {
  const m = /^by\s+(\S+)$/i.exec(rest.trim());
  if (!m) throw new DslSyntaxError("Write 'merge by <key>', e.g. merge by run.", at);
  return key(m[1], at + rest.indexOf(m[1]));
}

function parseWhere(rest: string, at: number): Cond[] {
  if (!rest.trim()) throw new DslSyntaxError("'where' needs a condition, e.g. where gre-thin < 1.3.", at);
  return splitOn(rest, /\s+and\s+/i, at).map(({ s, at: a }) => parseCond(s, a));
}

function parseCond(s: string, at: number): Cond {
  if (!s) throw new DslSyntaxError("A condition is missing around 'and'.", at);
  let m: RegExpExecArray | null;
  if ((m = /^(\S+)\s+in\s*\(([\s\S]*)\)$/i.exec(s))) {
    const k = key(m[1], at);
    const values = splitOn(m[2], /,/, at + s.indexOf('(') + 1).map((p) => {
      if (!p.s) throw new DslSyntaxError("Empty value in 'in (...)'.", p.at);
      return unquote(p.s);
    });
    return { kind: 'in', key: k, values };
  }
  if ((m = /^(\S+)\s+in\b/i.exec(s)))
    throw new DslSyntaxError("Write 'in' values in parentheses, e.g. combine in (none, mean).", at + m[0].length);
  if ((m = /^(\S+)\s+has\s+(\S+)$/i.exec(s))) {
    const k = key(m[1], at);
    if (!isNumberText(m[2])) throw new DslSyntaxError(`'has' takes a number, got '${m[2]}'.`, at + s.lastIndexOf(m[2]));
    return { kind: 'has', key: k, value: m[2] };
  }
  if ((m = /^([^\s<>=!]+)\s*(<=|>=|!=|=|<|>)\s*([\s\S]*)$/.exec(s))) {
    const k = key(m[1], at);
    const op = m[2] as CmpOp;
    const raw = m[3].trim();
    if (!raw) throw new DslSyntaxError(`Missing value after '${op}'. Example: ${k} ${op} 1.3`, at + s.length);
    if (/\s+and$/i.test(raw)) throw new DslSyntaxError(`Cannot read condition '${s}'. Example: gre-thin < 1.3`, at);
    const value = unquote(raw);
    if (NUMERIC_OPS.includes(op) && !isNumberText(value))
      throw new DslSyntaxError(`'${op}' compares numbers, got '${raw}'.`, at + s.length - raw.length);
    return { kind: 'cmp', key: k, op, value };
  }
  throw new DslSyntaxError(`Cannot read condition '${s}'. Example: gre-thin < 1.3`, at);
}

function parseSort(rest: string, at: number): SortKey[] {
  if (!rest.trim()) throw new DslSyntaxError("'sort' needs a key, e.g. sort r2-thin desc.", at);
  return splitOn(rest, /,/, at).map(({ s, at: a }) => {
    const m = /^(\S+)(?:\s+(asc|desc))?$/i.exec(s);
    if (!m) throw new DslSyntaxError(`Cannot read sort key '${s}'. Write key or key desc.`, a);
    return { key: key(m[1], a), desc: (m[2] ?? '').toLowerCase() === 'desc' };
  });
}

function parseCols(rest: string, at: number): string[] {
  if (!rest.trim()) throw new DslSyntaxError("'cols' needs at least one key.", at);
  return splitOn(rest, /,/, at).map(({ s, at: a }) => {
    if (!PATTERN.test(s)) throw new DslSyntaxError(`'${s}' is not a property key or pattern.`, a);
    return s.toLowerCase();
  });
}

function parsePlot(rest: string, at: number): Plot {
  // Logseq's comma splitting turns `y=a,b` into `y=a, b`; glue list items back together.
  // Offsets after a glued comma drift by the removed spaces; close enough for a caret.
  const glued = rest.replace(/\s*,\s*/g, ',');
  const toks = splitOn(glued, /\s+/, at).filter((t) => t.s);
  if (!toks.length) throw new DslSyntaxError("'plot' needs scatter or bar.", at);
  const kind = toks[0].s.toLowerCase();
  if (kind !== 'scatter' && kind !== 'bar') throw new DslSyntaxError(`Unknown plot '${toks[0].s}'. Use scatter or bar.`, toks[0].at);
  const allowed = kind === 'scatter' ? ['x', 'y', 'color', 'labels'] : ['x', 'y'];
  const opts: Record<string, Piece> = {};
  for (const t of toks.slice(1)) {
    const eq = t.s.indexOf('=');
    if (eq <= 0) throw new DslSyntaxError(`Write plot options as name=value, got '${t.s}'.`, t.at);
    const name = t.s.slice(0, eq).toLowerCase();
    if (!allowed.includes(name))
      throw new DslSyntaxError(`'${name}=' is not an option of plot ${kind}. Use ${allowed.map((a) => a + '=').join(', ')}.`, t.at);
    const v = t.s.slice(eq + 1);
    if (!v) throw new DslSyntaxError(`Missing value after '${name}='.`, t.at + eq + 1);
    opts[name] = { s: v, at: t.at + eq + 1 };
  }
  for (const need of ['x', 'y']) if (!opts[need]) throw new DslSyntaxError(`plot ${kind} needs ${need}=.`, at + rest.length);
  if (kind === 'bar') {
    return { kind, x: key(opts.x.s, opts.x.at), ys: splitOn(opts.y.s, /,/, opts.y.at).map((p) => key(p.s, p.at)) };
  }
  const labels = opts.labels?.s.toLowerCase();
  if (labels !== undefined && labels !== 'on' && labels !== 'off')
    throw new DslSyntaxError('labels= takes on or off.', opts.labels.at);
  const plot: ScatterPlot = { kind, x: key(opts.x.s, opts.x.at), y: key(opts.y.s, opts.y.at), labels: labels !== 'off' };
  if (opts.color) plot.color = key(opts.color.s, opts.color.at);
  return plot;
}

const quote = (v: string) => (v === '' || /[\s,|()"]/.test(v) || /^and$/i.test(v) ? `"${v}"` : v);

export function printCond(c: Cond): string {
  if (c.kind === 'in') return `${c.key} in (${c.values.map(quote).join(', ')})`;
  if (c.kind === 'has') return `${c.key} has ${c.value}`;
  return `${c.key} ${c.op} ${quote(c.value)}`;
}

/** Canonical one-line form. parseDsl(printDsl(q)) equals q. */
export function printDsl(q: Query): string {
  const parts: string[] = [];
  if (q.mergeBy) parts.push(`from ${q.mergeBy}`);
  if (q.scope.kind === 'here') parts.push('in here');
  if (q.scope.kind === 'page') parts.push('in page');
  if (q.scope.kind === 'ref') parts.push(`in [[${q.scope.page}]]`);
  if (q.where.length) parts.push('where ' + q.where.map(printCond).join(' and '));
  if (q.sort.length) parts.push('sort ' + q.sort.map((s) => s.key + (s.desc ? ' desc' : '')).join(', '));
  if (q.cols?.length) parts.push('cols ' + q.cols.join(', '));
  const p = q.plot;
  if (p?.kind === 'scatter')
    parts.push(`plot scatter x=${p.x} y=${p.y}` + (p.color ? ` color=${p.color}` : '') + (p.labels ? '' : ' labels=off'));
  if (p?.kind === 'bar') parts.push(`plot bar x=${p.x} y=${p.ys.join(',')}`);
  return parts.join(' | ');
}

/** Logseq hands renderer arguments split on commas; put them back together. */
export function joinMacroArgs(args: string[]): string {
  return args.map((a) => a.trim()).join(', ');
}
