import { useEffect, useState } from 'react';
import { emptyQuery, parseDsl, printDsl, type DslError, type Query } from '../core/dsl';
import type { Evaluation } from '../host/engine';
import { DslBar } from './DslBar';
import { FilterPanel } from './FilterPanel';
import type { PanelDeps, Session } from './mount';
import { ScopeSwitch } from './ScopeSwitch';
import { Stage } from './Stage';

function initial(dsl: string): { query: Query; error: DslError | null } {
  const p = parseDsl(dsl);
  return p.ok ? { query: p.query, error: null } : { query: emptyQuery(), error: p.error };
}

/** The query AST is the single source of truth; GUI edits and typed text both write it. */
export function App({ session, deps, tick }: { session: Session; deps: PanelDeps; tick: number }) {
  const [query, setQuery] = useState(() => initial(session.dsl).query);
  const [text, setText] = useState(session.dsl);
  const [error, setError] = useState<DslError | null>(() => initial(session.dsl).error);
  const [ev, setEv] = useState<Evaluation | null>(null);
  const [macro, setMacro] = useState(session.macro);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let live = true;
    deps.evaluate(printDsl(query), session.uuid).then(
      (r) => live && setEv(r),
      (e) => live && deps.report(e),
    );
    return () => {
      live = false;
    };
  }, [query, tick]);

  const update = (q: Query) => {
    setQuery(q);
    setText(printDsl(q));
    setError(null);
    setStatus('');
  };
  const apply = () => {
    const p = parseDsl(text);
    if (p.ok) {
      setQuery(p.query);
      setError(null);
      setStatus('Applied.');
    } else setError(p.error);
  };
  const save = async () => {
    try {
      setMacro(await deps.save(session.uuid, macro, printDsl(query)));
      setStatus('Saved to page.');
    } catch (e) {
      deps.report(e);
    }
  };
  const revert = () => {
    const i = initial(session.dsl);
    setQuery(i.query);
    setText(session.dsl);
    setError(i.error);
    setStatus('Reverted to the query on the page.');
  };

  const result = ev?.result;
  return (
    <div className="dqp-backdrop" onClick={(e) => e.target === e.currentTarget && deps.close()}>
      <div className="dqp" role="dialog" aria-label="Data query">
        <header className="dqp-top">
          <div className="dqp-row">
            <strong className="dqp-brand">Data query</strong>
            <ScopeSwitch scope={query.scope} onChange={(scope) => update({ ...query, scope })} />
            <span className="dqp-spacer" />
            <button type="button" className="dqp-btn" onClick={revert}>Revert</button>
            <button type="button" className="dqp-btn dqp-primary" onClick={save}>Save to page</button>
            <button type="button" className="dqp-btn" aria-label="Close" onClick={deps.close}>✕</button>
          </div>
          <DslBar text={text} error={error} status={status} onText={setText} onApply={apply} />
        </header>
        <main className="dqp-main">
          <FilterPanel query={query} result={result} onChange={(where) => update({ ...query, where })} />
          <Stage query={query} result={result} deps={deps} onChange={update} />
        </main>
      </div>
    </div>
  );
}
