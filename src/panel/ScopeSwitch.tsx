import { useState } from 'react';
import type { Scope } from '../core/dsl';

export function ScopeSwitch({ scope, onChange }: { scope: Scope; onChange(s: Scope): void }) {
  const [page, setPage] = useState(scope.kind === 'ref' ? scope.page : '');
  const commit = () => {
    const name = page.replace(/^\[\[|\]\]$/g, '').trim();
    if (name) onChange({ kind: 'ref', page: name });
  };
  return (
    <span className="dqp-seg" role="group" aria-label="Scope">
      <button type="button" aria-pressed={scope.kind === 'here'} onClick={() => onChange({ kind: 'here' })}>Here</button>
      <button type="button" aria-pressed={scope.kind === 'page'} onClick={() => onChange({ kind: 'page' })}>Page</button>
      <input
        aria-label="Linked page"
        className={scope.kind === 'ref' ? 'dqp-on' : ''}
        placeholder="[[linked page]]"
        value={page}
        onChange={(e) => setPage(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </span>
  );
}
