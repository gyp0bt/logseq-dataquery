import type { Plot, Query } from '../core/dsl';
import type { QueryResult } from '../core/query';
import { isNumericType } from '../core/types';

export function PlotControls({ query, result, onChange }: { query: Query; result?: QueryResult; onChange(q: Query): void }) {
  const types = result?.types ?? {};
  const keys = [...new Set((result?.scoped ?? []).flatMap((r) => Object.keys(r.values)))];
  const numeric = keys.filter((k) => isNumericType(types[k] ?? 'string'));
  const discrete = keys.filter((k) => !isNumericType(types[k] ?? 'string'));
  const plot = query.plot;
  const set = (p: Plot | undefined) => onChange({ ...query, plot: p });
  const kind = plot?.kind ?? 'none';
  const pick = (value: string, options: string[], label: string, onPick: (v: string) => void, allowNone = false) => (
    <label className="dqp-field">
      {label}
      <select aria-label={label} value={value} onChange={(e) => onPick(e.target.value)}>
        {allowNone && <option value="">(none)</option>}
        {!allowNone && !options.includes(value) && <option value={value}>{value}</option>}
        {options.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
    </label>
  );
  const first = (list: string[], i = 0) => list[i] ?? list[0] ?? keys[0] ?? 'x';
  return (
    <div className="dqp-pctl">
      <span className="dqp-seg" role="group" aria-label="Chart">
        <button type="button" aria-pressed={kind === 'scatter'} onClick={() => set({ kind: 'scatter', x: first(numeric), y: first(numeric, 1), labels: false })}>Scatter</button>
        <button type="button" aria-pressed={kind === 'bar'} onClick={() => set({ kind: 'bar', x: first(discrete), ys: [first(numeric)] })}>Bar</button>
        <button type="button" aria-pressed={kind === 'none'} onClick={() => set(undefined)}>Table only</button>
      </span>
      {plot?.kind === 'scatter' && (
        <>
          {pick(plot.x, numeric, 'x', (x) => set({ ...plot, x }))}
          {pick(plot.y, numeric, 'y', (y) => set({ ...plot, y }))}
          {pick(plot.color ?? '', discrete, 'Colour', (c) => set({ ...plot, color: c || undefined }), true)}
          <label className="dqp-chk">
            <input type="checkbox" checked={plot.labels} onChange={(e) => set({ ...plot, labels: e.target.checked })} />
            Labels
          </label>
        </>
      )}
      {plot?.kind === 'bar' && (
        <>
          {pick(plot.x, discrete, 'x', (x) => set({ ...plot, x }))}
          <span className="dqp-checks" role="group" aria-label="y">
            {numeric.map((k) => (
              <label key={k} className="dqp-chk">
                <input
                  type="checkbox"
                  checked={plot.ys.includes(k)}
                  onChange={() => {
                    const ys = plot.ys.includes(k) ? plot.ys.filter((y) => y !== k) : [...plot.ys, k];
                    if (ys.length) set({ ...plot, ys });
                  }}
                />
                {k}
              </label>
            ))}
          </span>
        </>
      )}
    </div>
  );
}
