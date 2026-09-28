import type { Query } from '../core/dsl';
import type { QueryResult } from '../core/query';
import { ChartView } from './ChartView';
import { DataTable } from './DataTable';
import type { PanelDeps } from './mount';
import { PlotControls } from './PlotControls';

export function Stage({ query, result, deps, onChange }: { query: Query; result?: QueryResult; deps: PanelDeps; onChange(q: Query): void }) {
  const jump = (uuid: string) => void deps.jump(uuid).catch(deps.report);
  return (
    <section className="dqp-stage">
      <PlotControls query={query} result={result} onChange={onChange} />
      {result && query.plot && <ChartView query={query} result={result} onJump={jump} />}
      {result && <DataTable query={query} result={result} deps={deps} onJump={jump} onChange={onChange} />}
      {result?.warnings.map((w) => <p key={w} className="dqp-msg">{w}</p>)}
    </section>
  );
}
