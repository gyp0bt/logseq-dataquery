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
    leaveEditing: vi.fn(),
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
    f.focus();
    f.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
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

describe('CardViews after review', () => {
  it('applies the query conditions to the cards (I1)', async () => {
    cards[1].root.content += '\nlang:: python';
    await v.show(slot, 'm', '#tips lang==python');
    expect(rows()).toEqual(['B']);
  });
  it('does not repaint the filter while composing, and waits for a pause in typing (I2)', async () => {
    vi.useFakeTimers();
    try {
      const f = document.querySelector<HTMLInputElement>('input.dqc-filter')!;
      f.focus();
      f.value = 'n';
      f.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
      vi.advanceTimersByTime(1000);
      expect(document.querySelector('input.dqc-filter')).toBe(f);
      f.value = 'needle';
      f.dispatchEvent(new Event('compositionend', { bubbles: true }));
      f.dispatchEvent(new InputEvent('input', { bubbles: true }));
      expect(document.querySelector('input.dqc-filter')).toBe(f);
      vi.advanceTimersByTime(400);
      expect(rows()).toEqual(['C']);
    } finally {
      vi.useRealTimers();
    }
  });
  it('holds a graph refresh while a field is being typed in, and paints on leaving it (I2, M3)', async () => {
    const q = document.querySelector<HTMLInputElement>('input.dqc-q')!;
    q.focus();
    q.value = '#tips half-typed';
    cards[1].copies = 99;
    await v.refreshAll();
    expect(document.querySelector('input.dqc-q')).toBe(q);
    q.blur();
    q.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await flush();
    expect(document.querySelector('li.dqc-row[data-card="B"] .dqc-n')?.textContent).toBe('99');
  });
  it('scrolls the newly selected row into view after the new HTML arrives (I3)', async () => {
    const seen: Element[] = [];
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) { if (this.isConnected) seen.push(this); } as any;
    deps.provide = (s: string, html: string) => setTimeout(() => { document.getElementById(s)!.innerHTML = html; }, 5);
    try {
      root().focus();
      key(root(), 'ArrowDown');
      await new Promise((r) => setTimeout(r, 60));
      expect(seen.filter((e) => e.isConnected).map((e) => e.getAttribute('data-card'))).toContain('C');
    } finally {
      Element.prototype.scrollIntoView = orig;
    }
  });
  it('keeps keys and presses inside the view away from Logseq, and ends block editing on a press (I4)', () => {
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    document.addEventListener('keyup', outside);
    document.addEventListener('pointerdown', outside);
    try {
      const f = document.querySelector<HTMLInputElement>('input.dqc-filter')!;
      f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      f.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', bubbles: true }));
      root().dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
      root().dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(outside).not.toHaveBeenCalled();
      root().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(deps.leaveEditing).toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', outside);
      document.removeEventListener('keyup', outside);
      document.removeEventListener('pointerdown', outside);
    }
  });
  it('keeps the keyboard in the view after a copy button was pressed and the view repainted (I6)', async () => {
    document.querySelector<HTMLElement>('li.dqc-row[data-card="A"]')!.click();
    const btn = document.querySelector<HTMLElement>('[data-snip="1"] button.dqc-copy')!;
    btn.focus();
    btn.click();
    cards[0].copies = 4;
    await v.refreshAll();
    expect(document.activeElement?.getAttribute('data-snip')).toBe('1');
    const whole = document.querySelector<HTMLElement>('button.dqc-whole')!;
    whole.focus();
    cards[0].copies = 5;
    await v.refreshAll();
    expect(document.activeElement).toBe(root());
  });
});
