import { barSvg, legendHtml, scatterSvg } from '../core/chart';
import type { Query } from '../core/dsl';
import type { QueryResult } from '../core/query';

/** Same SVG as the inline view; clicks are caught by delegation on `[data-uuid]`. */
export function ChartView({ query, result, onJump }: { query: Query; result: QueryResult; onJump(uuid: string): void }) {
  const p = query.plot!;
  const c = p.kind === 'scatter' ? scatterSvg(result.rows, p, result.types, query.mergeBy) : barSvg(result.rows, p, result.types);
  return (
    <div
      className="dq dqp-chart"
      onClick={(e) => {
        const el = (e.target as Element).closest('[data-uuid]');
        if (el) onJump(el.getAttribute('data-uuid')!);
      }}
      // Safe: chart.ts escapes every value it interpolates.
      dangerouslySetInnerHTML={{ __html: c.html + legendHtml(c.legend) }}
    />
  );
}
