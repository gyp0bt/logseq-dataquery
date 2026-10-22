import { describe, expect, it } from 'vitest';
import { canPickAt, evalFormula, insertPick, resolveFormulas, stepPick } from '../../src/core/formula';

const ev = (src: string, cells: Record<string, string> = {}) =>
  evalFormula(src, { cell: (k) => cells[k], order: Object.keys(cells) });
const val = (src: string, cells?: Record<string, string>) => {
  const r = ev(src, cells);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('arithmetic', () => {
  it('follows precedence, unary minus and right-associative power', () => {
    expect(val('=1+2*3')).toBe(7);
    expect(val('=(1+2)*3')).toBe(9);
    expect(val('=2^3^2')).toBe(512);
    expect(val('=-2^2')).toBe(-4);
    expect(val('=7%4')).toBe(3);
  });
  it('shows 0.1+0.2 as 0.3', () => {
    expect(resolveFormulas({ a: '=0.1+0.2' }).values.a).toBe('0.3');
  });
});

describe('cells', () => {
  const cells = { score: '2', loss: '0.5', 'gre-thin': '10', name: 'abc' };
  it('reads other cells by column name', () => {
    expect(val('=score*loss', cells)).toBe(1);
  });
  it('treats a hyphenated column as one cell, and spaces as subtraction', () => {
    expect(val('=gre-thin+1', cells)).toBe(11);
    expect(val('=score-loss', cells)).toBe(1.5);
  });
  it('averages a cell holding several numbers', () => {
    expect(val('=x+1', { x: '1/3' })).toBe(3);
  });
  it('works on text', () => {
    expect(val('=name&"!"', cells)).toBe('abc!');
    expect(val('=if(score>1,"big","small")', cells)).toBe('big');
  });
  it('does not take part of a longer word for a column', () => {
    expect(val('=abs(-3)', { a: '5' })).toBe(3);
  });
  it('sums a range of columns', () => {
    expect(val('=sum(a:c)', { a: '1', b: '2', c: '3', d: '10' })).toBe(6);
  });
});

describe('functions', () => {
  it('has the JavaScript Math ones and the usual spreadsheet few', () => {
    expect(val('=sqrt(16)')).toBe(4);
    expect(val('=round(3.14159, 2)')).toBe(3.14);
    expect(val('=max(1,5,3)')).toBe(5);
    expect(val('=avg(1,2,3,4)')).toBe(2.5);
    expect(val('=median(5,1,3)')).toBe(3);
    expect(val('=pow(2,10)')).toBe(1024);
    expect(val('=2*pi')).toBeCloseTo(6.2832, 3);
    expect(val('=log10(1000)')).toBeCloseTo(3);
  });
});

describe('errors', () => {
  it('reports a bad formula instead of throwing', () => {
    expect(ev('=1/0')).toEqual({ ok: false, error: 'Division by zero' });
    expect(ev('=nosuch(1)').ok).toBe(false);
    expect(ev('=1+').ok).toBe(false);
    expect(ev('=(1').ok).toBe(false);
    expect(ev('=').ok).toBe(false);
  });
  it('reports a circular reference and the cells that use it', () => {
    const r = resolveFormulas({ a: '=b+1', b: '=a+1', c: '=1' });
    expect(r.values).toEqual({ c: '1' });
    expect(r.errors.a).toMatch(/Circular/);
  });
});

describe('resolveFormulas', () => {
  it('replaces formulas by results, keeps the text, and chains', () => {
    const r = resolveFormulas({ a: '2', b: '=a*3', c: '=b+1', note: 'hi' });
    expect(r.values).toEqual({ a: '2', b: '6', c: '7', note: 'hi' });
    expect(r.formulas).toEqual({ b: '=a*3', c: '=b+1' });
    expect(r.errors).toEqual({});
  });
  it('leaves rows without formulas alone', () => {
    const p = { a: '1' };
    expect(resolveFormulas(p).values).toBe(p);
  });
});

describe('picking cells with the arrow keys', () => {
  const cols = ['a', 'b', 'c', 'd'];
  it('only picks where a reference can go', () => {
    expect(canPickAt('=', 1)).toBe(true);
    expect(canPickAt('=a+', 3)).toBe(true);
    expect(canPickAt('=sum(', 5)).toBe(true);
    expect(canPickAt('=a', 2)).toBe(false);
    expect(canPickAt('abc', 3)).toBe(false);
  });
  it('inserts the neighbour of the edited cell, then steps on, skipping itself', () => {
    const one = stepPick('=', 1, null, cols, 'b', 1)!;
    expect(one.value).toBe('=c');
    const two = stepPick(one.value, one.caret, one.pick, cols, 'b', 1)!;
    expect(two.value).toBe('=d');
    const back = stepPick(two.value, two.caret, two.pick, cols, 'b', -1)!;
    expect(back.value).toBe('=c');
    const left = stepPick('=', 1, null, cols, 'c', -1)!;
    expect(left.value).toBe('=b');
    expect(stepPick(left.value, left.caret, left.pick, cols, 'c', -1)!.value).toBe('=a');
  });
  it('stays on the last cell at the edge and ignores keys that are not picks', () => {
    const edge = stepPick('=d', 2, { start: 1, end: 2, key: 'd' }, cols, 'a', 1)!;
    expect(edge.value).toBe('=d');
    expect(stepPick('=a', 2, null, cols, 'b', 1)).toBeNull();
  });
  it('inserts a clicked cell', () => {
    expect(insertPick('=2*', 3, null, 'c')!.value).toBe('=2*c');
    expect(insertPick('=2c', 3, null, 'c')).toBeNull();
  });
});

describe('names from the prototype chain', () => {
  it('are unknown functions, not calls into Object', () => {
    for (const f of ['constructor', 'toString', '__proto__', 'hasOwnProperty'])
      expect(() => evalFormula(`=${f}(1)`, { cell: () => undefined, order: [] })).toThrow(/Unknown function/);
  });
});
