import { normKey } from './unit';
const PROP_LINE = /^\s*([^\s:]+)::(?:\s+(.*))?\s*$/;

const BUILTIN_KEYS = new Set([
  'id', 'collapsed', 'heading', 'background-color', 'title', 'alias', 'aliases', 'tags',
  'template', 'template-including-parent', 'public', 'filters', 'icon',
  'exclude-from-graph-view', 'ls-type', 'created-at', 'updated-at',
]);
const BUILTIN_PREFIXES = ['query-', 'card-', 'hl-', 'logseq.'];

/** True for properties Logseq itself writes; those never count as data. */
export function isBuiltinKey(key: string): boolean {
  const k = key.toLowerCase();
  return BUILTIN_KEYS.has(k) || BUILTIN_PREFIXES.some((p) => k.startsWith(p));
}

export interface ParsedContent {
  props: Record<string, string>;
  title: string;
}

/** Read `key:: value` lines from raw block text, keeping values exactly as written. */
export function parseContent(content: string): ParsedContent {
  const props: Record<string, string> = {};
  let title = '';
  let inFence = false;
  for (const line of content.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = PROP_LINE.exec(line);
    if (m) {
      const key = normKey(m[1]);
      const value = (m[2] ?? '').trim();
      if (value !== '' && !isBuiltinKey(key) && !(key in props)) props[key] = value;
      continue;
    }
    if (!title && line.trim()) title = line.trim().replace(/^#+\s*/, '');
  }
  return { props, title };
}
