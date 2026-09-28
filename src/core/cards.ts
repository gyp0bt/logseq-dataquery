import type { Cond } from './dsl';
import { isNumericType, type ValueType } from './types';

/** One filter card in the panel; `values: []` means no restriction yet. */
export type Card =
  | { kind: 'range'; key: string; min?: { op: '>' | '>='; value: string }; max?: { op: '<' | '<='; value: string } }
  | { kind: 'values'; key: string; values: string[] }
  | { kind: 'has'; key: string; values: string[] }
  | { kind: 'raw'; key: string; cond: Cond };

export function newCard(key: string, t: ValueType): Card {
  if (isNumericType(t)) return { kind: 'range', key };
  if (t === 'numlist') return { kind: 'has', key, values: [] };
  return { kind: 'values', key, values: [] };
}

/** Group AND-ed conditions into GUI cards; anything the GUI cannot show stays a raw card. */
export function whereToCards(where: Cond[]): Card[] {
  const cards: Card[] = [];
  const find = <K extends Card['kind']>(kind: K, key: string) =>
    cards.find((c): c is Extract<Card, { kind: K }> => c.kind === kind && c.key === key);
  for (const c of where) {
    const raw = () => cards.push({ kind: 'raw', key: c.key, cond: c });
    if (c.kind === 'has') {
      const card = find('has', c.key);
      if (card) card.values.push(c.value);
      else cards.push({ kind: 'has', key: c.key, values: [c.value] });
    } else if (c.kind === 'in' || c.op === '=') {
      if (find('values', c.key)) raw();
      else cards.push({ kind: 'values', key: c.key, values: c.kind === 'in' ? [...c.values] : [c.value] });
    } else if (c.op === '!=') {
      raw();
    } else {
      const side = c.op[0] === '<' ? 'max' : 'min';
      let card = find('range', c.key);
      if (card?.[side]) raw();
      else {
        if (!card) {
          card = { kind: 'range', key: c.key };
          cards.push(card);
        }
        if (side === 'max') card.max = { op: c.op as '<' | '<=', value: c.value };
        else card.min = { op: c.op as '>' | '>=', value: c.value };
      }
    }
  }
  return cards;
}

export function cardsToWhere(cards: Card[]): Cond[] {
  const out: Cond[] = [];
  for (const c of cards) {
    if (c.kind === 'range') {
      if (c.min) out.push({ kind: 'cmp', key: c.key, op: c.min.op, value: c.min.value });
      if (c.max) out.push({ kind: 'cmp', key: c.key, op: c.max.op, value: c.max.value });
    } else if (c.kind === 'values') {
      if (c.values.length === 1) out.push({ kind: 'cmp', key: c.key, op: '=', value: c.values[0] });
      else if (c.values.length > 1) out.push({ kind: 'in', key: c.key, values: [...c.values] });
    } else if (c.kind === 'has') {
      for (const v of c.values) out.push({ kind: 'has', key: c.key, value: v });
    } else out.push(c.cond);
  }
  return out;
}
