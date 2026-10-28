import { describe, expect, it } from 'vitest';
import { splitUnit } from '../../src/core/unit';

describe('units in property keys', () => {
  it('reads what follows -- as the unit, and says "-" when there is none', () => {
    expect(splitUnit('power--w')).toEqual({ name: 'power', unit: 'W' });
    expect(splitUnit('e--mpa')).toEqual({ name: 'e', unit: 'MPa' });
    expect(splitUnit('gre-thin--mm')).toEqual({ name: 'gre-thin', unit: 'mm' });
    expect(splitUnit('gre-thin')).toEqual({ name: 'gre-thin', unit: '-' });
    expect(splitUnit('a--')).toEqual({ name: 'a--', unit: '-' });
  });
});
