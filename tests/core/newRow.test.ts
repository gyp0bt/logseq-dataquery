import { describe, expect, it } from 'vitest';
import { parseQuery } from '../../src/core/dsl';
import { newRowFor } from '../../src/core/newRow';

const q = (dsl: string) => {
  const p = parseQuery(dsl);
  if (!p.ok) throw new Error('bad test query');
  return p.query;
};

describe('newRowFor', () => {
  it('references the pages of #tag and [[page]] terms through tags::', () => {
    expect(newRowFor(q('#run [[Plan]]')).content).toBe('tags:: [[run]], [[plan]]');
  });
  it('fills in key==value filters so the new row matches the query', () => {
    const n = newRowFor(q('#run kind==a'));
    expect(n.content).toBe('tags:: [[run]]\nkind:: a');
    expect(n.values).toEqual({ kind: 'a' });
  });
  it('is empty for a query with nothing to copy', () => {
    expect(newRowFor(q('')).content).toBe('');
  });
});
