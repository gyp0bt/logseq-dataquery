// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cardOrder, cardsHtml, filterCards, type CardsPaint } from '../../src/core/cardsView';
import type { Card, CardNode } from '../../src/core/cards';

const node = (uuid: string, content: string, children: CardNode[] = []): CardNode => ({ uuid, content, children });
const card = (uuid: string, title: string, copies: number, seq: number, children: CardNode[] = []): Card =>
  ({ root: node(uuid, `${title} #tips\ncopies:: ${copies}`, children), copies, seq, page: 'p' });

const A = card('A', 'alpha', 3, 1, [node('a1', '```sh\nls <x>\n```'), node('a2', '![](https://e.org/i.png) https://e.org/d')]);
const B = card('B', 'beta', 12, 2);
const C = card('C', 'gamma', 3, 0, [node('c1', 'needle here')]);
const cards = [A, B, C];

describe('cardOrder', () => {
  it('puts the most copied first, ties in outline order', () => expect(cardOrder(cards)).toEqual(['B', 'C', 'A']));
  it('follows sort:copies, sort:-title and ignores other keys', () => {
    expect(cardOrder(cards, { key: 'copies', desc: false })).toEqual(['C', 'A', 'B']);
    expect(cardOrder(cards, { key: 'title', desc: true })).toEqual(['C', 'B', 'A']);
    expect(cardOrder(cards, { key: 'nope', desc: false })).toEqual(['B', 'C', 'A']);
  });
});

describe('filterCards', () => {
  it('matches the title or any child text, ignoring case', () => {
    expect(filterCards(cards, 'NEEDLE').map((c) => c.root.uuid)).toEqual(['C']);
    expect(filterCards(cards, 'bet').map((c) => c.root.uuid)).toEqual(['B']);
    expect(filterCards(cards, '  ').length).toBe(3);
  });
});

describe('cardsHtml', () => {
  const paint = (over: Partial<CardsPaint> = {}): string =>
    cardsHtml({ uuid: 'm', dsl: '#tips', cards, order: ['B', 'C', 'A'], filter: '', notes: [], ...over });
  const dom = (html: string) => {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d;
  };
  it('draws the list in order with counts and kinds, selecting the first row by default', () => {
    const d = dom(paint());
    const rows = [...d.querySelectorAll('li.dqc-row')];
    expect(rows.map((r) => r.getAttribute('data-card'))).toEqual(['B', 'C', 'A']);
    expect(rows[0].classList.contains('sel')).toBe(true);
    expect(rows[0].querySelector('.dqc-n')?.textContent).toBe('12');
    expect(rows[2].textContent).toContain('コード 1 · 画像 1 · リンク 1');
    expect(d.querySelector('.dqc')?.getAttribute('data-uuid')).toBe('m');
    expect(d.querySelector('.dqc')?.getAttribute('tabindex')).toBe('0');
    expect(d.querySelector('section.dqc-pv')?.getAttribute('data-card')).toBe('B');
  });
  it('previews the selected card with a copy button per snippet', () => {
    const d = dom(paint({ selected: 'A' }));
    const snips = [...d.querySelectorAll('section.dqc-pv [data-snip]')];
    expect(snips.map((s) => [s.getAttribute('data-snip'), s.getAttribute('data-kind')])).toEqual([['0', 'code'], ['1', 'image'], ['2', 'link']]);
    expect(snips.every((s) => s.querySelector('button.dqc-copy'))).toBe(true);
    expect(d.querySelector('section.dqc-pv pre')?.innerHTML).toContain('ls &lt;x&gt;');
    expect(d.querySelector('section.dqc-pv img')?.getAttribute('src')).toBe('https://e.org/i.png');
    expect(d.querySelector('button.dqc-whole')).not.toBeNull();
    expect(d.querySelector('section.dqc-pv')?.textContent).not.toContain('copies::');
  });
  it('falls back to the first shown row when the selection is filtered out', () => {
    const d = dom(paint({ selected: 'A', filter: 'needle' }));
    expect([...d.querySelectorAll('li.dqc-row')].map((r) => r.getAttribute('data-card'))).toEqual(['C']);
    expect(d.querySelector('section.dqc-pv')?.getAttribute('data-card')).toBe('C');
    expect((d.querySelector('input.dqc-filter') as HTMLInputElement).value).toBe('needle');
  });
  it('shows notes, and an error instead of the lists', () => {
    expect(dom(paint({ notes: ['DQcards では使いません: x'] })).textContent).toContain('DQcards では使いません: x');
    const d = dom(paint({ error: 'DQcards needs a #tag' }));
    expect(d.textContent).toContain('DQcards needs a #tag');
    expect(d.querySelector('li.dqc-row')).toBeNull();
    expect((d.querySelector('input.dqc-q') as HTMLInputElement).value).toBe('#tips');
  });
});
