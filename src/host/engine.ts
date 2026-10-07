import { parseQuery, type Kind, type ParseResult } from '../core/dsl';
import { computeTypes, runQuery, type QueryResult } from '../core/query';
import type { SourceBlock } from '../core/rows';
import type { TypeOverrides, ValueType } from '../core/types';
import type { LogseqLike } from './api';
import { fetchBlocks, fetchOrder, fetchTypeOverrides } from './collect';

export interface Evaluation {
  parsed: ParseResult;
  result?: QueryResult;
}

interface Snapshot { blocks: SourceBlock[]; overrides: TypeOverrides; types: Record<string, ValueType> }

/** Reads the graph once per change and answers queries for any macro. */
export class Engine {
  private snapshot: Promise<Snapshot> | null = null;

  constructor(private api: LogseqLike, private typesPage: () => string) {}

  invalidate(): void {
    this.snapshot = null;
  }

  private load(): Promise<Snapshot> {
    if (!this.snapshot) {
      const p = (async () => {
        const tp = this.typesPage().toLowerCase();
        const blocks = (await fetchBlocks(this.api)).filter((b) => b.page !== tp);
        const overrides = await fetchTypeOverrides(this.api, tp);
        return { blocks, overrides, types: computeTypes(blocks, overrides) };
      })();
      // A failed read must not stick in the cache; the caller still sees the rejection.
      p.catch(() => {
        if (this.snapshot === p) this.snapshot = null;
      });
      this.snapshot = p;
    }
    return this.snapshot;
  }

  async evaluate(dsl: string, kind: Kind, macroUuid: string): Promise<Evaluation> {
    const parsed = parseQuery(dsl);
    if (!parsed.ok) return { parsed };
    const { blocks, overrides, types } = await this.load();
    const order = await fetchOrder(this.api, macroUuid);
    const result = runQuery(parsed.query, kind, { blocks, types, macroUuid, order });
    result.warnings.unshift(...overrides.warnings);
    return { parsed, result };
  }
}
