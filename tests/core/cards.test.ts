import { describe, expect, it } from 'vitest';
import { cardSnippets, cardTitle, readCopies, snippetId, wholeText, type CardNode } from '../../src/core/cards';

const node = (uuid: string, content: string, children: CardNode[] = []): CardNode => ({ uuid, content, children });

describe('cardSnippets', () => {
  const root = node('r', '熱の2次勾配 #tips', [
    node('c1', '```bash\n  OMP=1 run\n```'),
    node('c2', 'see https://e.org/doc. and ![](../assets/a.png){:height 200}'),
  ]);
  it('finds code, links and images in outline order', () => {
    const s = cardSnippets(root);
    expect(s.map(({ kind, index, text, block }) => ({ kind, index, text, block }))).toEqual([
      { kind: 'code', index: 0, text: 'OMP=1 run', block: 'c1' },
      { kind: 'link', index: 1, text: 'https://e.org/doc', block: 'c2' },
      { kind: 'image', index: 2, text: '../assets/a.png', block: 'c2' },
    ]);
    expect(s[0].lang).toBe('bash');
    expect(s[0].id).toBe(snippetId('OMP=1 run'));
  });
  it('leaves URLs and images inside a fence as code', () => {
    const s = cardSnippets(node('r', '```\nhttps://e.org/x ![](a.png)\n```'));
    expect(s.map((x) => x.kind)).toEqual(['code']);
    expect(s[0].text).toBe('https://e.org/x ![](a.png)');
  });
  it('counts an image link as an image, a Markdown link as its URL, and repeats separately', () => {
    const s = cardSnippets(node('r', '![x](https://e.org/p.png) [doc](https://e.org/d) https://e.org/d'));
    expect(s.map((x) => [x.kind, x.text])).toEqual([
      ['image', 'https://e.org/p.png'],
      ['link', 'https://e.org/d'],
      ['link', 'https://e.org/d'],
    ]);
  });
  it('treats ~~~ as a fence and stops an unclosed fence at the end of its block', () => {
    const s = cardSnippets(node('r', 't', [node('a', '~~~\nx\n~~~'), node('b', '```py\nopen\nmore'), node('c', 'https://e.org/z')]));
    expect(s.map((x) => [x.kind, x.text])).toEqual([
      ['code', 'x'],
      ['code', 'open\nmore'],
      ['link', 'https://e.org/z'],
    ]);
  });
});

describe('snippetId', () => {
  it('is a stable 8-hex hash', () => {
    expect(snippetId('a')).toBe(snippetId('a'));
    expect(snippetId('a')).not.toBe(snippetId('b'));
    expect(snippetId('a')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('cardTitle', () => {
  it('drops tags, properties and macros', () => {
    expect(cardTitle(node('r', '#tips 熱の2次勾配\ncopies:: 3'))).toBe('熱の2次勾配');
    expect(cardTitle(node('r', 'copies:: 3\n{{renderer :x}} 名前 #[[a b]]'))).toBe('名前');
  });
  it('names a card with no text by its first snippet', () => {
    expect(cardTitle(node('r', '```\nx\n```'))).toBe('コード');
    expect(cardTitle(node('r', '![](a.png)'))).toBe('画像');
    expect(cardTitle(node('r', '#tips', [node('c', 'https://e.org')]))).toBe('リンク');
  });
});

describe('wholeText', () => {
  it('writes the subtree as an outline without copies::', () => {
    const root = node('r', '熱の2次勾配 #tips\ncopies:: 12\nsrc:: fluent', [
      node('a', 'child1\nline2', [node('g', 'grand')]),
      node('b', 'child2'),
    ]);
    expect(wholeText(root)).toBe('熱の2次勾配 #tips\nsrc:: fluent\n- child1\n  line2\n  - grand\n- child2');
  });
});

describe('readCopies', () => {
  it('reads the count, 0 when missing or not a number', () => {
    expect(readCopies('t\ncopies:: 12')).toBe(12);
    expect(readCopies('t\ncopies:: abc')).toBe(0);
    expect(readCopies('t')).toBe(0);
  });
});
