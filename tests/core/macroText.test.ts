import { describe, expect, it } from 'vitest';
import { buildMacro, findMacro, MACRO_KINDS, replaceMacro } from '../../src/core/macroText';

describe('macro text', () => {
  const content = 'before {{renderer :DQscatter, #[[a b]] combine==none,mean x:a}} after\nk:: v';
  it('maps macro names to kinds', () => expect(MACRO_KINDS).toEqual({ ':DQtable': 'table', ':DQscatter': 'scatter', ':DQbar': 'bar' }));
  it('finds the macro, its kind and its query', () => {
    expect(findMacro(content)).toEqual({ macro: '{{renderer :DQscatter, #[[a b]] combine==none,mean x:a}}', kind: 'scatter', dsl: '#[[a b]] combine==none,mean x:a' });
    expect(findMacro('{{renderer :DQtable}}')).toEqual({ macro: '{{renderer :DQtable}}', kind: 'table', dsl: '' });
    expect(findMacro('x {{renderer :DQbar ,  #t }}')!.dsl).toBe('#t');
    expect(findMacro('{{renderer :other}}')).toBeNull();
    expect(findMacro('{{renderer :DQtables, #t}}')).toBeNull();
    expect(findMacro('{{renderer :dataquery, sort x}}')).toBeNull();
  });
  it('builds the macro', () => {
    expect(buildMacro('table', '')).toBe('{{renderer :DQtable}}');
    expect(buildMacro('scatter', ' #t x:a ')).toBe('{{renderer :DQscatter, #t x:a}}');
    expect(buildMacro('bar', '#t')).toBe('{{renderer :DQbar, #t}}');
  });
  it('replaces only when the old macro is still there', () => {
    const old = findMacro(content)!.macro;
    expect(replaceMacro(content, old, 'scatter', '#t')).toBe('before {{renderer :DQscatter, #t}} after\nk:: v');
    expect(replaceMacro(content, '{{renderer :DQscatter, gone}}', 'scatter', '#t')).toBeNull();
  });
});
