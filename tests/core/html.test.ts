import { describe, expect, it } from 'vitest';
import { esc } from '../../src/core/html';

describe('esc', () => {
  it('escapes HTML metacharacters', () => {
    expect(esc(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
  it('leaves plain text alone', () => {
    expect(esc('gre-thin 0.20')).toBe('gre-thin 0.20');
  });
});
