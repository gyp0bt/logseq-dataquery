import type { Query } from '../core/dsl';
import type { QueryResult } from '../core/query';
import { rowLabel } from '../core/rows';
import { isNumericType, VALUE_TYPES, type ValueType } from '../core/types';
import { cellClass } from '../core/view';
import type { PanelDeps } from './mount';

interface Props { query: Query; result: QueryResult; deps: PanelDeps; onJump(uuid: string): void; onChange(q: Query): void }

export function DataTable({ query, result, deps, onJump, onChange }: Props) {
  const sorted = query.sort[0];
  const cycle = (key: string) => {
    if (sorted?.key !== key) onChange({ ...query, sort: [{ key, desc: false }] });
    else if (!sorted.desc) onChange({ ...query, sort: [{ key, desc: true }] });
    else onChange({ ...query, sort: [] });
  };
  const right = (t: ValueType) => isNumericType(t) || t === 'numlist';
  if (!result.rows.length) return <p className="dqp-msg">No rows match.</p>;
  return (
    <div className="dq dqp-tbl">
      <table>
        <thead>
          <tr>
            <th>{query.mergeBy ?? 'block'}</th>
            {result.cols.map((k) => {
              const t = result.types[k] ?? 'string';
              return (
                <th key={k} className={right(t) ? 'dq-num' : ''}>
                  <button type="button" className="dqp-sort" onClick={() => cycle(k)}>
                    {k}{sorted?.key === k ? (sorted.desc ? ' ▼' : ' ▲') : ''}
                  </button>
                  <select
                    aria-label={`${k} type`}
                    className="dqp-type"
                    value={t}
                    onChange={(e) => void deps.setType(k, e.target.value as ValueType).catch(deps.report)}
                  >
                    {VALUE_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => (
            <tr key={r.id}>
              <td>
                <button type="button" className="dqp-link" onClick={() => onJump(r.sources[0].uuid)}>
                  {rowLabel(r, query.mergeBy)}
                </button>
              </td>
              {result.cols.map((k) => {
                const t = result.types[k] ?? 'string';
                const cls = [right(t) ? 'dq-num' : '', cellClass(t, r.values[k]), r.conflicts[k] ? 'dq-conflict' : ''].filter(Boolean).join(' ');
                return (
                  <td key={k} className={cls} title={r.conflicts[k]?.map((c) => `${c.value} (${c.pageTitle})`).join(' / ')}>
                    {r.values[k] ?? ''}
                    {r.conflicts[k] && <sup>⚠</sup>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
