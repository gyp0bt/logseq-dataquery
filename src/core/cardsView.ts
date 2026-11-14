import { blockParts, cardSnippets, cardTitle, KIND_NAMES, snippetId, walk, wholeText, type Card, type SnippetKind } from './cards';
import { esc } from './html';
import { resolveImageSrc, type AssetScheme } from './images';
import type { Cond } from './dsl';
import { matchCond } from './query';
import type { Row } from './rows';
import { parseContent } from './text';
import { inferType, type ValueType } from './types';

/**
 * Root uuids in display order: `copies` descending by default; `sort:copies` / `sort:-copies` and
 * `sort:title` / `sort:-title` are honoured, other keys fall back to the default. Ties keep outline order.
 */
export function cardOrder(cards: Card[], sort?: { key: string; desc: boolean }): string[] {
  const s = sort && (sort.key === 'copies' || sort.key === 'title') ? sort : { key: 'copies', desc: true };
  const titles = new Map(cards.map((c) => [c.root.uuid, cardTitle(c.root)]));
  const cmp = (a: Card, b: Card): number =>
    s.key === 'title' ? titles.get(a.root.uuid)!.localeCompare(titles.get(b.root.uuid)!) : a.copies - b.copies;
  return [...cards].sort((a, b) => (s.desc ? -cmp(a, b) : cmp(a, b)) || a.seq - b.seq).map((c) => c.root.uuid);
}

/** Cards whose title or text holds `text` (case ignored); all of them for a blank filter. */
export function filterCards(cards: Card[], text: string): Card[] {
  const t = text.trim().toLowerCase();
  if (!t) return cards;
  return cards.filter((c) => (cardTitle(c.root) + '\n' + wholeText(c.root)).toLowerCase().includes(t));
}

export interface CardsPaint {
  uuid: string;
  dsl: string;
  cards: Card[];
  /** Root uuids in the order the list is drawn (kept still after a copy). */
  order: string[];
  selected?: string;
  filter: string;
  notes: string[];
  error?: string;
  graphPath?: string;
  assetScheme?: AssetScheme;
}

function kindsText(c: Card): string {
  const n: Record<SnippetKind, number> = { code: 0, image: 0, link: 0 };
  for (const s of cardSnippets(c.root)) n[s.kind]++;
  return (Object.keys(n) as SnippetKind[]).filter((k) => n[k]).map((k) => `${KIND_NAMES[k]} ${n[k]}`).join(' · ');
}

const copyBtn = '<button class="dqc-copy" type="button" title="コピー" aria-label="コピー">⧉</button>';

function previewHtml(c: Card, p: CardsPaint): string {
  let index = 0;
  let body = '';
  walk(c.root, (n, depth) => {
    let inner = '';
    for (const part of blockParts(n.content)) {
      if ('text' in part) {
        inner += `<span class="dqc-text">${esc(part.text)}</span>`;
        continue;
      }
      const s = part.snip;
      const attrs = `data-snip="${index++}" data-kind="${s.kind}" data-id="${snippetId(s.text)}" tabindex="-1"`;
      if (s.kind === 'code') {
        const lang = s.lang ? `<span class="dqc-lang">${esc(s.lang)}</span>` : '';
        inner += `<div class="dqc-snip dqc-code" ${attrs}>${lang}${copyBtn}<pre><code>${esc(s.text)}</code></pre></div>`;
      } else if (s.kind === 'image') {
        const url = resolveImageSrc(s.text, p.graphPath, p.assetScheme);
        const img = url === null ? `<code>${esc(`![](${s.text})`)}</code>` : `<img src="${esc(url)}" alt="" loading="lazy">`;
        inner += `<span class="dqc-snip dqc-image" ${attrs}>${img}${copyBtn}</span>`;
      } else {
        inner += `<span class="dqc-snip dqc-link" ${attrs}><a class="dq-url" href="${esc(s.text)}" data-href="${esc(s.text)}">${esc(s.text)}</a>${copyBtn}</span>`;
      }
    }
    body += `<div class="dqc-node" style="--dqc-depth:${depth}">${inner}</div>`;
  });
  return `<section class="dqc-pv" data-card="${esc(c.root.uuid)}">
    <div class="dqc-pv-head"><b>${esc(cardTitle(c.root))}</b><span class="dqc-n">${c.copies}</span><button class="dqc-whole" type="button">全体をコピー</button></div>
    ${body}</section>`;
}

/** The DQcards view: query field, filter, list and the preview of the selected card. */
export function cardsHtml(p: CardsPaint): string {
  const head = `<div class="dqc-head">
    <input class="dqc-q" value="${esc(p.dsl)}" spellcheck="false" aria-label="query">
    <input class="dqc-filter" value="${esc(p.filter)}" placeholder="絞り込み…" spellcheck="false" aria-label="filter">`;
  const notes = p.notes.map((n) => `<div class="dqc-note">${esc(n)}</div>`).join('');
  const toast = '<div class="dqc-toast" role="status"></div>';
  const open = `<div class="dqc" data-uuid="${esc(p.uuid)}" tabindex="0">`;
  if (p.error) return `${open}${head}</div>${notes}<div class="dqc-err">${esc(p.error)}</div>${toast}</div>`;
  const byUuid = new Map(p.cards.map((c) => [c.root.uuid, c]));
  const shown = new Set(filterCards(p.cards, p.filter).map((c) => c.root.uuid));
  const rows = p.order.filter((u) => shown.has(u) && byUuid.has(u)).map((u) => byUuid.get(u)!);
  const sel = rows.find((c) => c.root.uuid === p.selected) ?? rows[0];
  const list = rows.map((c) => `<li class="dqc-row${c === sel ? ' sel' : ''}" data-card="${esc(c.root.uuid)}">
      <span class="dqc-t">${esc(cardTitle(c.root))}</span><span class="dqc-n">${c.copies}</span>
      <span class="dqc-k">${esc(kindsText(c))}</span></li>`).join('');
  const meta = `<span class="dqc-meta">${rows.length} blocks</span>`;
  const main = rows.length
    ? `<div class="dqc-body"><ul class="dqc-list">${list}</ul>${previewHtml(sel, p)}</div>`
    : '<div class="dqc-empty">該当するブロックがありません</div>';
  return `${open}${head}${meta}</div>${notes}${main}${toast}</div>`;
}

/**
 * The cards whose root block passes every condition of the query (`key==v`, `key>3`, `key`), read
 * from the root's own properties and compared the way tables compare them.
 */
export function matchConds(cards: Card[], conds: Cond[]): Card[] {
  if (!conds.length) return cards;
  const values = new Map(cards.map((c) => [c, parseContent(c.root.content).props]));
  const types: Record<string, ValueType> = {};
  for (const k of new Set(conds.map((c) => c.key)))
    types[k] = inferType([...values.values()].map((v) => v[k]).filter((x): x is string => x !== undefined));
  return cards.filter((c) => conds.every((cond) => matchCond({ values: values.get(c)! } as Row, cond, types)));
}
