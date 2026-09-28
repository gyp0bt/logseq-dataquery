import { describe, expect, it } from 'vitest';
import { buildMacro, dslFromMacro, findMacro, replaceMacro } from '../../src/core/macroText';

describe('macro text', () => {
  const content = 'before {{renderer :dataquery, in [[a/b]] | where x in (1, 2)}} after\nk:: v';
  it('finds the macro including [[links]]', () => {
    expect(findMacro(content)).toBe('{{renderer :dataquery, in [[a/b]] | where x in (1, 2)}}');
    expect(findMacro('{{renderer :other}}')).toBeNull();
    expect(findMacro('{{renderer :dataquery}}')).toBe('{{renderer :dataquery}}');
  });
  it('extracts and builds the DSL', () => {
    expect(dslFromMacro('{{renderer :dataquery, in [[a/b]] | sort x}}')).toBe('in [[a/b]] | sort x');
    expect(dslFromMacro('{{renderer :dataquery}}')).toBe('');
    expect(buildMacro('')).toBe('{{renderer :dataquery}}');
    expect(buildMacro(' sort x ')).toBe('{{renderer :dataquery, sort x}}');
  });
  it('replaces only when the old macro is still there (Review Focus 5)', () => {
    const old = findMacro(content)!;
    expect(replaceMacro(content, old, 'sort y')).toBe('before {{renderer :dataquery, sort y}} after\nk:: v');
    expect(replaceMacro(content, '{{renderer :dataquery, gone}}', 'sort y')).toBeNull();
  });
});
