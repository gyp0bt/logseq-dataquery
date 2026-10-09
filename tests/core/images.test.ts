import { describe, expect, it } from 'vitest';
import { cellHtml, imagePieces, resolveImageSrc } from '../../src/core/images';

describe('imagePieces', () => {
  it('finds one or several Markdown images, keeping the text around them', () => {
    expect(imagePieces('![a](../assets/x.png)')).toEqual([{ img: { alt: 'a', src: '../assets/x.png' } }]);
    expect(imagePieces('see ![a](a.png) and ![b c](https://e.org/b.jpg){:height 100}')).toEqual([
      { text: 'see ' }, { img: { alt: 'a', src: 'a.png' } }, { text: ' and ' }, { img: { alt: 'b c', src: 'https://e.org/b.jpg' } },
    ]);
  });
  it('takes a bare image path or URL by its extension', () => {
    expect(imagePieces('assets/plot.SVG')).toEqual([{ img: { alt: '', src: 'assets/plot.SVG' } }]);
    expect(imagePieces(' https://e.org/a.webp ')).toEqual([{ img: { alt: '', src: 'https://e.org/a.webp' } }]);
    for (const e of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']) expect(imagePieces(`x.${e}`)).not.toBeNull();
  });
  it('leaves everything else as text', () => {
    expect(imagePieces('[doc](../assets/a.pdf)')).toBeNull();
    expect(imagePieces('a.png b')).toBeNull();
    expect(imagePieces('1.27')).toBeNull();
    expect(imagePieces('notes.txt')).toBeNull();
  });
});

describe('resolveImageSrc', () => {
  it('uses Logseq\'s assets:// protocol when asked (the desktop app)', () => {
    expect(resolveImageSrc('../assets/x.png', '/home/u/graph', 'assets')).toBe('assets:///home/u/graph/assets/x.png');
    expect(resolveImageSrc('/tmp/p.png', undefined, 'assets')).toBe('assets:///tmp/p.png');
    expect(resolveImageSrc('assets:///home/u/g/a.png', undefined)).toBe('assets:///home/u/g/a.png');
  });
  it('turns Windows graph folders and paths into URLs without encoding the drive', () => {
    expect(resolveImageSrc('../assets/x.png', 'C:\\Users\\u\\graph', 'assets')).toBe('assets:///C:/Users/u/graph/assets/x.png');
    expect(resolveImageSrc('C:\\pics\\a b.png', undefined)).toBe('file:///C:/pics/a%20b.png');
    expect(resolveImageSrc('../assets/x.png', 'D:/g/')).toBe('file:///D:/g/assets/x.png');
  });
  const g = '/home/u/graph';
  it('resolves Logseq asset paths against the graph folder', () => {
    expect(resolveImageSrc('../assets/x.png', g)).toBe('file:///home/u/graph/assets/x.png');
    expect(resolveImageSrc('assets/x.png', g)).toBe('file:///home/u/graph/assets/x.png');
    expect(resolveImageSrc('../assets/a b.png', g)).toBe('file:///home/u/graph/assets/a%20b.png');
    expect(resolveImageSrc('/tmp/p.png', g)).toBe('file:///tmp/p.png');
  });
  it('keeps http(s) and file URLs, refuses other schemes and unresolvable paths', () => {
    expect(resolveImageSrc('https://e.org/a.png', g)).toBe('https://e.org/a.png');
    expect(resolveImageSrc('http://e.org/a.png', g)).toBe('http://e.org/a.png');
    expect(resolveImageSrc('file:///x/a.png', g)).toBe('file:///x/a.png');
    expect(resolveImageSrc('javascript:alert(1)//.png', g)).toBeNull();
    expect(resolveImageSrc('data:image/png;base64,AAA', g)).toBeNull();
    expect(resolveImageSrc('../assets/x.png', undefined)).toBeNull();
  });
});

describe('cellHtml', () => {
  it('draws thumbnails that open larger, escaping alt and path', () => {
    const h = cellHtml('![a"><script>](https://e.org/x.png?a=1&b="2")', '/g');
    expect(h).toBe('<img class="dq-img" src="https://e.org/x.png?a=1&amp;b=&quot;2&quot;" alt="a&quot;&gt;&lt;script&gt;" loading="lazy">');
    expect(h).not.toContain('<script>');
  });
  it('plain text and refused images stay escaped text', () => {
    expect(cellHtml('<b>1</b>', '/g')).toBe('&lt;b&gt;1&lt;/b&gt;');
    expect(cellHtml('![x](javascript:alert(1).png)', '/g')).toBe('![x](javascript:alert(1).png)');
  });
});
