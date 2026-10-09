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

/** `file` in a browser; `assets` in Logseq's Electron app, which serves local files through it. */
export type AssetScheme = 'file' | 'assets';

/** A local path as a URL: Windows `C:\\x` becomes `/C:/x`, each segment is encoded except a drive letter. */
const localUrl = (path: string, scheme: AssetScheme): string => {
  const p = path.replace(/\\/g, '/');
  const segs = (p.startsWith('/') ? p : '/' + p).split('/');
  return scheme + '://' + segs.map((x) => (/^[A-Za-z]:$/.test(x) ? x : encodeURIComponent(x))).join('/');
};

/**
 * The URL a thumbnail loads, or null when it is refused. http(s), file and assets URLs pass as
 * written; Logseq asset paths (`../assets/x.png`, `assets/x.png`) resolve to `<scheme>://<graph>/assets/x.png`
 * and absolute paths (`/x`, `C:\\x`) to `<scheme>://<path>`. Every other scheme (javascript:, data:, …) is refused.
 */
export function resolveImageSrc(src: string, graphPath: string | undefined, scheme: AssetScheme = 'file'): string | null {
  if (/^[A-Za-z]:[\\/]/.test(src)) return localUrl(src, scheme);
  const sch = /^([a-z][a-z0-9+.-]*):/i.exec(src)?.[1]?.toLowerCase();
  if (sch) return sch === 'http' || sch === 'https' || sch === 'file' || sch === 'assets' ? src : null;
  if (src.startsWith('/')) return localUrl(src, scheme);
  const asset = /^(?:\.\.\/)?(assets\/.+)$/.exec(src);
  if (asset && graphPath) return localUrl(graphPath.replace(/[\\/]+$/, '') + '/' + asset[1], scheme);
  return null;
}

/** Cell HTML: escaped text, with images as lazy thumbnails (`img.dq-img`, opened larger on click). */
export function cellHtml(text: string, graphPath: string | undefined, scheme: AssetScheme = 'file'): string {
  const pieces = imagePieces(text);
  if (!pieces) return esc(text);
  return pieces.map((p) => {
    if ('text' in p) return esc(p.text);
    const url = resolveImageSrc(p.img.src, graphPath, scheme);
    if (url === null) return esc(`![${p.img.alt}](${p.img.src})`);
    return `<img class="dq-img" src="${esc(url)}" alt="${esc(p.img.alt)}" loading="lazy">`;
  }).join('');
}
