import { parseContent } from './text';

/** A block of a card and its children, in outline order. */
export interface CardNode { uuid: string; content: string; children: CardNode[] }
export type SnippetKind = 'code' | 'image' | 'link';
/**
 * One thing a card can copy on its own. `index` counts all kinds together in outline order;
 * `id` hashes `text`, so a copy can check that the block still holds the same thing.
 */
export interface Snippet { kind: SnippetKind; index: number; id: string; text: string; lang?: string; block: string }

export const KIND_NAMES: Record<SnippetKind, string> = { code: 'コード', image: '画像', link: 'リンク' };

const FENCE = /^\s*(```|~~~)\s*([^\s`]*)/;
// Image first, so `![](https://…)` is one image and not also a link.
const PIECE = /!\[[^\]]*\]\(([^)\s]+)\)(?:\{[^}]*\})?|\[[^\[\]]+\]\((https?:\/\/[^\s()]+)\)|(https?:\/\/[^\s<>"'\[\]]+)/g;
const COPIES_LINE = /^\s*copies::/i;

/** FNV-1a over the UTF-16 code units, as 8 hex digits. */
export function snippetId(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function dedent(lines: string[]): string {
  const widths = lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length);
  const cut = widths.length ? Math.min(...widths) : 0;
  return lines.map((l) => l.slice(cut)).join('\n');
}

type Found = Omit<Snippet, 'index' | 'id' | 'block'>;

/** The snippets of one block's text; a fence left open runs to the end of the block. */
function blockSnippets(content: string): Found[] {
  const out: Found[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE.exec(lines[i]);
    if (open) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith(open[1])) body.push(lines[j++]);
      out.push({ kind: 'code', text: dedent(body), ...(open[2] ? { lang: open[2] } : {}) });
      i = j;
      continue;
    }
    if (COPIES_LINE.test(lines[i])) continue;
    for (const m of lines[i].matchAll(PIECE)) {
      if (m[1]) out.push({ kind: 'image', text: m[1] });
      else if (m[2]) out.push({ kind: 'link', text: m[2] });
      // Sentence punctuation after a bare URL is not part of it.
      else out.push({ kind: 'link', text: m[3].replace(/[.,;:!?)]+$/, '') });
    }
  }
  return out;
}

function walk(n: CardNode, visit: (n: CardNode, depth: number) => void, depth = 0): void {
  visit(n, depth);
  for (const c of n.children) walk(c, visit, depth + 1);
}

/** Every code block, image and link of the card, numbered in outline order. */
export function cardSnippets(root: CardNode): Snippet[] {
  const out: Snippet[] = [];
  walk(root, (n) => {
    for (const f of blockSnippets(n.content)) out.push({ ...f, index: out.length, id: snippetId(f.text), block: n.uuid });
  });
  return out;
}

/** The first line of the root's text without properties, macros, images and tags; else the first snippet's kind. */
export function cardTitle(root: CardNode): string {
  for (const line of root.content.split('\n')) {
    if (FENCE.test(line)) break;
    if (/^\s*[^\s:]+::/.test(line)) continue;
    const t = line
      .replace(/\{\{[^}]*\}\}/g, ' ')
      .replace(/!\[[^\]]*\]\([^)\s]+\)(?:\{[^}]*\})?/g, ' ')
      .replace(/(?<![^\s,(])#\[\[[^\]]*\]\]/g, ' ')
      .replace(/(?<![^\s,(])#[^\s,#\[\]()"']+/g, ' ')
      .replace(/^\s*#+\s/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (t) return t;
  }
  const first = cardSnippets(root)[0];
  return first ? KIND_NAMES[first.kind] : '';
}

/** The card as outline text (`- ` per child level), without the `copies::` line. */
export function wholeText(root: CardNode): string {
  const out: string[] = [];
  walk(root, (n, depth) => {
    const lines = n.content.split('\n').filter((l) => !COPIES_LINE.test(l));
    const pad = '  '.repeat(Math.max(0, depth - 1));
    lines.forEach((l, i) => {
      if (depth === 0) out.push(l);
      else out.push(pad + (i === 0 ? '- ' : '  ') + l);
    });
  });
  return out.join('\n');
}

/** The `copies::` count of a block's text; 0 when it is missing or not a whole number. */
export function readCopies(content: string): number {
  const v = parseContent(content).props.copies;
  return v !== undefined && /^\d+$/.test(v) ? Number(v) : 0;
}
