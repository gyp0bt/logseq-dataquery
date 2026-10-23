/** The unit a property key carries in brackets, `-` (dimensionless) when it has none. */
export const NO_UNIT = '-';

/** `a[W]` → name `a`, unit `W`. Only a trailing, non-empty, single `[…]` counts as a unit. */
export function splitUnit(key: string): { name: string; unit: string } {
  const m = /^(.+?)\[([^[\]]+)\]$/.exec(key);
  return m ? { name: m[1], unit: m[2].trim() || NO_UNIT } : { name: key, unit: NO_UNIT };
}

/** Property keys are lower case, but a unit is case-sensitive (`W` is not `w`, `MPa` is not `mpa`). */
export function normKey(key: string): string {
  const m = /^(.+?)(\[[^[\]]+\])$/.exec(key);
  return m ? m[1].toLowerCase() + m[2] : key.toLowerCase();
}
