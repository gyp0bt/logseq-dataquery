export type ValueType = 'number' | 'numlist' | 'string' | 'category' | 'ratio';
export const VALUE_TYPES: readonly ValueType[] = ['number', 'numlist', 'string', 'category', 'ratio'];

const NUM = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export const isNumberText = (s: string): boolean => NUM.test(s.trim());
export const isNumListText = (s: string): boolean => s.includes('/') && s.split('/').every(isNumberText);
export const isNumericType = (t: ValueType): boolean => t === 'number' || t === 'ratio';

export function toNumber(s: string | undefined): number {
  return s !== undefined && isNumberText(s) ? Number(s) : NaN;
}

export function toList(s: string | undefined): number[] | null {
  if (s === undefined) return null;
  if (isNumberText(s)) return [Number(s)];
  if (isNumListText(s)) return s.split('/').map(Number);
  return null;
}

export function inferType(values: string[]): ValueType {
  if (values.length === 0) return 'string';
  if (values.every(isNumberText)) return 'number';
  if (values.every((v) => isNumberText(v) || isNumListText(v))) return 'numlist';
  return 'string';
}

export interface TypeOverrides {
  exact: Record<string, ValueType>;
  patterns: Array<{ pattern: string; re: RegExp; type: ValueType }>;
  warnings: string[];
}

export const emptyOverrides = (): TypeOverrides => ({ exact: {}, patterns: [], warnings: [] });

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const globToRegExp = (p: string): RegExp => new RegExp('^' + p.split('*').map(escapeRe).join('.*') + '$');

/** Build overrides from the types page properties (`key:: type`, `prefix-*:: type`). */
export function parseTypeOverrides(props: Record<string, string>): TypeOverrides {
  const out = emptyOverrides();
  for (const [key, raw] of Object.entries(props)) {
    const t = raw.trim().toLowerCase() as ValueType;
    if (!VALUE_TYPES.includes(t)) {
      out.warnings.push(`Unknown type '${raw}' for '${key}' on the types page. Use one of: ${VALUE_TYPES.join(', ')}.`);
      continue;
    }
    if (key.includes('*')) out.patterns.push({ pattern: key, re: globToRegExp(key), type: t });
    else out.exact[key] = t;
  }
  out.patterns.sort((a, b) => b.pattern.length - a.pattern.length);
  return out;
}

export function resolveType(key: string, inferred: ValueType, ov: TypeOverrides): ValueType {
  if (key in ov.exact) return ov.exact[key];
  return ov.patterns.find((p) => p.re.test(key))?.type ?? inferred;
}

const cmp = <T extends number | string>(a: T, b: T): number => (a < b ? -1 : a > b ? 1 : 0);

/** Order two property texts by type; a missing value always sorts after a present one. */
export function compareValues(t: ValueType, a: string | undefined, b: string | undefined): number {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
  if (t === 'numlist') {
    const x = toList(a);
    const y = toList(b);
    if (x && y) {
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const c = cmp(x[i], y[i]);
        if (c) return c;
      }
      return cmp(x.length, y.length);
    }
    if (x || y) return x ? -1 : 1;
    return cmp(a, b);
  }
  if (t !== 'string') {
    const x = toNumber(a);
    const y = toNumber(b);
    if (!isNaN(x) && !isNaN(y)) return cmp(x, y);
    if (!isNaN(x) || !isNaN(y)) return isNaN(x) ? 1 : -1;
  }
  return cmp(a, b);
}

/** Equality as the user means it: `0.20` equals `0.2` for numeric types. */
export function valuesEqual(t: ValueType, a: string | undefined, b: string): boolean {
  if (a === undefined) return false;
  if (t === 'numlist') {
    const x = toList(a);
    const y = toList(b);
    if (x && y) return x.length === y.length && x.every((v, i) => v === y[i]);
    return a === b;
  }
  if (t !== 'string') {
    const x = toNumber(a);
    const y = toNumber(b);
    if (!isNaN(x) && !isNaN(y)) return x === y;
  }
  return a === b;
}
