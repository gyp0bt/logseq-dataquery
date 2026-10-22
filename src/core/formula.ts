import { cellMean, isNumberText } from './types';

/**
 * Spreadsheet formulas for one table row. A property value that starts with `=` is a formula over
 * the other properties of the same block: `=score*2`, `=round(loss/seed, 2)`, `=sum(a:c)`.
 * A cell is named by its column (property key). Without a parser fed with the key list `a-b` would
 * be a subtraction; here the longest known key wins at each position, so `gre-thin` is one cell and
 * `gre - thin` (spaces) is a subtraction. No `eval`: the text is tokenised and evaluated here.
 */

export type FormulaValue = number | string | boolean;
export type FormulaResult = { ok: true; value: FormulaValue } | { ok: false; error: string };

class FormulaError extends Error {}
/** Not caught by `evalFormula`: it has to reach every cell on the cycle. */
class CycleError extends Error {}
const fail = (msg: string): never => {
  throw new FormulaError(msg);
};

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; key: string }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string };

const IDENT = /[A-Za-z0-9_]/;
const OPS = ['<>', '<=', '>=', '==', '!=', '+', '-', '*', '/', '%', '^', '&', '<', '>', '=', '(', ')', ',', ':'];

/** Longest column name that starts at `i` and is not the front of a longer word. */
function matchKey(src: string, i: number, keys: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const k of keys) {
    if (!k || /^\d/.test(k) || !src.startsWith(k, i)) continue;
    if (IDENT.test(k[k.length - 1]) && IDENT.test(src[i + k.length] ?? ' ')) continue;
    if (i > 0 && IDENT.test(src[i - 1]) && IDENT.test(k[0])) continue;
    if (!best || k.length > best.length) best = k;
  }
  return best;
}

function tokenize(src: string, keys: readonly string[]): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) fail('Unterminated text: close it with ' + c);
      out.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const num = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num && !(i > 0 && IDENT.test(src[i - 1]))) {
      out.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const key = matchKey(src, i, keys);
    // A name followed by `(` is a function even if a column has the same name.
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))?.[0];
    if (key && !(word === key && src[i + key.length] === '(')) {
      out.push({ t: 'ref', key });
      i += key.length;
      continue;
    }
    if (word) {
      out.push({ t: 'name', v: word });
      i += word.length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) return fail(`Unexpected '${c}'`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  return out;
}

type Node =
  | { n: 'num'; v: number }
  | { n: 'str'; v: string }
  | { n: 'bool'; v: boolean }
  | { n: 'ref'; key: string }
  | { n: 'range'; from: string; to: string }
  | { n: 'un'; op: string; a: Node }
  | { n: 'bin'; op: string; a: Node; b: Node }
  | { n: 'call'; f: string; args: Node[] };

// Lowest to highest: comparison, `&`, + -, * / %, unary -, ^.
function parse(toks: Tok[]): Node {
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && (peek() as { v: string }).v === v;
  const eat = (v: string) => {
    if (!isOp(v)) fail(`Expected '${v}'`);
    p++;
  };
  const level = (ops: string[], next: () => Node): Node => {
    let a = next();
    while (peek()?.t === 'op' && ops.includes((peek() as { v: string }).v)) {
      const op = (toks[p++] as { v: string }).v;
      a = { n: 'bin', op, a, b: next() };
    }
    return a;
  };
  const power = (): Node => {
    const a = atom();
    if (isOp('^')) {
      p++;
      return { n: 'bin', op: '^', a, b: unary() };
    }
    return a;
  };
  const unary = (): Node => {
    if (isOp('-') || isOp('+')) {
      const op = (toks[p++] as { v: string }).v;
      return { n: 'un', op, a: unary() };
    }
    return power();
  };
  const mul = () => level(['*', '/', '%'], unary);
  const add = () => level(['+', '-'], mul);
  const cat = () => level(['&'], add);
  const cmp = () => level(['<>', '<=', '>=', '==', '!=', '<', '>', '='], cat);
  function atom(): Node {
    const t = toks[p++];
    if (!t) return fail('The formula ends too early');
    if (t.t === 'num') return { n: 'num', v: t.v };
    if (t.t === 'str') return { n: 'str', v: t.v };
    if (t.t === 'ref') {
      if (isOp(':')) {
        p++;
        const to = toks[p++];
        if (to?.t !== 'ref') return fail("A range needs a column after ':'");
        return { n: 'range', from: t.key, to: to.key };
      }
      return { n: 'ref', key: t.key };
    }
    if (t.t === 'name') {
      const lc = t.v.toLowerCase();
      if (isOp('(')) {
        p++;
        const args: Node[] = [];
        if (!isOp(')')) {
          args.push(cmp());
          while (isOp(',')) {
            p++;
            args.push(cmp());
          }
        }
        eat(')');
        return { n: 'call', f: lc, args };
      }
      if (lc === 'true' || lc === 'false') return { n: 'bool', v: lc === 'true' };
      return { n: 'call', f: lc, args: [] };
    }
    if (t.v === '(') {
      const e = cmp();
      eat(')');
      return e;
    }
    return fail(`Unexpected '${t.v}'`);
  }
  const root = cmp();
  if (p < toks.length) fail(`Unexpected '${(toks[p] as { v?: string }).v ?? (toks[p] as { key?: string }).key}'`);
  return root;
}

type Fn = (a: FormulaValue[]) => FormulaValue;

const num = (v: FormulaValue): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const m = cellMean(v);
  if (!isNaN(m)) return m;
  if (v.trim() === '') return 0;
  return fail(`'${v}' is not a number`);
};
const nums = (a: FormulaValue[]): number[] => a.flatMap((v) => (typeof v === 'string' && v.trim() === '' ? [] : [num(v)]));
const text = (v: FormulaValue): string => (typeof v === 'number' ? fmt(v) : String(v));
const need = (name: string, a: FormulaValue[], min: number, max = min) => {
  if (a.length < min || a.length > max) fail(`${name}() takes ${min === max ? min : `${min}–${max}`} argument${max === 1 ? '' : 's'}`);
};
const math1 = (name: string, f: (x: number) => number): Fn => (a) => (need(name, a, 1), f(num(a[0])));
const truthy = (v: FormulaValue): boolean => (typeof v === 'string' ? v !== '' && v.toLowerCase() !== 'false' && v !== '0' : !!v);

/** The functions a formula can call: the JavaScript Math ones plus the usual spreadsheet few. */
const FUNCS: Record<string, Fn> = {
  abs: math1('abs', Math.abs), sqrt: math1('sqrt', Math.sqrt), cbrt: math1('cbrt', Math.cbrt),
  exp: math1('exp', Math.exp), ln: math1('ln', Math.log), log: (a) => (need('log', a, 1, 2), a.length === 2 ? Math.log(num(a[0])) / Math.log(num(a[1])) : Math.log10(num(a[0]))),
  log10: math1('log10', Math.log10), log2: math1('log2', Math.log2),
  sin: math1('sin', Math.sin), cos: math1('cos', Math.cos), tan: math1('tan', Math.tan),
  asin: math1('asin', Math.asin), acos: math1('acos', Math.acos), atan: math1('atan', Math.atan),
  sinh: math1('sinh', Math.sinh), cosh: math1('cosh', Math.cosh), tanh: math1('tanh', Math.tanh),
  atan2: (a) => (need('atan2', a, 2), Math.atan2(num(a[0]), num(a[1]))),
  floor: math1('floor', Math.floor), ceil: math1('ceil', Math.ceil), trunc: math1('trunc', Math.trunc), sign: math1('sign', Math.sign),
  round: (a) => {
    need('round', a, 1, 2);
    const k = 10 ** (a.length === 2 ? num(a[1]) : 0);
    return Math.round((num(a[0]) + Number.EPSILON * Math.sign(num(a[0]))) * k) / k;
  },
  pow: (a) => (need('pow', a, 2), num(a[0]) ** num(a[1])),
  mod: (a) => (need('mod', a, 2), num(a[0]) % num(a[1])),
  hypot: (a) => Math.hypot(...nums(a)),
  min: (a) => Math.min(...nums(a)),
  max: (a) => Math.max(...nums(a)),
  sum: (a) => nums(a).reduce((s, x) => s + x, 0),
  count: (a) => nums(a).length,
  avg: (a) => (nums(a).length ? nums(a).reduce((s, x) => s + x, 0) / nums(a).length : fail('avg() of nothing')),
  median: (a) => {
    const v = nums(a).sort((x, y) => x - y);
    if (!v.length) return fail('median() of nothing');
    const h = v.length >> 1;
    return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
  },
  stdev: (a) => {
    const v = nums(a);
    if (v.length < 2) return fail('stdev() needs two numbers');
    const m = v.reduce((s, x) => s + x, 0) / v.length;
    return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
  },
  if: (a) => (need('if', a, 2, 3), truthy(a[0]) ? a[1] : a[2] ?? ''),
  and: (a) => a.every(truthy),
  or: (a) => a.some(truthy),
  not: (a) => (need('not', a, 1), !truthy(a[0])),
  concat: (a) => a.map(text).join(''),
  len: (a) => (need('len', a, 1), text(a[0]).length),
  upper: (a) => (need('upper', a, 1), text(a[0]).toUpperCase()),
  lower: (a) => (need('lower', a, 1), text(a[0]).toLowerCase()),
  pi: (a) => (need('pi', a, 0), Math.PI),
  e: (a) => (need('e', a, 0), Math.E),
  random: (a) => (need('random', a, 0), Math.random()),
};
FUNCS.average = FUNCS.mean = FUNCS.avg;
/** Function names the editor and the README list. */
export const FORMULA_FUNCTIONS: readonly string[] = Object.keys(FUNCS);

/** Constants written without parentheses: `=2*pi`. */
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

/** 12 significant digits, so `0.1+0.2` shows as `0.3`. */
export function fmt(n: number): string {
  return String(Number(n.toPrecision(12)));
}

export interface FormulaEnv {
  /** The value of another cell of the row (computed if it is a formula too); undefined when empty. */
  cell(key: string): string | undefined;
  /** Columns in table order, for `a:c` ranges. */
  order: readonly string[];
}

const cellValue = (env: FormulaEnv, key: string): FormulaValue => {
  const v = env.cell(key);
  if (v === undefined) return '';
  return isNumberText(v) ? Number(v) : v;
};

function run(node: Node, env: FormulaEnv): FormulaValue {
  switch (node.n) {
    case 'num': return node.v;
    case 'str': return node.v;
    case 'bool': return node.v;
    case 'ref': return cellValue(env, node.key);
    case 'range': return fail("A range such as a:c only works inside a function, e.g. sum(a:c)");
    case 'un': return node.op === '-' ? -num(run(node.a, env)) : num(run(node.a, env));
    case 'call': {
      if (!node.args.length && Object.hasOwn(CONSTS, node.f)) return CONSTS[node.f];
      const f = Object.hasOwn(FUNCS, node.f) ? FUNCS[node.f] : undefined;
      if (!f) return fail(`Unknown function or column '${node.f}'`);
      const args: FormulaValue[] = [];
      for (const a of node.args) {
        if (a.n === 'range') {
          const i = env.order.indexOf(a.from);
          const j = env.order.indexOf(a.to);
          if (i < 0 || j < 0) fail(`'${a.from}:${a.to}' is not in this table`);
          for (const k of env.order.slice(Math.min(i, j), Math.max(i, j) + 1)) args.push(cellValue(env, k));
        } else args.push(run(a, env));
      }
      return f(args);
    }
    case 'bin': {
      const a = run(node.a, env);
      const b = run(node.b, env);
      switch (node.op) {
        case '+': return num(a) + num(b);
        case '-': return num(a) - num(b);
        case '*': return num(a) * num(b);
        case '/': return num(b) === 0 ? fail('Division by zero') : num(a) / num(b);
        case '%': return num(b) === 0 ? fail('Division by zero') : num(a) % num(b);
        case '^': return num(a) ** num(b);
        case '&': return text(a) + text(b);
        default: {
          const both = typeof a === 'number' && typeof b === 'number';
          const [x, y] = both ? [a, b] : [text(a), text(b)];
          switch (node.op) {
            case '=': case '==': return x === y;
            case '!=': case '<>': return x !== y;
            case '<': return x < y;
            case '<=': return x <= y;
            case '>': return x > y;
            default: return x >= y;
          }
        }
      }
    }
  }
}

/** Evaluate `=…` text (with or without the `=`) against the cells of one row. */
export function evalFormula(src: string, env: FormulaEnv): FormulaResult {
  try {
    const body = src.replace(/^\s*=/, '');
    if (!body.trim()) return { ok: false, error: 'Empty formula' };
    const keys = [...env.order];
    const v = run(parse(tokenize(body, keys)), env);
    if (typeof v === 'number' && !isFinite(v)) return { ok: false, error: 'Not a finite number' };
    return { ok: true, value: v };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Whether a property value is a formula. */
export const isFormula = (v: string): boolean => /^\s*=/.test(v);

/** A formula's result as cell text (numbers to 12 digits, booleans as TRUE/FALSE). */
export const formulaText = (v: FormulaValue): string => (typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : text(v));

export interface ResolvedProps {
  /** Every property with formulas replaced by their results; a failed formula has no entry. */
  values: Record<string, string>;
  /** The formula text of each formula cell. */
  formulas: Record<string, string>;
  /** Why a formula failed. */
  errors: Record<string, string>;
}

/** Evaluate every formula among the properties of one block; cycles are reported, not looped on. */
export function resolveFormulas(props: Record<string, string>): ResolvedProps {
  const formulas: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) if (isFormula(v)) formulas[k] = v.trim();
  if (!Object.keys(formulas).length) return { values: props, formulas, errors: {} };
  const order = Object.keys(props);
  const done: Record<string, string | undefined> = {};
  const errors: Record<string, string> = {};
  const stack: string[] = [];
  const compute = (k: string): void => {
    if (k in done) return;
    if (stack.includes(k)) throw new CycleError(`Circular reference: ${[...stack.slice(stack.indexOf(k)), k].join(' → ')}`);
    stack.push(k);
    try {
      const r = evalFormula(formulas[k], { cell, order });
      if (r.ok) done[k] = formulaText(r.value);
      else {
        errors[k] = r.error;
        done[k] = undefined;
      }
    } catch (e) {
      // A cycle fails every cell on it: each one on the way out records it.
      if (e instanceof CycleError) {
        errors[k] = e.message;
        done[k] = undefined;
      }
      throw e;
    } finally {
      stack.pop();
    }
  };
  // How another formula sees a cell: its value, or a failure if that cell failed.
  const cell = (k: string): string | undefined => {
    if (!(k in formulas)) return props[k];
    compute(k);
    if (k in errors) throw new FormulaError(`'${k}' has an error: ${errors[k]}`);
    return done[k];
  };
  for (const k of Object.keys(formulas)) {
    try {
      compute(k);
    } catch (e) {
      if (!(e instanceof CycleError)) throw e;
    }
  }
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!(k in formulas)) values[k] = v;
    else if (done[k] !== undefined) values[k] = done[k]!;
  }
  return { values, formulas, errors };
}

/** What an arrow key does while a formula is being typed: it picks the neighbouring cell as a reference. */
export interface RefPick { start: number; end: number; key: string }

const REF_AFTER = '=(,+-*/%^&<>:';

/** Whether a reference may be inserted at `caret` (right after `=`, an operator, `(` or `,`). */
export function canPickAt(value: string, caret: number): boolean {
  if (!value.startsWith('=')) return false;
  const before = value.slice(0, caret).trimEnd();
  return before.length > 0 && REF_AFTER.includes(before[before.length - 1]);
}

/**
 * Arrow ←/→ in a formula: insert the cell next to `own` (the cell being edited), or, if the last
 * thing inserted was such a pick and the caret is still at its end, step it on by one more column.
 * `cols` is the table's visible columns in order. null when the key is not a pick (move the caret).
 */
export function stepPick(
  value: string, caret: number, pick: RefPick | null, cols: readonly string[], own: string, dir: 1 | -1,
): { value: string; caret: number; pick: RefPick } | null {
  const live = pick && caret === pick.end && value.slice(pick.start, pick.end) === pick.key ? pick : null;
  if (!live && !canPickAt(value, caret)) return null;
  const from = live ? cols.indexOf(live.key) : cols.indexOf(own);
  let i = from;
  do i += dir;
  while (cols[i] === own);
  if (i < 0 || i >= cols.length) return live ? { value, caret, pick: live } : null;
  const key = cols[i];
  const start = live ? live.start : caret;
  const end = live ? live.end : caret;
  const next = value.slice(0, start) + key + value.slice(end);
  return { value: next, caret: start + key.length, pick: { start, end: start + key.length, key } };
}

/** A cell clicked while a formula is being typed: insert (or replace the last pick with) its name. */
export function insertPick(value: string, caret: number, pick: RefPick | null, key: string): { value: string; caret: number; pick: RefPick } | null {
  const live = pick && caret === pick.end && value.slice(pick.start, pick.end) === pick.key ? pick : null;
  if (!live && !canPickAt(value, caret)) return null;
  const start = live ? live.start : caret;
  const end = live ? live.end : caret;
  return { value: value.slice(0, start) + key + value.slice(end), caret: start + key.length, pick: { start, end: start + key.length, key } };
}
