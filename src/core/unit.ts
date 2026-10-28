/** The unit a property key carries after `--`, `-` (dimensionless) when it has none. */
export const NO_UNIT = '-';

/** Logseq lower-cases and rewrites property keys, so a unit's capitals are put back for display. */
const UNIT_CASE: Record<string, string> = Object.fromEntries(
  ['W', 'kW', 'MW', 'V', 'mV', 'kV', 'A', 'mA', 'K', 'N', 'kN', 'Pa', 'kPa', 'MPa', 'GPa', 'Hz', 'kHz', 'MHz', 'J', 'kJ', 'MJ', 'Wh', 'kWh', 'C', 'F', 'H', 'S', 'T', 'L', 'mL', 'Ohm', 'kOhm', 'dB', 'rpm', 'deg', 'rad'].map((u) => [u.toLowerCase(), u]),
);

/** `power--w` → name `power`, unit `W`. The first `--` with text on both sides splits the key. */
export function splitUnit(key: string): { name: string; unit: string } {
  const m = /^(.+?)--(.+)$/.exec(key);
  if (!m) return { name: key, unit: NO_UNIT };
  return { name: m[1], unit: UNIT_CASE[m[2].toLowerCase()] ?? m[2] };
}
