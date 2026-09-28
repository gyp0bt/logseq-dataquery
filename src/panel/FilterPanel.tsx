import { useState } from 'react';
import { cardsToWhere, newCard, whereToCards, type Card } from '../core/cards';
import { printCond, type Cond, type Query } from '../core/dsl';
import type { QueryResult } from '../core/query';
import type { Row } from '../core/rows';
import { compareValues, isNumberText, toList, toNumber, valuesEqual, type ValueType } from '../core/types';

interface Props { query: Query; result?: QueryResult; onChange(where: Cond[]): void }

export function FilterPanel({ query, result, onChange }: Props) {
  const types = result?.types ?? {};
  const scoped = result?.scoped ?? [];
  // Newly added cards emit no condition until the user picks something, so they live here meanwhile.
  const [extra, setExtra] = useState<Card[]>([]);
  const fromWhere = whereToCards(query.where);
  const cards = [...fromWhere, ...extra.filter((e) => !fromWhere.some((c) => c.key === e.key))];
  const commit = (next: Card[]) => {
    onChange(cardsToWhere(next));
    setExtra(next.filter((c) => cardsToWhere([c]).length === 0));
  };
  const used = new Set(cards.map((c) => c.key));
  const keys = [...new Set(scoped.flatMap((r) => Object.keys(r.values)))].filter((k) => !used.has(k));
  return (
    <aside className="dqp-side" aria-label="Filters">
      <p className="dqp-count">{result?.rows.length ?? 0} of {scoped.length} rows</p>
      {cards.map((c, i) => (
        <CardView
          key={c.kind === 'range' ? `${c.key}-${i}-${c.min?.value}-${c.max?.value}` : `${c.kind}-${c.key}-${i}`}
          card={c}
          type={types[c.key] ?? 'string'}
          scoped={scoped}
          rows={result?.rows ?? []}
          onChange={(n) => commit(cards.map((x, j) => (j === i ? n : x)))}
          onRemove={() => commit(cards.filter((_, j) => j !== i))}
        />
      ))}
      <select
        aria-label="Add condition"
        className="dqp-add"
        value=""
        onChange={(e) => e.target.value && setExtra([...extra, newCard(e.target.value, types[e.target.value] ?? 'string')])}
      >
        <option value="">+ Add condition…</option>
        {keys.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
    </aside>
  );
}

function CardView(props: { card: Card; type: ValueType; scoped: Row[]; rows: Row[]; onChange(c: Card): void; onRemove(): void }) {
  const { card, type, scoped } = props;
  return (
    <div className="dqp-card">
      <div className="dqp-card-h">
        <span className="dqp-key">{card.key}</span>
        <span className="dqp-badge">{type}</span>
        <button type="button" className="dqp-x" aria-label={`Remove ${card.key} condition`} onClick={props.onRemove}>×</button>
      </div>
      {card.kind === 'range' && <RangeBody card={card} type={type} scoped={scoped} rows={props.rows} onChange={props.onChange} />}
      {card.kind === 'values' && <ValuesBody card={card} type={type} scoped={scoped} onChange={props.onChange} />}
      {card.kind === 'has' && <HasBody card={card} scoped={scoped} onChange={props.onChange} />}
      {card.kind === 'raw' && (
        <p className="dqp-raw"><code>{printCond(card.cond)}</code><br />Edit this condition in the query text.</p>
      )}
    </div>
  );
}

type RangeCard = Extract<Card, { kind: 'range' }>;

function RangeBody({ card, type, scoped, rows, onChange }: { card: RangeCard; type: ValueType; scoped: Row[]; rows: Row[]; onChange(c: Card): void }) {
  const vals = scoped.map((r) => ({ id: r.id, v: toNumber(r.values[card.key]) })).filter((x) => !isNaN(x.v));
  const lo = Math.min(...vals.map((x) => x.v), type === 'ratio' ? 1 : Infinity);
  const hi = Math.max(...vals.map((x) => x.v), type === 'ratio' ? 1 : -Infinity);
  const pos = (v: number) => `${(((v - lo) / (hi - lo || 1)) * 96 + 2).toFixed(1)}%`;
  const on = new Set(rows.map((r) => r.id));
  const edit = (side: 'min' | 'max', text: string) => {
    const t = text.trim();
    if (t && !isNumberText(t)) return;
    if (t === (card[side]?.value ?? '')) return;
    const next: RangeCard = { ...card };
    if (!t) delete next[side];
    else if (side === 'min') next.min = { op: card.min?.op ?? '>=', value: t };
    else next.max = { op: card.max?.op ?? '<', value: t };
    onChange(next);
  };
  const input = (side: 'min' | 'max', placeholder: number) => (
    <input
      aria-label={`${card.key} ${side === 'min' ? 'minimum' : 'maximum'}`}
      inputMode="decimal"
      defaultValue={card[side]?.value ?? ''}
      placeholder={isFinite(placeholder) ? String(placeholder) : ''}
      onBlur={(e) => edit(side, e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && edit(side, e.currentTarget.value)}
    />
  );
  return (
    <>
      {vals.length > 0 && (
        <div className="dqp-strip" aria-hidden="true">
          {type === 'ratio' && <span className="dqp-ref" style={{ left: pos(1) }} />}
          {vals.map((x) => <i key={x.id} className={on.has(x.id) ? 'dqp-on' : ''} style={{ left: pos(x.v) }} />)}
        </div>
      )}
      <div className="dqp-range">
        {input('min', lo)}
        <span>{card.min?.op === '>' ? '<' : '≤'} {card.key} {card.max?.op === '<=' ? '≤' : '<'}</span>
        {input('max', hi)}
      </div>
    </>
  );
}

function ValuesBody({ card, type, scoped, onChange }: { card: Extract<Card, { kind: 'values' }>; type: ValueType; scoped: Row[]; onChange(c: Card): void }) {
  const counts = new Map<string, number>();
  for (const r of scoped) {
    const v = r.values[card.key];
    if (v !== undefined) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const domain = [...counts.keys()].sort((a, b) => compareValues(type, a, b));
  const selected = (v: string) => card.values.some((x) => valuesEqual(type, v, x));
  const checked = (v: string) => card.values.length === 0 || selected(v);
  // Chosen values absent from this scope stay in the condition rather than vanishing on the next click.
  const outside = card.values.filter((x) => !domain.some((d) => valuesEqual(type, d, x)));
  const toggle = (v: string) => {
    const now = domain.filter(checked);
    const next = now.includes(v) ? now.filter((x) => x !== v) : [...now, v];
    if (next.length === 0 && outside.length === 0) return;
    const all = next.length === domain.length && outside.length === 0;
    onChange({ ...card, values: all ? [] : [...outside, ...domain.filter((x) => next.includes(x))] });
  };
  return (
    <div className="dqp-checks">
      {domain.map((v) => (
        <label key={v} className="dqp-chk">
          <input type="checkbox" checked={checked(v)} onChange={() => toggle(v)} />
          {v}
          <span className="dqp-n">{counts.get(v)}</span>
        </label>
      ))}
    </div>
  );
}

function HasBody({ card, scoped, onChange }: { card: Extract<Card, { kind: 'has' }>; scoped: Row[]; onChange(c: Card): void }) {
  const elems = [...new Set(scoped.flatMap((r) => toList(r.values[card.key]) ?? []))].sort((a, b) => a - b).map(String);
  const has = (v: string) => card.values.some((x) => Number(x) === Number(v));
  const toggle = (v: string) =>
    onChange({ ...card, values: has(v) ? card.values.filter((x) => Number(x) !== Number(v)) : [...card.values, v] });
  return (
    <>
      <p className="dqp-hint">Contains all of</p>
      <div className="dqp-checks">
        {elems.map((v) => (
          <label key={v} className="dqp-chk">
            <input type="checkbox" checked={has(v)} onChange={() => toggle(v)} />
            {v}
          </label>
        ))}
      </div>
    </>
  );
}
