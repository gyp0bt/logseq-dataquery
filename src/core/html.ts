const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for safe interpolation into HTML or SVG markup. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => MAP[c]);
}
