import { describe, expect, it } from 'vitest';
import { cardsToWhere, newCard, whereToCards } from '../../src/core/cards';
import { parseDsl, type Cond } from '../../src/core/dsl';

const where = (t: string): Cond[] => {
  const r = parseDsl('where ' + t);
  if (!r.ok) throw new Error(r.error.message);
  return r.query.where;
};

describe('whereToCards', () => {
  it('groups conditions into one card per key', () => {
    expect(whereToCards(where('gre >= 0.5 and combine in (none, mean) and gre < 1 and patch has 8 and patch has 16 and seed = 1'))).toEqual([
      { kind: 'range', key: 'gre', min: { op: '>=', value: '0.5' }, max: { op: '<', value: '1' } },
      { kind: 'values', key: 'combine', values: ['none', 'mean'] },
      { kind: 'has', key: 'patch', values: ['8', '16'] },
      { kind: 'values', key: 'seed', values: ['1'] },
    ]);
  });
  it('keeps what the GUI cannot express as raw cards', () => {
    expect(whereToCards(where('seed != 1 and gre < 1 and gre < 2 and combine = a and combine = b'))).toEqual([
      { kind: 'raw', key: 'seed', cond: { kind: 'cmp', key: 'seed', op: '!=', value: '1' } },
      { kind: 'range', key: 'gre', max: { op: '<', value: '1' } },
      { kind: 'raw', key: 'gre', cond: { kind: 'cmp', key: 'gre', op: '<', value: '2' } },
      { kind: 'values', key: 'combine', values: ['a'] },
      { kind: 'raw', key: 'combine', cond: { kind: 'cmp', key: 'combine', op: '=', value: 'b' } },
    ]);
  });
});

describe('cardsToWhere', () => {
  it('round-trips grouped conditions', () => {
    const w = where('gre >= 0.5 and gre < 1 and combine in (none, mean) and patch has 8 and patch has 16 and seed = 1 and seed != 2');
    expect(cardsToWhere(whereToCards(w))).toEqual(w);
  });
  it('drops empty cards', () => {
    expect(cardsToWhere([newCard('gre', 'ratio'), newCard('combine', 'string'), newCard('patch', 'numlist')])).toEqual([]);
  });
});

describe('newCard', () => {
  it('picks the card by type', () => {
    expect(newCard('gre', 'ratio').kind).toBe('range');
    expect(newCard('patch', 'numlist').kind).toBe('has');
    expect(newCard('seed', 'category').kind).toBe('values');
  });
});
