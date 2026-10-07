import { isNumberText } from './types';

export type Kind = 'table' | 'scatter' | 'bar';
export type CmpOp = '==' | '!=' | '<' | '<=' | '>' | '>=';
export type Cond =
  /** `values.length > 1` only for `==` / `!=`: `key==a,b` means a or b. */
  | { kind: 'cmp'; key: string; op: CmpOp; values: string[] }
  | { kind: 'has'; key: string };
export type ErrMode = 'bar' | 'band' | 'off';
export interface Query {
  /** Lower-cased page names from `#tag`, `#[[a b]]`, `[[a b]]`. */
  refs: string[];
  conds: Cond[];
  x?: string;
  ys: string[];
  color?: string;
  sort?: { key: string; desc: boolean };
  by?: string;
  labels: boolean;
  err: ErrMode;
}
/** `col` is a 0-based offset into the query text, used to place the error caret. */
export interface DslError { message: string; col: number }
export type ParseResult = { ok: true; query: Query } | { ok: false; error: DslError };
export type SettingName = 'x' | 'y' | 'color' | 'sort' | 'by' | 'labels' | 'err';

const SETTINGS: readonly SettingName[] = ['x', 'y', 'color', 'sort', 'by', 'labels', 'err'];

const emptyQuery = (): Query => ({ refs: [], conds: [], ys: [], labels: false, err: 'bar' });

class DslSyntaxError extends Error {
  constructor(message: string, readonly col: number) {
    super(message);
  }
}

// Any Logseq property key (Unicode, `done?`), minus characters the query itself uses.
const KEY = /^[^\s<>=!|,()"*:{}[\]]+$/;
// Two-character operators first so `<=` is not read as `<`.
const OPS = ['==', '!=', '<=', '>=', '<', '>', '='] as const;
const NUMERIC_OPS: CmpOp[] = ['<', '<=', '>', '>='];

type Tok = { s: string; at: number };

/**
 * Split on whitespace outside `"…"` and `[[…]]`. Logseq's comma splitting turns `a,b` into
 * `a, b`, so whitespace right after a comma continues the term. `strict` reports unclosed
 * quotes and links; otherwise they run to the end of the text.
 */
function tokenize(text: string, strict: boolean): Tok[] {
  const out: Tok[] = [];
  const ws = (c: string | undefined) => c !== undefined && /\s/.test(c);
  let i = 0;
  while (i < text.length) {
    while (ws(text[i])) i++;
    if (i >= text.length) break;
    const start = i;
    while (i < text.length && !ws(text[i])) {
      const close = text[i] === '"' ? '"' : text.startsWith('[[', i) ? ']]' : '';
      if (close) {
        const j = text.indexOf(close, i + (close === '"' ? 1 : 2));
        if (j < 0 && strict) throw new DslSyntaxError(close === '"' ? 'Unclosed quote.' : "Unclosed '[['.", i);
        i = j < 0 ? text.length : j + close.length;
      } else i++;
      if (ws(text[i]) && text[i - 1] === ',') while (ws(text[i])) i++;
    }
    out.push({ s: text.slice(start, i).trimEnd(), at: start });
  }
  return out;
}

/** Index of the first operator outside quotes and links. */
function findOp(s: string): { i: number; op: (typeof OPS)[number] } | null {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' || s.startsWith('[[', i)) {
      const close = s[i] === '"' ? '"' : ']]';
      const j = s.indexOf(close, i + 1);
      if (j < 0) return null;
      i = j + close.length - 1;
      continue;
    }
    const op = OPS.find((o) => s.startsWith(o, i));
    if (op) return { i, op };
  }
  return null;
}

/** Split `a,"b,c"` on commas outside quotes, keeping each item's offset. */
function splitList(s: string, at: number): Tok[] {
  const out: Tok[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i <= s.length; i++) {
    if (s[i] === '"') quoted = !quoted;
    if (i === s.length || (s[i] === ',' && !quoted)) {
      const raw = s.slice(start, i);
      out.push({ s: raw.trim(), at: at + start + (raw.length - raw.trimStart().length) });
      start = i + 1;
    }
  }
  return out;
}

const unquote = (s: string) => (/^"[\s\S]*"$/.test(s) ? s.slice(1, -1) : s);

function key(s: string, at: number): string {
  if (!KEY.test(s)) throw new DslSyntaxError(`'${s}' is not a property key.`, at);
  return s.toLowerCase();
}

export function parseQuery(text: string): ParseResult {
  try {
    return { ok: true, query: parseOrThrow(text) };
  } catch (e) {
    if (e instanceof DslSyntaxError) return { ok: false, error: { message: e.message, col: e.col } };
    throw e;
  }
}

function parseOrThrow(text: string): Query {
  const q = emptyQuery();
  const brace = text.indexOf('}}');
  if (brace >= 0) throw new DslSyntaxError("'}}' would end the macro. Remove it from the query.", brace);
  const nl = text.search(/[\r\n]/);
  if (nl >= 0) throw new DslSyntaxError('Write the query on one line.', nl);
  const seen = new Set<string>();
  for (const t of tokenize(text, true)) {
    const ref = parseRef(t);
    if (ref !== null) {
      q.refs.push(ref);
      continue;
    }
    const op = findOp(t.s);
    if (op) {
      q.conds.push(parseCond(t, op.i, op.op));
      continue;
    }
    const m = /^([^:"[\]]+):([\s\S]*)$/.exec(t.s);
    if (m) {
      const name = m[1].toLowerCase() as SettingName;
      if (!SETTINGS.includes(name)) throw new DslSyntaxError(`Unknown setting '${m[1]}'. Use x, y, color, sort, by, labels or err.`, t.at);
      if (seen.has(name)) throw new DslSyntaxError(`Duplicate '${name}:' setting. Keep one.`, t.at);
      seen.add(name);
      applySetting(q, name, m[2], t.at + m[1].length + 1);
      continue;
    }
    if (!KEY.test(t.s)) throw new DslSyntaxError(`Cannot read '${t.s}'. Example: #tag, seed==0, x:gre-thin or gre-thin.`, t.at);
    q.conds.push({ kind: 'has', key: t.s.toLowerCase() });
  }
  return q;
}

function parseRef({ s, at }: Tok): string | null {
  const link = /^#?\[\[([\s\S]+)\]\]$/.exec(s);
  if (link) return link[1].trim().toLowerCase();
  if (!s.startsWith('#')) return null;
  if (s === '#') throw new DslSyntaxError("'#' needs a page name, e.g. #work/nsb.", at);
  return s.slice(1).toLowerCase();
}

function parseCond(t: Tok, i: number, rawOp: (typeof OPS)[number]): Cond {
  const op: CmpOp = rawOp === '=' ? '==' : rawOp;
  if (i === 0) throw new DslSyntaxError(`Missing key before '${rawOp}'.`, t.at);
  const k = key(t.s.slice(0, i), t.at);
  const raw = t.s.slice(i + rawOp.length);
  const valueAt = t.at + i + rawOp.length;
  if (!raw) throw new DslSyntaxError(`Missing value after '${rawOp}'. Example: ${k}${rawOp}1.3`, valueAt);
  if (NUMERIC_OPS.includes(op)) {
    const v = unquote(raw);
    if (!isNumberText(v)) throw new DslSyntaxError(`'${op}' compares numbers, got '${raw}'.`, valueAt);
    return { kind: 'cmp', key: k, op, values: [v] };
  }
  const values = splitList(raw, valueAt).map((p) => {
    if (!p.s) throw new DslSyntaxError(`Empty value in '${t.s}'.`, t.at);
    return unquote(p.s);
  });
  return { kind: 'cmp', key: k, op, values };
}

function applySetting(q: Query, name: SettingName, v: string, at: number): void {
  if (!v) throw new DslSyntaxError(`Missing value after '${name}:'.`, at);
  switch (name) {
    case 'x': q.x = key(v, at); break;
    case 'color': q.color = key(v, at); break;
    case 'by': q.by = key(v, at); break;
    case 'y': q.ys = splitList(v, at).map((p) => key(p.s, p.at)); break;
    case 'sort':
      q.sort = v.startsWith('-') ? { key: key(v.slice(1), at + 1), desc: true } : { key: key(v, at), desc: false };
      break;
    case 'labels': {
      const l = v.toLowerCase();
      if (l !== 'on' && l !== 'off') throw new DslSyntaxError('labels: takes on or off.', at);
      q.labels = l === 'on';
      break;
    }
    case 'err': {
      const e = v.toLowerCase();
      if (e !== 'bar' && e !== 'band' && e !== 'off') throw new DslSyntaxError('err: takes bar, band or off.', at);
      q.err = e;
      break;
    }
  }
}

/**
 * Replace, add (`value` non-null) or remove (`null`) one `name:value` setting. The rest of the
 * text stays exactly as the user wrote it; an added setting goes at the end after one space.
 */
export function setSetting(text: string, name: SettingName, value: string | null): string {
  const hits = tokenize(text, false).filter((t) => !findOp(t.s) && t.s.toLowerCase().startsWith(name + ':'));
  const piece = value === null ? null : `${name}:${value}`;
  if (!hits.length) {
    if (piece === null) return text;
    const base = text.trimEnd();
    return base ? `${base} ${piece}` : piece;
  }
  let out = text;
  // Right to left so earlier offsets stay valid; duplicates beyond the first are dropped.
  for (let k = hits.length - 1; k >= 0; k--) {
    const t = hits[k];
    let a = t.at;
    let z = t.at + t.s.length;
    if (k === 0 && piece !== null) {
      out = out.slice(0, a) + piece + out.slice(z);
      continue;
    }
    // Take the whitespace before the setting with it, or the whitespace after when it comes first.
    while (a > 0 && /\s/.test(out[a - 1])) a--;
    if (a === 0) while (z < out.length && /\s/.test(out[z])) z++;
    out = out.slice(0, a) + out.slice(z);
  }
  return out;
}

/**
 * The `±` (error bars) and `▤` (band) buttons are two exclusive on/off toggles over `err:`.
 * Returns the new `err:` value, or null to remove the setting (bars, the default).
 */
export function toggleErr(current: ErrMode, button: 'bar' | 'band'): string | null {
  if (button === 'bar') return current === 'bar' ? 'off' : null;
  return current === 'band' ? 'off' : 'band';
}

/** Logseq hands renderer arguments split on commas; put them back together. */
export function joinMacroArgs(args: string[]): string {
  return args.map((a) => a.trim()).join(', ');
}
