// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardViews } from '../../src/host/cards';
import { StaleSnippet } from '../../src/host/cardCopy';
import { snippetId, type Card, type CardNode } from '../../src/core/cards';

const node = (uuid: string, content: string, children: CardNode[] = []): CardNode => ({ uuid, content, children });
const card = (uuid: string, title: string, copies: number, seq: number, children: CardNode[] = []): Card =>
  ({ root: node(uuid, `${title} #tips`, children), copies, seq, page: 'p' });

let cards: Card[];
let deps: any;
let v: CardViews;
const slot = 'slot1';
const flush = () => new Promise((r) => setTimeout(r, 0));
const root = () => document.querySelector<HTMLElement>('.dqc')!;
const rows = () => [...document.querySelectorAll('li.dqc-row')].map((r) => r.getAttribute('data-card'));
const sel = () => document.querySelector('li.dqc-row.sel')?.getAttribute('data-card');
const key = (el: Element, k: string, opts: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));

beforeEach(async () => {
  document.body.innerHTML = `<div id="${slot}"></div>`;
  cards = [
    card('A', 'alpha', 3, 1, [node('a1', '```\nls\n```'), node('a2', 'https://e.org/d')]),
    card('B', 'beta', 12, 2),
    card('C', 'gamma', 3, 0, [node('c1', 'needle')]),
  ];
  deps = {
    fetch: vi.fn(async () => structuredClone(cards)),
    copier: { copy: vi.fn(async () => 1) },
    provide: (s: string, html: string) => { document.getElementById(s)!.innerHTML = html; },
    exists: (s: string) => !!document.getElementById(s),
    save: vi.fn(async () => {}),
    selectBlock: vi.fn(),
    report: vi.fn(),
    openUrl: vi.fn(),
  };
  v = new CardViews(document, deps);
  await v.show(slot, 'm', '#tips');
});
afterEach(() => v.dispose());

describe('CardViews', () => {
  it('draws the cards by copies and keeps that order and the selection after a count changes', async () => {
    expect(rows()).toEqual(['B', 'C', 'A']);
    document.querySelector<HTMLElement>('li.dqc-row[data-card="A"]')!.click();
    expect(sel()).toBe('A');
    cards[0].copies = 30;
    await v.refreshAll();
    expect(rows()).toEqual(['B', 'C', 'A']);
    expect(sel()).toBe('A');
    expect(document.querySelector('li.dqc-row[data-card="A"] .dqc-n')?.textContent).toBe('30');
  });
  it('orders again when the filter changes and when the query is saved', async () => {
    cards[0].copies = 30;
    await v.refreshAll();
    const f = document.querySelector<HTMLInputElement>('input.dqc-filter')!;
    f.value = 'a';
    f.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rows()).toEqual(['A', 'B', 'C']);
    expect(document.activeElement).toBe(document.querySelector('input.dqc-filter'));
    const q = document.querySelector<HTMLInputElement>('input.dqc-q')!;
    q.value = '#tips sort:title';
    key(q, 'Enter');
    await flush();
    expect(deps.save).toHaveBeenCalledWith('m', '#tips sort:title');
  });
  it('copies the whole card on a double-click and a snippet from its button', async () => {
    const a = document.querySelector<HTMLElement>('li.dqc-row[data-card="A"]')!;
    a.click();
    document.querySelector('li.dqc-row[data-card="A"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(deps.copier.copy).toHaveBeenCalledWith('A', 'whole');
    document.querySelector<HTMLElement>('[data-snip="0"] button.dqc-copy')!.click();
    expect(deps.copier.copy).toHaveBeenLastCalledWith('A', { kind: 'code', index: 0, id: snippetId('ls') });
    await flush();
    expect(document.querySelector('.dqc-toast')?.textContent).toContain('コピーしました');
  });
  it('tells a stale snippet in the toast and other failures to report', async () => {
    deps.copier.copy.mockRejectedValueOnce(new StaleSnippet());
    document.querySelector<HTMLElement>('button.dqc-whole')!.click();
    await flush();
    await flush();
    expect(document.querySelector('.dqc-toast')?.textContent).toBe('中身が変わったので選び直してください');
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    const boom = new Error('x');
    deps.copier.copy.mockRejectedValueOnce(boom);
    document.querySelector<HTMLElement>('button.dqc-whole')!.click();
    await flush();
    expect(deps.report).toHaveBeenCalledWith(boom);
  });
  it('moves with the keys and leaves to Logseq on Esc', async () => {
    root().focus();
    key(root(), 'ArrowDown');
    expect(sel()).toBe('C');
    key(root(), 'ArrowDown');
    key(root(), 'ArrowDown');
    expect(sel()).toBe('A');
    key(root(), 'ArrowUp');
    expect(sel()).toBe('C');
    key(root(), 'ArrowDown');
    key(root(), 'Tab');
    expect(document.activeElement?.getAttribute('data-snip')).toBe('0');
    key(document.activeElement!, 'Tab');
    expect(document.activeElement?.getAttribute('data-snip')).toBe('1');
    key(document.activeElement!, 'Tab', { shiftKey: true });
    expect(document.activeElement?.getAttribute('data-snip')).toBe('0');
    key(document.activeElement!, 'Enter');
    expect(deps.copier.copy).toHaveBeenLastCalledWith('A', { kind: 'code', index: 0, id: snippetId('ls') });
    root().focus();
    key(root(), 'Enter');
    expect(deps.copier.copy).toHaveBeenLastCalledWith('A', 'whole');
    key(root(), 'Escape');
    expect(deps.selectBlock).toHaveBeenCalledWith('m');
  });
  it('leaves keys typed in the fields alone', () => {
    const f = document.querySelector<HTMLInputElement>('input.dqc-filter')!;
    f.focus();
    expect(key(f, 'ArrowDown')).toBe(true);
    expect(key(f, 'a')).toBe(true);
    expect(sel()).toBe('B');
  });
  it('keeps the list scroll across a repaint', async () => {
    document.querySelector<HTMLElement>('.dqc-list')!.scrollTop = 40;
    cards[1].copies = 13;
    await v.refreshAll();
    await flush();
    expect(document.querySelector<HTMLElement>('.dqc-list')!.scrollTop).toBe(40);
  });
  it('paints a fetch error in the view', async () => {
    deps.fetch.mockRejectedValueOnce(new Error('DQcards needs a #tag or [[page]] in its query.'));
    await v.show(slot, 'm', 'x==1');
    expect(document.querySelector('.dqc-err')?.textContent).toContain('DQcards needs a #tag');
  });
  it('shows the settings it ignores', async () => {
    await v.show(slot, 'm', '#tips x:a');
    expect(document.querySelector('.dqc-note')?.textContent).toBe('DQcards では使いません: x');
  });
});
