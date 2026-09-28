import { describe, expect, it } from 'vitest';
import {
  compareValues, inferType, parseTypeOverrides, resolveType, toList, toNumber, valuesEqual,
} from '../../src/core/types';

describe('inferType', () => {
  it('numbers, including exponent and sign', () => expect(inferType(['0.20', '15000', '-1e-3', '+.5'])).toBe('number'));
  it('numlist when any value has slashes and all parts are numeric', () => expect(inferType(['8', '8/16', '8/16/32'])).toBe('numlist'));
  it('string otherwise', () => expect(inferType(['8/16', 'pool'])).toBe('string'));
  it('string for no values', () => expect(inferType([])).toBe('string'));
});

describe('toNumber / toList', () => {
  it('parses', () => {
    expect(toNumber('0.20')).toBe(0.2);
    expect(toNumber('pool')).toBeNaN();
    expect(toNumber(undefined)).toBeNaN();
    expect(toList('8/16')).toEqual([8, 16]);
    expect(toList('8')).toEqual([8]);
    expect(toList('a/b')).toBeNull();
  });
});

describe('overrides', () => {
  const ov = parseTypeOverrides({ seed: 'category', 'gre-*': 'ratio', 'gre-thin-*': 'number', bogus: 'float' });
  it('exact beats patterns, longer pattern beats shorter, else inferred', () => {
    expect(resolveType('seed', 'number', ov)).toBe('category');
    expect(resolveType('gre-thick', 'number', ov)).toBe('ratio');
    expect(resolveType('gre-thin-x', 'number', ov)).toBe('number');
    expect(resolveType('grids', 'number', ov)).toBe('number');
  });
  it('warns on unknown type names', () => {
    expect(ov.warnings).toEqual([
      "Unknown type 'float' for 'bogus' on the types page. Use one of: number, numlist, string, category, ratio.",
    ]);
  });
});

describe('compareValues', () => {
  it('numeric compare for number/ratio/category-of-numbers', () => {
    expect(compareValues('number', '10', '9')).toBeGreaterThan(0);
    expect(compareValues('ratio', '0.20', '0.3')).toBeLessThan(0);
    expect(compareValues('category', '2', '10')).toBeLessThan(0);
  });
  it('numlist compares element by element', () => {
    expect(compareValues('numlist', '8/16', '8/32')).toBeLessThan(0);
    expect(compareValues('numlist', '8', '8/16')).toBeLessThan(0);
    expect(compareValues('numlist', '16', '8/16')).toBeGreaterThan(0);
  });
  it('missing sorts after present', () => {
    expect(compareValues('number', undefined, '1')).toBeGreaterThan(0);
    expect(compareValues('number', '1', undefined)).toBeLessThan(0);
    expect(compareValues('number', undefined, undefined)).toBe(0);
  });
  it('strings compare by code point', () => expect(compareValues('string', 'gate', 'mean')).toBeLessThan(0));
});

describe('valuesEqual', () => {
  it('numerically equal texts are equal', () => {
    expect(valuesEqual('number', '0.20', '0.2')).toBe(true);
    expect(valuesEqual('ratio', '1', '1.00')).toBe(true);
    expect(valuesEqual('numlist', '8/16', '8/16.0')).toBe(true);
    expect(valuesEqual('numlist', '8/16', '8')).toBe(false);
  });
  it('strings compare exactly; missing never equals', () => {
    expect(valuesEqual('string', 'mean', 'mean')).toBe(true);
    expect(valuesEqual('string', undefined, 'mean')).toBe(false);
  });
});
