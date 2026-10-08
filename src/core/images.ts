import { esc } from './html';

export interface CellImage { alt: string; src: string }
export type CellPiece = { text: string } | { img: CellImage };

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
// `![alt](path)` plus Logseq's optional `{:height 100 :width 200}` size attributes.
const MD_IMG = /!\[([^\]]*)\]\(([^)\s]+)\)(\{[^}]*\})?/g;

/**
 * Split a cell into text and images, or null when it holds no image (the cell stays plain text).
 * Images are Markdown `![alt](path)` (one or several, with text between) or a cell that is just
 * one bare path/URL ending in png, jpg, jpeg, gif, webp or svg.
 */
export function imagePieces(text: string): CellPiece[] | null {
  const out: CellPiece[] = [];
  let last = 0;
  for (const m of text.matchAll(MD_IMG)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ img: { alt: m[1], src: m[2] } });
    last = at + m[0].length;
  }
  if (out.length) {
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }
  const bare = text.trim();
  if (bare && !/\s/.test(bare) && IMG_EXT.test(bare)) return [{ img: { alt: '', src: bare } }];
  return null;
}

const fileUrl = (path: string): string => 'file://' + path.split('/').map(encodeURIComponent).join('/');

/**
 * The URL a thumbnail loads, or null when it is refused. http(s) and file URLs pass as written;
 * Logseq asset paths (`../assets/x.png`, `assets/x.png`) resolve to `file://<graph>/assets/x.png`
 * and absolute paths to `file://<path>`. Every other scheme (javascript:, data:, …) is refused.
 */
export function resolveImageSrc(src: string, graphPath: string | undefined): string | null {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(src)?.[1]?.toLowerCase();
  if (scheme) return scheme === 'http' || scheme === 'https' || scheme === 'file' ? src : null;
  if (src.startsWith('/')) return fileUrl(src);
  const asset = /^(?:\.\.\/)?(assets\/.+)$/.exec(src);
  if (asset && graphPath) return fileUrl(graphPath.replace(/\/+$/, '') + '/' + asset[1]);
  return null;
}

/** Cell HTML: escaped text, with images as lazy thumbnails (`img.dq-img`, opened larger on click). */
export function cellHtml(text: string, graphPath: string | undefined): string {
  const pieces = imagePieces(text);
  if (!pieces) return esc(text);
  return pieces.map((p) => {
    if ('text' in p) return esc(p.text);
    const url = resolveImageSrc(p.img.src, graphPath);
    if (url === null) return esc(`![${p.img.alt}](${p.img.src})`);
    return `<img class="dq-img" src="${esc(url)}" alt="${esc(p.img.alt)}" loading="lazy">`;
  }).join('');
}
