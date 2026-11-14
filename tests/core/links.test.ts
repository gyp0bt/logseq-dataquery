import { describe, expect, it } from 'vitest';
import { linkHtml } from '../../src/core/links';
import { cellHtml } from '../../src/core/images';

describe('linkHtml', () => {
  it('keeps plain text escaped', () => {
    expect(linkHtml('a < b')).toBe('a &lt; b');
    expect(linkHtml('1.27')).toBe('1.27');
  });
  it('turns tags and page references into page links', () => {
    expect(linkHtml('#tips')).toBe('<a class="dq-page" data-page="tips">#tips</a>');
    expect(linkHtml('see #[[two words]]')).toBe('see <a class="dq-page" data-page="two words">#two words</a>');
    expect(linkHtml('[[Page A]], [[B]]')).toBe('<a class="dq-page" data-page="Page A">Page A</a>, <a class="dq-page" data-page="B">B</a>');
    expect(linkHtml('a,#b')).toBe('a,<a class="dq-page" data-page="b">#b</a>');
  });
  it('leaves a # inside a word alone', () => {
    expect(linkHtml('C#')).toBe('C#');
    expect(linkHtml('x#y')).toBe('x#y');
    expect(linkHtml('# heading')).toBe('# heading');
  });
  it('links http(s) URLs, bare or as Markdown', () => {
    expect(linkHtml('https://e.org/a?b=1&c=2.')).toBe('<a class="dq-url" href="https://e.org/a?b=1&amp;c=2" data-href="https://e.org/a?b=1&amp;c=2">https://e.org/a?b=1&amp;c=2</a>.');
    expect(linkHtml('[doc](https://e.org/d)')).toBe('<a class="dq-url" href="https://e.org/d" data-href="https://e.org/d">doc</a>');
    expect(linkHtml('#tag in https://e.org/#frag')).toContain('data-href="https://e.org/#frag"');
  });
  it('refuses other schemes', () => {
    expect(linkHtml('[x](javascript:alert(1))')).toBe('[x](javascript:alert(1))');
  });
  it('escapes the page name', () => {
    expect(linkHtml('[[a"<b]]')).toBe('<a class="dq-page" data-page="a&quot;&lt;b">a&quot;&lt;b</a>');
  });
});

describe('cellHtml with links', () => {
  it('links the text around images', () => {
    expect(cellHtml('#a ![](https://e.org/x.png)', undefined)).toMatch(/^<a class="dq-page" data-page="a">#a<\/a> <img /);
  });
});
