import { describe, expect, it } from 'vitest';
import { buildMacro, expandInline, findMacro, isInlineLine, MACRO_KINDS, replaceMacro } from '../../src/core/macroText';

describe('macro text', () => {
  const content = 'before {{renderer :DQscatter, #[[a b]] combine==none,mean x:a}} after\nk:: v';
  it('maps macro names to kinds', () => expect(MACRO_KINDS).toEqual({ ':DQtable': 'table', ':DQscatter': 'scatter', ':DQbar': 'bar', ':DQcards': 'cards' }));
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

describe('expandInline', () => {
  it('turns a /DQ line into its macro', () => {
    expect(expandInline('/DQscatter #tips')).toBe('{{renderer :DQscatter, #tips}}');
    expect(expandInline('/dq table')).toBe('{{renderer :DQtable}}');
    expect(expandInline('/DQ bar #a x:k ')).toBe('{{renderer :DQbar, #a x:k}}');
    expect(expandInline('title\n  /DQtable #t\nk:: v')).toBe('title\n  {{renderer :DQtable, #t}}\nk:: v');
  });
  it('leaves other text alone', () => {
    expect(expandInline('see /DQscatter #tips')).toBeNull();
    expect(expandInline('/DQscatterx')).toBeNull();
    expect(expandInline('/DQ')).toBeNull();
    expect(expandInline('```\n/DQtable #t\n```')).toBeNull();
  });
  it('finds the caret line', () => {
    const t = 'a\n/DQbar #x\nb';
    expect(isInlineLine(t, 4)).toBe(true);
    expect(isInlineLine(t, 1)).toBe(false);
    expect(isInlineLine(t, t.length)).toBe(false);
  });
});

describe(':DQcards', () => {
  it('reads, builds and expands the cards macro', async () => {
    const { findMacro, buildMacro, expandInline } = await import('../../src/core/macroText');
    expect(findMacro('x {{renderer :DQcards, #tips}}')).toEqual({ macro: '{{renderer :DQcards, #tips}}', kind: 'cards', dsl: '#tips' });
    expect(buildMacro('cards', '#tips')).toBe('{{renderer :DQcards, #tips}}');
    expect(expandInline('/DQcards #tips')).toBe('{{renderer :DQcards, #tips}}');
    expect(expandInline('/dq cards #tips')).toBe('{{renderer :DQcards, #tips}}');
  });
});
