export type ValueType = 'number' | 'numlist' | 'string' | 'category' | 'ratio';
export const VALUE_TYPES: readonly ValueType[] = ['number', 'numlist', 'string', 'category', 'ratio'];

const NUM = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export const isNumberText = (s: string): boolean => NUM.test(s.trim());
const LIST_SEP = /[/,]/;
/** Two or more numbers separated by `/` or `,` (`8/16`, `1.27, 1.31`): several values in one cell. */
export const isNumListText = (s: string): boolean => {
  const parts = s.split(LIST_SEP);
  return parts.length >= 2 && parts.every(isNumberText);
};
export const isNumericType = (t: ValueType): boolean => t === 'number' || t === 'ratio';

export function toNumber(s: string | undefined): number {
  return s !== undefined && isNumberText(s) ? Number(s) : NaN;
}

export function toList(s: string | undefined): number[] | null {
  if (s === undefined) return null;
  if (isNumberText(s)) return [Number(s)];
  if (isNumListText(s)) return s.split(LIST_SEP).map(Number);
  return null;
}

export interface CellStats { mean: number; min: number; max: number; n: number }

/** Mean, min, max and count of the numbers in one cell; a plain number has n = 1. */
export function cellStats(s: string | undefined): CellStats | null {
  const l = toList(s);
  if (!l) return null;
  return { mean: l.reduce((a, b) => a + b, 0) / l.length, min: Math.min(...l), max: Math.max(...l), n: l.length };
}

/** A cell's position on a numeric axis: the mean of its values. */
export const cellMean = (s: string | undefined): number => cellStats(s)?.mean ?? NaN;

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
  if (t !== 'string') {
    // Cells holding several numbers sort by their mean, as they are plotted.
    const x = cellMean(a);
    const y = cellMean(b);
    if (!isNaN(x) && !isNaN(y)) return cmp(x, y);
    if (!isNaN(x) || !isNaN(y)) return isNaN(x) ? 1 : -1;
  }
  return cmp(a, b);
}

/** Equality as the user means it: `0.20` equals `0.2` for numeric types; a list equals a number it contains. */
export function valuesEqual(t: ValueType, a: string | undefined, b: string): boolean {
  if (a === undefined) return false;
  if (t !== 'string') {
    const x = toList(a);
    const y = toList(b);
    // `patch==16` on `8/16` means "contains 16".
    if (x && y && x.length > 1 && y.length === 1) return x.includes(y[0]);
    if (x && y) return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  return a === b;
}
