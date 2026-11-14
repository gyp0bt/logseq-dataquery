import { esc } from './html';

// One pass over the text; the first alternative that matches at a position wins.
//   1 2  Markdown link `[label](http…)`
//   3    `#[[page]]`
//   4    `[[page]]`
//   5    `#tag`, only at the start or after a space, comma or `(` (so `C#` and `x#y` stay text)
//   6    bare http(s) URL
const LINK =
  /\[([^\[\]]+)\]\((https?:\/\/[^\s()]+)\)|#\[\[([^\[\]]+)\]\]|\[\[([^\[\]]+)\]\]|(?<![^\s,(])#([^\s,#\[\]()"']+)|(https?:\/\/[^\s<>"'\[\]]+)/g;

const page = (name: string, shown: string) => `<a class="dq-page" data-page="${esc(name)}">${esc(shown)}</a>`;
const url = (href: string, shown: string) => `<a class="dq-url" href="${esc(href)}" data-href="${esc(href)}">${esc(shown)}</a>`;

/**
 * Escaped text with Logseq's links made clickable: tags (`#x`, `#[[x y]]`) and page references
 * (`[[x]]`) become `a.dq-page[data-page]`, http(s) URLs (bare or `[label](url)`) become
 * `a.dq-url[data-href]`. The host script opens them; other schemes stay text.
 */
export function linkHtml(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const at = m.index ?? 0;
    let whole = m[0];
    let html: string;
    if (m[2]) html = url(m[2], m[1]);
    else if (m[3]) html = page(m[3], '#' + m[3]);
    else if (m[4]) html = page(m[4], m[4]);
    else if (m[5]) html = page(m[5], '#' + m[5]);
    else {
      // Sentence punctuation after a bare URL is not part of it.
      whole = whole.replace(/[.,;:!?)]+$/, '');
      html = url(whole, whole);
    }
    out += esc(text.slice(last, at)) + html;
    last = at + whole.length;
  }
  return out + esc(text.slice(last));
}
