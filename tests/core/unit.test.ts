import { describe, expect, it } from 'vitest';
import { parseQuery } from '../../src/core/dsl';
import { normKey, splitUnit } from '../../src/core/unit';
import { parseContent } from '../../src/core/text';

describe('units in property keys', () => {
  it('reads the bracket as the unit and says "-" when there is none', () => {
    expect(splitUnit('a[W]')).toEqual({ name: 'a', unit: 'W' });
    expect(splitUnit('gre-thin[mm]')).toEqual({ name: 'gre-thin', unit: 'mm' });
    expect(splitUnit('seed')).toEqual({ name: 'seed', unit: '-' });
    expect(splitUnit('a[]')).toEqual({ name: 'a[]', unit: '-' });
  });
  it('lower-cases the name but keeps the unit as written', () => {
    expect(normKey('Power[W]')).toBe('power[W]');
    expect(normKey('E[MPa]')).toBe('e[MPa]');
    expect(normKey('Seed')).toBe('seed');
    expect(parseContent('T\nPower[W]:: 5').props).toEqual({ 'power[W]': '5' });
  });
  it('queries can name such a key', () => {
    const p = parseQuery('x:a[W] y:b[mm] a[W]>3 c[K]');
    expect(p.ok && p.query.x).toBe('a[W]');
    expect(p.ok && p.query.ys).toEqual(['b[mm]']);
    expect(p.ok && p.query.conds).toEqual([{ kind: 'cmp', key: 'a[W]', op: '>', values: ['3'] }, { kind: 'has', key: 'c[K]' }]);
  });
});
