# logseq-dataquery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Logseq OG plugin that turns property blocks into a typed, queryable table with scatter/bar charts, rendered inline via `{{renderer :dataquery, …}}` and explorable in a full-screen panel whose filter GUI round-trips with the DSL.

**Architecture:** Pure `src/core/` (text parsing, types, DSL, rows/merge, query, charts, inline HTML, filter cards) with no Logseq dependency; thin `src/host/` (DB collection, engine cache, actions, inline view registry) behind a `LogseqLike` interface so it can be tested with fakes; `src/panel/` React UI inside the plugin iframe. Charts are SVG strings produced once in core and reused by both inline view and panel.

**Tech Stack:** TypeScript 7, Vite 8, Vitest 4 (jsdom for panel), React 19, `@logseq/libs` 0.0.17 (OG).

**Spec:** `docs/superpowers/specs/2026-09-29-dataquery-design.md`

## Global Constraints

- Target Logseq OG (file graphs, 0.10.x); `@logseq/libs` `^0.0.17`. No DB-version APIs.
- All user-facing text (UI labels, error messages, README) is **English**.
- No code may assume a specific graph, page name, or property vocabulary (no `run`, `type`, `gre-*`, `work/nsb` in `src/`). They appear only in tests as sample data.
- Wrapping errors: `throw new Error('clear message', { cause: e })`. Never swallow; log with `console.error(msg, e)`.
- Macro form: `{{renderer :dataquery, <dsl>}}`; slash command `Data query`; setting `typesPage` default `dataquery/types`.
- Display original property text verbatim (`0.20` stays `0.20`).
- Inline view interactions limited to `data-on-click` handlers: `dqJump`, `dqOpen`, `dqToggleLabels`.
- Every string interpolated into HTML/SVG goes through `esc()`.
- Tests: `npx vitest run`; typecheck: `npx tsc -b`.

## Review Focus

1. Logseq splits macro arguments on commas; after `joinMacroArgs`, `plot bar x=a y=b,c` arrives as `y=b, c` and `in (x,y)` as `in (x, y)` — both must parse identically to the unsplit text (test in Task 4).
2. Numerically equal texts (`0.20` vs `0.2`) must compare equal in `=`/`in` and must not be flagged as merge conflicts (tests in Tasks 3 and 5).
3. Rows missing a key: excluded by `<`/`=`/`in`/`has`, included by `!=`, sorted last in both asc and desc (tests in Tasks 3 and 6).
4. Property values containing `<`, `"`, `&` are injected into the host DOM — must render escaped in table, chart titles, labels, legend, error box (test in Task 8).
5. Saving from the panel after the macro block was edited elsewhere must refuse with a clear message rather than overwrite (test in Task 10).

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, index.html, icon.svg, LICENSE, README.md, .gitignore
src/
  main.ts                 plugin entry: wiring only
  core/
    html.ts               esc()
    text.ts               parseContent(), isBuiltinKey()
    types.ts              ValueType, inference, overrides, compare/equal
    dsl.ts                Query AST, parseDsl(), printDsl(), joinMacroArgs()
    macroText.ts          findMacro(), dslFromMacro(), buildMacro(), replaceMacro()
    rows.ts               SourceBlock, Row, blockToRow(), mergeRows(), rowLabel()
    query.ts              computeTypes(), runQuery()
    chart.ts              niceTicks(), scatterSvg(), barSvg(), legendHtml()
    view.ts               renderInline() (inline HTML string)
    cards.ts              whereToCards(), cardsToWhere(), newCard()
  host/
    api.ts                LogseqLike interface
    collect.ts            fetchBlocks(), fetchTypeOverrides(), fetchScope()
    engine.ts             Engine (cache + evaluate)
    actions.ts            saveDsl(), setType(), jumpTo(), errorText()
    inline.ts             InlineViews (slot registry, render, refresh)
  panel/
    mount.tsx             mountPanel()
    App.tsx, DslBar.tsx, ScopeSwitch.tsx, FilterPanel.tsx, PlotControls.tsx, ChartView.tsx, DataTable.tsx
  style/
    tokens.css            --dq-* colour tokens (light + dark)
    inline.css            inline view styles (host DOM)
    panel.css             panel styles
tests/  (mirrors src/, *.test.ts[x])
```

---

### Task 1: Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `icon.svg`, `LICENSE`, `.gitignore`, `src/main.ts`, `src/core/html.ts`, `tests/core/html.test.ts`

**Interfaces:**
- Produces: `esc(s: string): string` in `src/core/html.ts`.

- [ ] **Step 1: Write config files**

`package.json`:
```json
{
  "name": "logseq-dataquery",
  "version": "0.1.0",
  "description": "Typed queries, scatter and bar charts, and a filter GUI for property blocks in Logseq",
  "license": "MIT",
  "type": "module",
  "main": "dist/index.html",
  "scripts": {
    "dev": "vite build --watch --mode development",
    "build": "tsc -b && vite build",
    "typecheck": "tsc -b",
    "test": "vitest run"
  },
  "logseq": {
    "id": "logseq-dataquery",
    "title": "Data Query",
    "icon": "./icon.svg"
  },
  "dependencies": {
    "@logseq/libs": "^0.0.17",
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  },
  "devDependencies": {
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.4",
    "jsdom": "^29.1.1",
    "typescript": "^7.0.2",
    "vite": "^8.1.5",
    "vitest": "^4.1.10"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] },
});
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Data Query</title></head>
  <body><div id="app"></div><script type="module" src="./src/main.ts"></script></body>
</html>
```

`icon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#0e7c86"/><g fill="#fff"><circle cx="20" cy="42" r="5"/><circle cx="32" cy="28" r="5"/><circle cx="46" cy="20" r="5"/></g><path d="M12 52h40M12 52V12" stroke="#fff" stroke-width="3" fill="none"/></svg>
```

`.gitignore`:
```
node_modules/
dist/
*.tsbuildinfo
```

`LICENSE`: standard MIT text, `Copyright (c) 2026 gyp0bt`.

`src/main.ts` (placeholder until Task 11):
```ts
import '@logseq/libs';

async function main(): Promise<void> {
  console.info('[dataquery] loaded');
}

logseq.ready(main).catch((e) => console.error('[dataquery] failed to start', e));
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: exits 0, `node_modules/@logseq/libs` exists.

- [ ] **Step 3: Write the failing test** `tests/core/html.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { esc } from '../../src/core/html';

describe('esc', () => {
  it('escapes HTML metacharacters', () => {
    expect(esc(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
  it('leaves plain text alone', () => {
    expect(esc('gre-thin 0.20')).toBe('gre-thin 0.20');
  });
});
```

- [ ] **Step 4: Run to see it fail**: `npx vitest run tests/core/html.test.ts` → FAIL (module not found).

- [ ] **Step 5: Implement** `src/core/html.ts`
```ts
const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for safe interpolation into HTML or SVG markup. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => MAP[c]);
}
```

- [ ] **Step 6: Verify**: `npx vitest run && npx tsc -b && npx vite build` → tests PASS, typecheck clean, `dist/index.html` exists.

- [ ] **Step 7: Commit**: `git add -A && git commit -m "chore: scaffold logseq-dataquery"`

---

### Task 2: Block text parsing

**Files:**
- Create: `src/core/text.ts`, `tests/core/text.test.ts`

**Interfaces:**
- Produces: `isBuiltinKey(key: string): boolean`; `interface ParsedContent { props: Record<string, string>; title: string }`; `parseContent(content: string): ParsedContent` (keys lower-cased, builtin keys and empty values dropped, first key wins).

- [ ] **Step 1: Write the failing test** `tests/core/text.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { isBuiltinKey, parseContent } from '../../src/core/text';

describe('parseContent', () => {
  it('reads key:: value lines verbatim and the first non-property line as title', () => {
    const c = 'fsz-p8-o6\nrun:: fsz-p8-o6\npatch:: 8/16\ngre-thin:: 0.20\nseed:: 0';
    expect(parseContent(c)).toEqual({
      title: 'fsz-p8-o6',
      props: { run: 'fsz-p8-o6', patch: '8/16', 'gre-thin': '0.20', seed: '0' },
    });
  });
  it('drops builtin keys and empty values, lower-cases keys, keeps first duplicate', () => {
    const c = 'Title\nid:: 6512\ncollapsed:: true\nquery-table:: true\nEmpty::\nA:: 1\na:: 2';
    expect(parseContent(c).props).toEqual({ a: '1' });
  });
  it('strips heading markers from the title and ignores fenced code', () => {
    const c = '## Result\n```\nfake:: 1\n```\nk:: v';
    expect(parseContent(c)).toEqual({ title: 'Result', props: { k: 'v' } });
  });
  it('accepts wildcard keys (types page)', () => {
    expect(parseContent('gre-*:: ratio').props).toEqual({ 'gre-*': 'ratio' });
  });
});

describe('isBuiltinKey', () => {
  it('knows Logseq keys and prefixes', () => {
    for (const k of ['id', 'collapsed', 'heading', 'query-properties', 'card-next-schedule', 'hl-page', 'logseq.order-list-type'])
      expect(isBuiltinKey(k)).toBe(true);
    expect(isBuiltinKey('seed')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see it fail**: `npx vitest run tests/core/text.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/core/text.ts`
```ts
const PROP_LINE = /^\s*([A-Za-z0-9_*][A-Za-z0-9_.*-]*)::(?:\s+(.*))?\s*$/;

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
      const key = m[1].toLowerCase();
      const value = (m[2] ?? '').trim();
      if (value !== '' && !isBuiltinKey(key) && !(key in props)) props[key] = value;
      continue;
    }
    if (!title && line.trim()) title = line.trim().replace(/^#+\s*/, '');
  }
  return { props, title };
}
```

- [ ] **Step 4: Verify**: `npx vitest run tests/core/text.test.ts` → PASS.

- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(core): parse property lines from raw block text"`

---

### Task 3: Value types

**Files:**
- Create: `src/core/types.ts`, `tests/core/types.test.ts`

**Interfaces:**
- Produces:
  - `type ValueType = 'number' | 'numlist' | 'string' | 'category' | 'ratio'`; `VALUE_TYPES: readonly ValueType[]`
  - `isNumberText(s)`, `isNumListText(s)`, `toNumber(s?: string): number` (NaN if not numeric), `toList(s?: string): number[] | null`
  - `inferType(values: string[]): ValueType`, `isNumericType(t): boolean` (number|ratio)
  - `interface TypeOverrides { exact: Record<string, ValueType>; patterns: Array<{ pattern: string; re: RegExp; type: ValueType }>; warnings: string[] }`
  - `emptyOverrides()`, `parseTypeOverrides(props: Record<string,string>): TypeOverrides`, `resolveType(key, inferred, ov): ValueType`
  - `compareValues(t, a?: string, b?: string): number` (missing sorts after present), `valuesEqual(t, a: string | undefined, b: string): boolean`

- [ ] **Step 1: Write the failing test** `tests/core/types.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import {
  compareValues, inferType, parseTypeOverrides, resolveType, toList, toNumber, valuesEqual,
} from '../../src/core/types';

describe('inferType', () => {
  it('numbers, including exponent and sign', () => expect(inferType(['0.20', '15000', '-1e-3', '+.5'])).toBe('number'));
  it('numlist when any value has slashes and all parts are numeric', () => expect(inferType(['8', '8/16', '8/16/32'])).toBe('numlist'));
  it('string otherwise', () => expect(inferType(['8/16', 'pool'])).toBe('string'));
  it('string for no values', () => expect(inferType([])).toBe('string'));
});

describe('toNumber / toList', () => {
  it('parses', () => {
    expect(toNumber('0.20')).toBe(0.2);
    expect(toNumber('pool')).toBeNaN();
    expect(toNumber(undefined)).toBeNaN();
    expect(toList('8/16')).toEqual([8, 16]);
    expect(toList('8')).toEqual([8]);
    expect(toList('a/b')).toBeNull();
  });
});

describe('overrides', () => {
  const ov = parseTypeOverrides({ seed: 'category', 'gre-*': 'ratio', 'gre-thin-*': 'number', bogus: 'float' });
  it('exact beats patterns, longer pattern beats shorter, else inferred', () => {
    expect(resolveType('seed', 'number', ov)).toBe('category');
    expect(resolveType('gre-thick', 'number', ov)).toBe('ratio');
    expect(resolveType('gre-thin-x', 'number', ov)).toBe('number');
    expect(resolveType('grids', 'number', ov)).toBe('number');
  });
  it('warns on unknown type names', () => {
    expect(ov.warnings).toEqual([
      "Unknown type 'float' for 'bogus' on the types page. Use one of: number, numlist, string, category, ratio.",
    ]);
  });
});

describe('compareValues', () => {
  it('numeric compare for number/ratio/category-of-numbers', () => {
    expect(compareValues('number', '10', '9')).toBeGreaterThan(0);
    expect(compareValues('ratio', '0.20', '0.3')).toBeLessThan(0);
    expect(compareValues('category', '2', '10')).toBeLessThan(0);
  });
  it('numlist compares element by element', () => {
    expect(compareValues('numlist', '8/16', '8/32')).toBeLessThan(0);
    expect(compareValues('numlist', '8', '8/16')).toBeLessThan(0);
    expect(compareValues('numlist', '16', '8/16')).toBeGreaterThan(0);
  });
  it('missing sorts after present', () => {
    expect(compareValues('number', undefined, '1')).toBeGreaterThan(0);
    expect(compareValues('number', '1', undefined)).toBeLessThan(0);
    expect(compareValues('number', undefined, undefined)).toBe(0);
  });
  it('strings compare by code point', () => expect(compareValues('string', 'gate', 'mean')).toBeLessThan(0));
});

describe('valuesEqual', () => {
  it('numerically equal texts are equal', () => {
    expect(valuesEqual('number', '0.20', '0.2')).toBe(true);
    expect(valuesEqual('ratio', '1', '1.00')).toBe(true);
    expect(valuesEqual('numlist', '8/16', '8/16.0')).toBe(true);
    expect(valuesEqual('numlist', '8/16', '8')).toBe(false);
  });
  it('strings compare exactly; missing never equals', () => {
    expect(valuesEqual('string', 'mean', 'mean')).toBe(true);
    expect(valuesEqual('string', undefined, 'mean')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see it fail**: `npx vitest run tests/core/types.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/core/types.ts`
```ts
export type ValueType = 'number' | 'numlist' | 'string' | 'category' | 'ratio';
export const VALUE_TYPES: readonly ValueType[] = ['number', 'numlist', 'string', 'category', 'ratio'];

const NUM = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export const isNumberText = (s: string): boolean => NUM.test(s.trim());
export const isNumListText = (s: string): boolean => s.includes('/') && s.split('/').every(isNumberText);
export const isNumericType = (t: ValueType): boolean => t === 'number' || t === 'ratio';

export function toNumber(s: string | undefined): number {
  return s !== undefined && isNumberText(s) ? Number(s) : NaN;
}

export function toList(s: string | undefined): number[] | null {
  if (s === undefined) return null;
  if (isNumberText(s)) return [Number(s)];
  if (isNumListText(s)) return s.split('/').map(Number);
  return null;
}

export function inferType(values: string[]): ValueType {
  if (values.length === 0) return 'string';
  if (values.every(isNumberText)) return 'number';
  if (values.every((v) => isNumberText(v) || isNumListText(v))) return 'numlist';
  return 'string';
}

export interface TypeOverrides {
  exact: Record<string, ValueType>;
  patterns: Array<{ pattern: string; re: RegExp; type: ValueType }>;
  warnings: string[];
}

export const emptyOverrides = (): TypeOverrides => ({ exact: {}, patterns: [], warnings: [] });

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const globToRegExp = (p: string) => new RegExp('^' + p.split('*').map(escapeRe).join('.*') + '$');

/** Build overrides from the types page properties (`key:: type`, `prefix-*:: type`). */
export function parseTypeOverrides(props: Record<string, string>): TypeOverrides {
  const out = emptyOverrides();
  for (const [key, raw] of Object.entries(props)) {
    const t = raw.trim().toLowerCase() as ValueType;
    if (!VALUE_TYPES.includes(t)) {
      out.warnings.push(`Unknown type '${raw}' for '${key}' on the types page. Use one of: ${VALUE_TYPES.join(', ')}.`);
      continue;
    }
    if (key.includes('*')) out.patterns.push({ pattern: key, re: globToRegExp(key), type: t });
    else out.exact[key] = t;
  }
  out.patterns.sort((a, b) => b.pattern.length - a.pattern.length);
  return out;
}

export function resolveType(key: string, inferred: ValueType, ov: TypeOverrides): ValueType {
  if (key in ov.exact) return ov.exact[key];
  return ov.patterns.find((p) => p.re.test(key))?.type ?? inferred;
}

const cmp = <T extends number | string>(a: T, b: T): number => (a < b ? -1 : a > b ? 1 : 0);

/** Order two property texts by type; a missing value always sorts after a present one. */
export function compareValues(t: ValueType, a: string | undefined, b: string | undefined): number {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
  if (t === 'numlist') {
    const x = toList(a);
    const y = toList(b);
    if (x && y) {
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const c = cmp(x[i], y[i]);
        if (c) return c;
      }
      return cmp(x.length, y.length);
    }
    if (x || y) return x ? -1 : 1;
    return cmp(a, b);
  }
  if (t !== 'string') {
    const x = toNumber(a);
    const y = toNumber(b);
    if (!isNaN(x) && !isNaN(y)) return cmp(x, y);
    if (!isNaN(x) || !isNaN(y)) return isNaN(x) ? 1 : -1;
  }
  return cmp(a, b);
}

/** Equality as the user means it: `0.20` equals `0.2` for numeric types. */
export function valuesEqual(t: ValueType, a: string | undefined, b: string): boolean {
  if (a === undefined) return false;
  if (t === 'numlist') {
    const x = toList(a);
    const y = toList(b);
    if (x && y) return x.length === y.length && x.every((v, i) => v === y[i]);
    return a === b;
  }
  if (t !== 'string') {
    const x = toNumber(a);
    const y = toNumber(b);
    if (!isNaN(x) && !isNaN(y)) return x === y;
  }
  return a === b;
}
```

- [ ] **Step 4: Verify**: `npx vitest run tests/core/types.test.ts` → PASS.

- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(core): value types, inference, overrides and typed comparison"`

---

### Task 4: DSL parse / print

**Files:**
- Create: `src/core/dsl.ts`, `tests/core/dsl.test.ts`

**Interfaces:**
- Consumes: `isNumberText` from `types.ts`.
- Produces:
```ts
export type CmpOp = '=' | '!=' | '<' | '<=' | '>' | '>=';
export type Scope = { kind: 'here' } | { kind: 'page' } | { kind: 'ref'; page: string };
export type Cond =
  | { kind: 'cmp'; key: string; op: CmpOp; value: string }
  | { kind: 'in'; key: string; values: string[] }
  | { kind: 'has'; key: string; value: string };
export interface SortKey { key: string; desc: boolean }
export type ScatterPlot = { kind: 'scatter'; x: string; y: string; color?: string; labels: boolean };
export type BarPlot = { kind: 'bar'; x: string; ys: string[] };
export type Plot = ScatterPlot | BarPlot;
export interface Query { scope: Scope; mergeBy?: string; where: Cond[]; sort: SortKey[]; cols?: string[]; plot?: Plot }
export interface DslError { message: string; col: number }   // col = 0-based offset into the text
export type ParseResult = { ok: true; query: Query } | { ok: false; error: DslError };
export function emptyQuery(): Query;
export function parseDsl(text: string): ParseResult;
export function printDsl(q: Query): string;
export function printCond(c: Cond): string;
export function joinMacroArgs(args: string[]): string;
```

- [ ] **Step 1: Write the failing test** `tests/core/dsl.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { emptyQuery, joinMacroArgs, parseDsl, printDsl, type Query } from '../../src/core/dsl';

const ok = (t: string): Query => {
  const r = parseDsl(t);
  if (!r.ok) throw new Error(`unexpected error: ${r.error.message} @${r.error.col}`);
  return r.query;
};
const err = (t: string) => {
  const r = parseDsl(t);
  if (r.ok) throw new Error('expected an error');
  return r.error;
};

describe('parseDsl', () => {
  it('empty text is the empty query', () => expect(ok('  ')).toEqual(emptyQuery()));

  it('parses every clause', () => {
    expect(
      ok('in [[work/nsb]] | merge by run | where type = run and gre-thin < 1.3 and combine in (none, mean) and patch has 16 and section = "8 cells, seed" | sort r2-thin desc, seed | cols run, gre-* | plot scatter x=gre-thin y=gre-thick color=seed labels=off'),
    ).toEqual({
      scope: { kind: 'ref', page: 'work/nsb' },
      mergeBy: 'run',
      where: [
        { kind: 'cmp', key: 'type', op: '=', value: 'run' },
        { kind: 'cmp', key: 'gre-thin', op: '<', value: '1.3' },
        { kind: 'in', key: 'combine', values: ['none', 'mean'] },
        { kind: 'has', key: 'patch', value: '16' },
        { kind: 'cmp', key: 'section', op: '=', value: '8 cells, seed' },
      ],
      sort: [{ key: 'r2-thin', desc: true }, { key: 'seed', desc: false }],
      cols: ['run', 'gre-*'],
      plot: { kind: 'scatter', x: 'gre-thin', y: 'gre-thick', color: 'seed', labels: false },
    });
  });

  it('parses bar plots and scopes', () => {
    expect(ok('in page | plot bar x=combine y=gre-thin,gre-thick').plot).toEqual({ kind: 'bar', x: 'combine', ys: ['gre-thin', 'gre-thick'] });
    expect(ok('in here').scope).toEqual({ kind: 'here' });
    expect(ok('in page').scope).toEqual({ kind: 'page' });
  });

  it('lower-cases keys', () => expect(ok('where Seed = 1').where[0]).toEqual({ kind: 'cmp', key: 'seed', op: '=', value: '1' }));

  it('survives Logseq comma splitting (Review Focus 1)', () => {
    const original = 'where combine in (none,mean) | sort a,b desc | plot bar x=combine y=gre-thin,gre-thick';
    const split = original.split(',').map((s) => s.trim());
    expect(ok(joinMacroArgs(split))).toEqual(ok(original));
  });

  it('reports errors with a position', () => {
    expect(err('where gre-thin < | sort a')).toEqual({ message: "Missing value after '<'. Example: gre-thin < 1.3", col: 16 });
    expect(err('frm run')).toEqual({ message: "Unknown clause 'frm'. Use in, merge, where, sort, cols or plot.", col: 0 });
    expect(err('where a < b').message).toBe("'<' compares numbers, got 'b'.");
    expect(err('where a = 1 | where b = 2').message).toBe("Duplicate 'where' clause. Combine them into one.");
    expect(err('where combine in none').message).toBe("Write 'in' values in parentheses, e.g. combine in (none, mean).");
    expect(err('where a = 1 and').message).toBe("Cannot read condition 'a = 1 and'. Example: gre-thin < 1.3");
    expect(err('plot scatter x=a').message).toBe('plot scatter needs y=.');
    expect(err('plot pie x=a').message).toBe("Unknown plot 'pie'. Use scatter or bar.");
    expect(err('plot bar x=a y=b color=c').message).toBe("'color=' is not an option of plot bar. Use x=, y=.");
    expect(err('in everywhere').message).toBe("'in' takes here, page or [[Page name]].");
    expect(err('merge run').message).toBe("Write 'merge by <key>', e.g. merge by run.");
    expect(err('a | | b').col).toBe(4);
    expect(err('where patch has x').message).toBe("'has' takes a number, got 'x'.");
  });
});

describe('printDsl', () => {
  it('prints canonical text that parses back to the same query', () => {
    const texts = [
      '',
      'in page',
      'in [[work/nsb]] | merge by run | where type = run and gre-thin <= 1.3 and combine in (none, mean) and patch has 16 | sort r2-thin desc, seed | cols run, gre-* | plot scatter x=gre-thin y=gre-thick color=seed labels=off',
      'where section = "8 cells, seed" and note != "" | plot bar x=combine y=a,b',
      'plot scatter x=a y=b',
    ];
    for (const t of texts) {
      const q = ok(t);
      expect(ok(printDsl(q))).toEqual(q);
    }
    expect(printDsl(ok('in here | plot scatter x=a y=b labels=on'))).toBe('plot scatter x=a y=b');
  });
});
```

Note on the `a = 1 and` case: the trailing ` and` has no whitespace after it, so it is not a separator; the whole text is one unreadable condition. Keep that message.

- [ ] **Step 2: Run to see it fail**: `npx vitest run tests/core/dsl.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/core/dsl.ts`
```ts
import { isNumberText } from './types';

export type CmpOp = '=' | '!=' | '<' | '<=' | '>' | '>=';
export type Scope = { kind: 'here' } | { kind: 'page' } | { kind: 'ref'; page: string };
export type Cond =
  | { kind: 'cmp'; key: string; op: CmpOp; value: string }
  | { kind: 'in'; key: string; values: string[] }
  | { kind: 'has'; key: string; value: string };
export interface SortKey { key: string; desc: boolean }
export type ScatterPlot = { kind: 'scatter'; x: string; y: string; color?: string; labels: boolean };
export type BarPlot = { kind: 'bar'; x: string; ys: string[] };
export type Plot = ScatterPlot | BarPlot;
export interface Query { scope: Scope; mergeBy?: string; where: Cond[]; sort: SortKey[]; cols?: string[]; plot?: Plot }
export interface DslError { message: string; col: number }
export type ParseResult = { ok: true; query: Query } | { ok: false; error: DslError };

export const emptyQuery = (): Query => ({ scope: { kind: 'here' }, where: [], sort: [] });

class DslSyntaxError extends Error {
  constructor(message: string, readonly col: number) {
    super(message);
  }
}

const KEY = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const PATTERN = /^[A-Za-z0-9_*][A-Za-z0-9_.*-]*$/;
const NUMERIC_OPS: CmpOp[] = ['<', '<=', '>', '>='];

type Piece = { s: string; at: number };

/** Hide quoted text and [[links]] so separators inside them are not seen. */
function mask(text: string): string {
  return text
    .replace(/"[^"]*"/g, (m) => '"' + '_'.repeat(m.length - 2) + '"')
    .replace(/\[\[[^\]]*\]\]/g, (m) => '[[' + '_'.repeat(m.length - 4) + ']]');
}

function piece(raw: string, at: number): Piece {
  return { s: raw.trim(), at: at + (raw.length - raw.trimStart().length) };
}

function splitOn(text: string, sep: RegExp, base: number): Piece[] {
  const flags = 'g' + (sep.flags.includes('i') ? 'i' : '');
  const out: Piece[] = [];
  let start = 0;
  for (const hit of mask(text).matchAll(new RegExp(sep.source, flags))) {
    out.push(piece(text.slice(start, hit.index), base + start));
    start = hit.index! + hit[0].length;
  }
  out.push(piece(text.slice(start), base + start));
  return out;
}

const unquote = (s: string) => (/^".*"$/.test(s) ? s.slice(1, -1) : s);

function key(s: string, at: number): string {
  if (!KEY.test(s)) throw new DslSyntaxError(`'${s}' is not a property key.`, at);
  return s.toLowerCase();
}

export function parseDsl(text: string): ParseResult {
  try {
    return { ok: true, query: parseOrThrow(text) };
  } catch (e) {
    if (e instanceof DslSyntaxError) return { ok: false, error: { message: e.message, col: e.col } };
    throw e;
  }
}

function parseOrThrow(text: string): Query {
  const q = emptyQuery();
  if (!text.trim()) return q;
  const seen = new Set<string>();
  for (const { s, at } of splitOn(text, /\|/, 0)) {
    if (!s) throw new DslSyntaxError("Empty clause between '|'. Remove the extra '|'.", at);
    const m = /^(\S+)\s*([\s\S]*)$/.exec(s)!;
    const head = m[1].toLowerCase();
    const rest = m[2];
    const restAt = at + s.length - rest.length;
    if (seen.has(head)) throw new DslSyntaxError(`Duplicate '${head}' clause. Combine them into one.`, at);
    seen.add(head);
    switch (head) {
      case 'in': q.scope = parseScope(rest, restAt); break;
      case 'merge': q.mergeBy = parseMerge(rest, restAt); break;
      case 'where': q.where = parseWhere(rest, restAt); break;
      case 'sort': q.sort = parseSort(rest, restAt); break;
      case 'cols': q.cols = parseCols(rest, restAt); break;
      case 'plot': q.plot = parsePlot(rest, restAt); break;
      default:
        throw new DslSyntaxError(`Unknown clause '${m[1]}'. Use in, merge, where, sort, cols or plot.`, at);
    }
  }
  return q;
}

function parseScope(rest: string, at: number): Scope {
  const r = rest.trim();
  if (r === 'here') return { kind: 'here' };
  if (r === 'page') return { kind: 'page' };
  const m = /^\[\[(.+)\]\]$/.exec(r);
  if (m) return { kind: 'ref', page: m[1].trim() };
  throw new DslSyntaxError("'in' takes here, page or [[Page name]].", at);
}

function parseMerge(rest: string, at: number): string {
  const m = /^by\s+(\S+)$/i.exec(rest.trim());
  if (!m) throw new DslSyntaxError("Write 'merge by <key>', e.g. merge by run.", at);
  return key(m[1], at + rest.indexOf(m[1]));
}

function parseWhere(rest: string, at: number): Cond[] {
  if (!rest.trim()) throw new DslSyntaxError("'where' needs a condition, e.g. where gre-thin < 1.3.", at);
  return splitOn(rest, /\s+and\s+/i, at).map(({ s, at: a }) => parseCond(s, a));
}

function parseCond(s: string, at: number): Cond {
  if (!s) throw new DslSyntaxError("A condition is missing around 'and'.", at);
  let m: RegExpExecArray | null;
  if ((m = /^(\S+)\s+in\s*\(([\s\S]*)\)$/i.exec(s))) {
    const k = key(m[1], at);
    const values = splitOn(m[2], /,/, at + s.indexOf('(') + 1).map((p) => {
      if (!p.s) throw new DslSyntaxError("Empty value in 'in (...)'.", p.at);
      return unquote(p.s);
    });
    return { kind: 'in', key: k, values };
  }
  if ((m = /^(\S+)\s+in\b/i.exec(s)))
    throw new DslSyntaxError("Write 'in' values in parentheses, e.g. combine in (none, mean).", at + m[0].length);
  if ((m = /^(\S+)\s+has\s+(\S+)$/i.exec(s))) {
    const k = key(m[1], at);
    if (!isNumberText(m[2])) throw new DslSyntaxError(`'has' takes a number, got '${m[2]}'.`, at + s.lastIndexOf(m[2]));
    return { kind: 'has', key: k, value: m[2] };
  }
  if ((m = /^([^\s<>=!]+)\s*(<=|>=|!=|=|<|>)\s*([\s\S]*)$/.exec(s))) {
    const k = key(m[1], at);
    const op = m[2] as CmpOp;
    const raw = m[3].trim();
    if (!raw) throw new DslSyntaxError(`Missing value after '${op}'. Example: ${k} ${op} 1.3`, at + s.length);
    const value = unquote(raw);
    if (NUMERIC_OPS.includes(op) && !isNumberText(value))
      throw new DslSyntaxError(`'${op}' compares numbers, got '${raw}'.`, at + s.length - raw.length);
    return { kind: 'cmp', key: k, op, value };
  }
  throw new DslSyntaxError(`Cannot read condition '${s}'. Example: gre-thin < 1.3`, at);
}

function parseSort(rest: string, at: number): SortKey[] {
  if (!rest.trim()) throw new DslSyntaxError("'sort' needs a key, e.g. sort r2-thin desc.", at);
  return splitOn(rest, /,/, at).map(({ s, at: a }) => {
    const m = /^(\S+)(?:\s+(asc|desc))?$/i.exec(s);
    if (!m) throw new DslSyntaxError(`Cannot read sort key '${s}'. Write key or key desc.`, a);
    return { key: key(m[1], a), desc: (m[2] ?? '').toLowerCase() === 'desc' };
  });
}

function parseCols(rest: string, at: number): string[] {
  if (!rest.trim()) throw new DslSyntaxError("'cols' needs at least one key.", at);
  return splitOn(rest, /,/, at).map(({ s, at: a }) => {
    if (!PATTERN.test(s)) throw new DslSyntaxError(`'${s}' is not a property key or pattern.`, a);
    return s.toLowerCase();
  });
}

function parsePlot(rest: string, at: number): Plot {
  // Logseq's comma splitting turns `y=a,b` into `y=a, b`; glue list items back together.
  const glued = rest.replace(/\s*,\s*/g, ',');
  const toks = splitOn(glued, /\s+/, at).filter((t) => t.s);
  if (!toks.length) throw new DslSyntaxError("'plot' needs scatter or bar.", at);
  const kind = toks[0].s.toLowerCase();
  if (kind !== 'scatter' && kind !== 'bar') throw new DslSyntaxError(`Unknown plot '${toks[0].s}'. Use scatter or bar.`, toks[0].at);
  const allowed = kind === 'scatter' ? ['x', 'y', 'color', 'labels'] : ['x', 'y'];
  const opts: Record<string, Piece> = {};
  for (const t of toks.slice(1)) {
    const eq = t.s.indexOf('=');
    if (eq <= 0) throw new DslSyntaxError(`Write plot options as name=value, got '${t.s}'.`, t.at);
    const name = t.s.slice(0, eq).toLowerCase();
    if (!allowed.includes(name))
      throw new DslSyntaxError(`'${name}=' is not an option of plot ${kind}. Use ${allowed.map((a) => a + '=').join(', ')}.`, t.at);
    const v = t.s.slice(eq + 1);
    if (!v) throw new DslSyntaxError(`Missing value after '${name}='.`, t.at + eq + 1);
    opts[name] = { s: v, at: t.at + eq + 1 };
  }
  for (const need of ['x', 'y']) if (!opts[need]) throw new DslSyntaxError(`plot ${kind} needs ${need}=.`, at + rest.length);
  if (kind === 'bar') {
    return { kind, x: key(opts.x.s, opts.x.at), ys: splitOn(opts.y.s, /,/, opts.y.at).map((p) => key(p.s, p.at)) };
  }
  const labels = opts.labels?.s.toLowerCase();
  if (labels !== undefined && labels !== 'on' && labels !== 'off')
    throw new DslSyntaxError('labels= takes on or off.', opts.labels.at);
  const plot: ScatterPlot = { kind, x: key(opts.x.s, opts.x.at), y: key(opts.y.s, opts.y.at), labels: labels !== 'off' };
  if (opts.color) plot.color = key(opts.color.s, opts.color.at);
  return plot;
}

const quote = (v: string) => (v === '' || /[\s,|()"]/.test(v) || /^and$/i.test(v) ? `"${v}"` : v);

export function printCond(c: Cond): string {
  if (c.kind === 'in') return `${c.key} in (${c.values.map(quote).join(', ')})`;
  if (c.kind === 'has') return `${c.key} has ${c.value}`;
  return `${c.key} ${c.op} ${quote(c.value)}`;
}

/** Canonical one-line form. parseDsl(printDsl(q)) equals q. */
export function printDsl(q: Query): string {
  const parts: string[] = [];
  if (q.scope.kind === 'page') parts.push('in page');
  if (q.scope.kind === 'ref') parts.push(`in [[${q.scope.page}]]`);
  if (q.mergeBy) parts.push(`merge by ${q.mergeBy}`);
  if (q.where.length) parts.push('where ' + q.where.map(printCond).join(' and '));
  if (q.sort.length) parts.push('sort ' + q.sort.map((s) => s.key + (s.desc ? ' desc' : '')).join(', '));
  if (q.cols?.length) parts.push('cols ' + q.cols.join(', '));
  const p = q.plot;
  if (p?.kind === 'scatter')
    parts.push(`plot scatter x=${p.x} y=${p.y}` + (p.color ? ` color=${p.color}` : '') + (p.labels ? '' : ' labels=off'));
  if (p?.kind === 'bar') parts.push(`plot bar x=${p.x} y=${p.ys.join(',')}`);
  return parts.join(' | ');
}

/** Logseq hands renderer arguments split on commas; put them back together. */
export function joinMacroArgs(args: string[]): string {
  return args.map((a) => a.trim()).join(', ');
}
```

- [ ] **Step 4: Verify**: `npx vitest run tests/core/dsl.test.ts` → PASS. If an error-position expectation is off by a character, fix the implementation's offset arithmetic, not the test (positions are what the caret shows).

- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(core): DSL parser and canonical printer"`

---

### Task 5: Rows and merge

**Files:**
- Create: `src/core/rows.ts`, `tests/core/rows.test.ts`

**Interfaces:**
- Consumes: `parseContent` (Task 2), `isNumberText` (Task 3).
- Produces:
```ts
export interface SourceBlock { uuid: string; content: string; page: string; pageTitle: string; journalDay: number | null; pathRefs: string[]; preBlock: boolean }
  // page = lower-cased page name; pathRefs = lower-cased page names
export interface Source { uuid: string; pageTitle: string; journalDay: number | null }
export interface Conflict { value: string; pageTitle: string }
export interface Row { id: string; title: string; values: Record<string, string>; sources: Source[]; conflicts: Record<string, Conflict[]> }
export function blockToRow(b: SourceBlock): Row | null;
export function comparePriority(a: Source, b: Source): number;
export function mergeRows(rows: Row[], key: string): Row[];
export function rowLabel(row: Row, mergeBy?: string): string;
```

- [ ] **Step 1: Write the failing test** `tests/core/rows.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { blockToRow, mergeRows, rowLabel, type Row, type SourceBlock } from '../../src/core/rows';

export const block = (uuid: string, content: string, over: Partial<SourceBlock> = {}): SourceBlock => ({
  uuid, content, page: 'p', pageTitle: 'P', journalDay: null, pathRefs: [], preBlock: false, ...over,
});
const row = (b: SourceBlock) => blockToRow(b) as Row;

describe('blockToRow', () => {
  it('needs at least one user property and skips pre-blocks', () => {
    expect(blockToRow(block('a', 'just text'))).toBeNull();
    expect(blockToRow(block('a', 'id:: 1\ncollapsed:: true'))).toBeNull();
    expect(blockToRow(block('a', 'k:: v', { preBlock: true }))).toBeNull();
    expect(row(block('a', 'T\nk:: v'))).toEqual({
      id: 'a', title: 'T', values: { k: 'v' },
      sources: [{ uuid: 'a', pageTitle: 'P', journalDay: null }], conflicts: {},
    });
  });
});

describe('mergeRows', () => {
  const older = row(block('old', 'run:: r1\ngre:: 1.72\nseed:: 0', { pageTitle: 'Sep 27th, 2026', journalDay: 20260927 }));
  const newer = row(block('new', 'run:: r1\ngre:: 1.27\nseed:: 0.0\nextra:: x', { pageTitle: 'Sep 28th, 2026', journalDay: 20260928 }));
  const page = row(block('pg', 'run:: r1\ngre:: 1.27', { pageTitle: 'Notes' }));
  const other = row(block('o', 'run:: r2\ngre:: 2'));
  const loose = row(block('l', 'gre:: 3'));

  it('keeps order of first appearance and leaves rows without the key alone', () => {
    const out = mergeRows([older, loose, other, newer], 'run');
    expect(out.map((r) => r.id)).toEqual(['new', 'l', 'o']);
  });
  it('newest journal wins, then non-journal pages; conflicts list every source', () => {
    const [m] = mergeRows([page, older, newer], 'run');
    expect(m.values).toEqual({ run: 'r1', gre: '1.27', seed: '0.0', extra: 'x' });
    expect(m.sources.map((s) => s.uuid)).toEqual(['new', 'old', 'pg']);
    expect(m.conflicts).toEqual({
      gre: [
        { value: '1.27', pageTitle: 'Sep 28th, 2026' },
        { value: '1.72', pageTitle: 'Sep 27th, 2026' },
        { value: '1.27', pageTitle: 'Notes' },
      ],
    });
  });
  it('numerically equal texts are not conflicts (Review Focus 2)', () => {
    const [m] = mergeRows([older, newer], 'run');
    expect(m.conflicts.seed).toBeUndefined();
  });
});

describe('rowLabel', () => {
  it('merge key, then title, then short id', () => {
    expect(rowLabel(row(block('abcdef123456', 'T\nrun:: r1')), 'run')).toBe('r1');
    expect(rowLabel(row(block('abcdef123456', 'T\nk:: v')))).toBe('T');
    expect(rowLabel(row(block('abcdef123456', 'k:: v')))).toBe('abcdef12');
  });
});
```

- [ ] **Step 2: Run to see it fail**: `npx vitest run tests/core/rows.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/core/rows.ts`
```ts
import { parseContent } from './text';
import { isNumberText } from './types';

export interface SourceBlock {
  uuid: string;
  content: string;
  page: string;
  pageTitle: string;
  journalDay: number | null;
  pathRefs: string[];
  preBlock: boolean;
}
export interface Source { uuid: string; pageTitle: string; journalDay: number | null }
export interface Conflict { value: string; pageTitle: string }
export interface Row {
  id: string;
  title: string;
  values: Record<string, string>;
  sources: Source[];
  conflicts: Record<string, Conflict[]>;
}

export function blockToRow(b: SourceBlock): Row | null {
  if (b.preBlock) return null;
  const { props, title } = parseContent(b.content);
  if (Object.keys(props).length === 0) return null;
  return {
    id: b.uuid,
    title,
    values: props,
    sources: [{ uuid: b.uuid, pageTitle: b.pageTitle, journalDay: b.journalDay }],
    conflicts: {},
  };
}

/** Newest journal first, then non-journal pages by title. */
export function comparePriority(a: Source, b: Source): number {
  if (a.journalDay !== null && b.journalDay !== null) return b.journalDay - a.journalDay;
  if (a.journalDay !== null) return -1;
  if (b.journalDay !== null) return 1;
  return a.pageTitle < b.pageTitle ? -1 : a.pageTitle > b.pageTitle ? 1 : 0;
}

const same = (a: string, b: string) => a === b || (isNumberText(a) && isNumberText(b) && Number(a) === Number(b));

export function mergeRows(rows: Row[], key: string): Row[] {
  const groups = new Map<string, Row[]>();
  const order: Array<Row | string> = [];
  for (const r of rows) {
    const k = r.values[key];
    if (k === undefined) {
      order.push(r);
      continue;
    }
    if (!groups.has(k)) {
      groups.set(k, []);
      order.push(k);
    }
    groups.get(k)!.push(r);
  }
  return order.map((x) => (typeof x === 'string' ? combine(groups.get(x)!) : x));
}

function combine(rows: Row[]): Row {
  if (rows.length === 1) return rows[0];
  const ranked = [...rows].sort((a, b) => comparePriority(a.sources[0], b.sources[0]));
  const values: Record<string, string> = {};
  const conflicts: Record<string, Conflict[]> = {};
  for (const r of ranked) for (const [k, v] of Object.entries(r.values)) if (!(k in values)) values[k] = v;
  for (const k of Object.keys(values)) {
    const seen = ranked
      .filter((r) => k in r.values)
      .map((r) => ({ value: r.values[k], pageTitle: r.sources[0].pageTitle }));
    if (seen.some((s) => !same(s.value, seen[0].value))) conflicts[k] = seen;
  }
  return { id: ranked[0].id, title: ranked[0].title, values, sources: ranked.map((r) => r.sources[0]), conflicts };
}

export function rowLabel(row: Row, mergeBy?: string): string {
  return (mergeBy && row.values[mergeBy]) || row.title || row.id.slice(0, 8);
}
```

- [ ] **Step 4: Verify**: `npx vitest run tests/core/rows.test.ts` → PASS.

- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(core): rows from blocks and opt-in merge with conflict detection"`

---

### Task 6: Query engine

**Files:**
- Create: `src/core/query.ts`, `tests/core/query.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
```ts
export interface QueryContext { blocks: SourceBlock[]; types: Record<string, ValueType>; macroUuid: string; macroPage: string; hereIds: Set<string> }
export interface QueryResult { scoped: Row[]; rows: Row[]; cols: string[]; types: Record<string, ValueType>; warnings: string[] }
export function computeTypes(blocks: SourceBlock[], ov: TypeOverrides): Record<string, ValueType>;
export function typeOf(types: Record<string, ValueType>, key: string): ValueType;  // default 'string'
export function matchCond(row: Row, c: Cond, types: Record<string, ValueType>): boolean;
export function runQuery(q: Query, ctx: QueryContext): QueryResult;
```
Semantics: pipeline is scope → merge → where → sort → cols. `scoped` = rows after scope+merge (before where), used by the panel for filter domains. Default `cols` = keys in first-appearance order over `scoped`, excluding `mergeBy` (the link column already shows it). Missing values: excluded by `<`/`<=`/`>`/`>=`/`=`/`in`/`has`, kept by `!=`.

- [ ] **Step 1: Write the failing test** `tests/core/query.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { parseDsl, type Query } from '../../src/core/dsl';
import { computeTypes, runQuery, type QueryContext } from '../../src/core/query';
import type { SourceBlock } from '../../src/core/rows';
import { emptyOverrides, parseTypeOverrides } from '../../src/core/types';

const b = (uuid: string, content: string, over: Partial<SourceBlock> = {}): SourceBlock => ({
  uuid, content, page: 'day', pageTitle: 'Day', journalDay: 20260928, pathRefs: ['work/nsb'], preBlock: false, ...over,
});
const q = (t: string): Query => {
  const r = parseDsl(t);
  if (!r.ok) throw new Error(r.error.message);
  return r.query;
};

const blocks = [
  b('m', '{{renderer :dataquery}}\nnote:: macro'),
  b('a', 'A\ntype:: run\nrun:: a\npatch:: 8\ngrids:: 1\ncombine:: none\nseed:: 0\ngre:: 1.27'),
  b('b', 'B\ntype:: run\nrun:: b\npatch:: 8/16\ngrids:: 2\ncombine:: mean\nseed:: 1\ngre:: 1.49'),
  b('c', 'C\ntype:: run\nrun:: c\npatch:: 8/16\ngrids:: 2\ncombine:: mean\nseed:: 2\ngre:: 0.20'),
  b('d', 'D\ntype:: run\nrun:: d\npatch:: 16\ngrids:: 1\ncombine:: none'),
  b('x', 'elsewhere\nk:: v', { page: 'other', pathRefs: [] }),
];
const types = computeTypes(blocks, parseTypeOverrides({ seed: 'category', 'gre*': 'ratio' }));
const ctx: QueryContext = { blocks, types, macroUuid: 'm', macroPage: 'day', hereIds: new Set(['m', 'a', 'b', 'c', 'd']) };
const ids = (t: string) => runQuery(q(t), ctx).rows.map((r) => r.id);

describe('computeTypes', () => {
  it('infers graph-wide and applies overrides', () => {
    expect(types).toMatchObject({ patch: 'numlist', grids: 'number', combine: 'string', seed: 'category', gre: 'ratio' });
    expect(computeTypes(blocks, emptyOverrides()).seed).toBe('number');
  });
});

describe('scope', () => {
  it('here excludes the macro block and outside blocks', () => expect(ids('')).toEqual(['a', 'b', 'c', 'd']));
  it('page', () => expect(ids('in page')).toEqual(['a', 'b', 'c', 'd']));
  it('ref uses path refs, case-insensitively', () => expect(ids('in [[Work/NSB]]')).toEqual(['a', 'b', 'c', 'd']));
});

describe('where', () => {
  it('numeric comparison, not string comparison', () => expect(ids('where gre < 1.3')).toEqual(['a', 'c']));
  it('numeric equality ignores formatting (Review Focus 2)', () => expect(ids('where gre = 0.2')).toEqual(['c']));
  it('in, has, and', () => {
    expect(ids('where combine in (mean, gate)')).toEqual(['b', 'c']);
    expect(ids('where patch has 16')).toEqual(['b', 'c', 'd']);
    expect(ids('where patch = 8/16 and seed = 2')).toEqual(['c']);
  });
  it('missing values (Review Focus 3)', () => {
    expect(ids('where gre >= 0')).toEqual(['a', 'b', 'c']);
    expect(ids('where seed != 1')).toEqual(['a', 'c', 'd']);
  });
});

describe('sort', () => {
  it('typed, missing last in both directions (Review Focus 3)', () => {
    expect(ids('sort gre')).toEqual(['c', 'a', 'b', 'd']);
    expect(ids('sort gre desc')).toEqual(['b', 'a', 'c', 'd']);
    expect(ids('sort patch, seed desc')).toEqual(['a', 'c', 'b', 'd']);
  });
});

describe('cols and warnings', () => {
  it('default cols in first-appearance order', () => {
    expect(runQuery(q(''), ctx).cols).toEqual(['type', 'run', 'patch', 'grids', 'combine', 'seed', 'gre']);
  });
  it('merge key is left out of cols; patterns expand', () => {
    expect(runQuery(q('merge by run'), ctx).cols).toEqual(['type', 'patch', 'grids', 'combine', 'seed', 'gre']);
    expect(runQuery(q('cols g*, run'), ctx).cols).toEqual(['grids', 'gre', 'run']);
  });
  it('warns about keys absent from the scope', () => {
    expect(runQuery(q('where nope = 1 | plot scatter x=gre y=zz'), ctx).warnings).toEqual([
      "No block in this scope has 'nope'.",
      "No block in this scope has 'zz'.",
    ]);
  });
  it('explains an empty scope', () => {
    const empty = { ...ctx, hereIds: new Set<string>() };
    expect(runQuery(q(''), empty).warnings).toEqual(['No blocks with properties in this scope.']);
  });
  it('scoped keeps pre-filter rows', () => {
    const r = runQuery(q('where gre < 1'), ctx);
    expect(r.rows.map((x) => x.id)).toEqual(['c']);
    expect(r.scoped.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
```

- [ ] **Step 2: Run to see it fail**: `npx vitest run tests/core/query.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/core/query.ts`
```ts
import type { Cond, Query, Scope, SortKey } from './dsl';
import { blockToRow, mergeRows, type Row, type SourceBlock } from './rows';
import { parseContent } from './text';
import {
  compareValues, inferType, resolveType, toList, toNumber, valuesEqual, type TypeOverrides, type ValueType,
} from './types';

export interface QueryContext {
  blocks: SourceBlock[];
  types: Record<string, ValueType>;
  macroUuid: string;
  macroPage: string;
  hereIds: Set<string>;
}
export interface QueryResult {
  scoped: Row[];
  rows: Row[];
  cols: string[];
  types: Record<string, ValueType>;
  warnings: string[];
}

export function computeTypes(blocks: SourceBlock[], ov: TypeOverrides): Record<string, ValueType> {
  const values = new Map<string, string[]>();
  for (const b of blocks) {
    if (b.preBlock) continue;
    for (const [k, v] of Object.entries(parseContent(b.content).props)) {
      if (!values.has(k)) values.set(k, []);
      values.get(k)!.push(v);
    }
  }
  const out: Record<string, ValueType> = {};
  for (const [k, vs] of values) out[k] = resolveType(k, inferType(vs), ov);
  return out;
}

export const typeOf = (types: Record<string, ValueType>, key: string): ValueType => types[key] ?? 'string';

function inScope(b: SourceBlock, scope: Scope, ctx: QueryContext): boolean {
  if (b.uuid === ctx.macroUuid) return false;
  if (scope.kind === 'here') return ctx.hereIds.has(b.uuid);
  if (scope.kind === 'page') return b.page === ctx.macroPage;
  return b.pathRefs.includes(scope.page.toLowerCase());
}

export function matchCond(row: Row, c: Cond, types: Record<string, ValueType>): boolean {
  const t = typeOf(types, c.key);
  const v = row.values[c.key];
  if (c.kind === 'in') return c.values.some((x) => valuesEqual(t, v, x));
  if (c.kind === 'has') return toList(v)?.includes(Number(c.value)) ?? false;
  if (c.op === '=') return valuesEqual(t, v, c.value);
  if (c.op === '!=') return !valuesEqual(t, v, c.value);
  const x = toNumber(v);
  const y = Number(c.value);
  if (isNaN(x)) return false;
  return c.op === '<' ? x < y : c.op === '<=' ? x <= y : c.op === '>' ? x > y : x >= y;
}

function sortRows(rows: Row[], sort: SortKey[], types: Record<string, ValueType>): Row[] {
  return [...rows].sort((a, b) => {
    for (const s of sort) {
      const va = a.values[s.key];
      const vb = b.values[s.key];
      const c = compareValues(typeOf(types, s.key), va, vb);
      if (!c) continue;
      if (va === undefined || vb === undefined) return c;
      return s.desc ? -c : c;
    }
    return 0;
  });
}

function keysInOrder(rows: Row[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.values)) seen.add(k);
  return [...seen];
}

function expandCols(patterns: string[], present: string[]): string[] {
  const out: string[] = [];
  for (const p of patterns) {
    if (!p.includes('*')) out.push(p);
    else {
      const re = new RegExp('^' + p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      out.push(...present.filter((k) => re.test(k)));
    }
  }
  return [...new Set(out)];
}

function referencedKeys(q: Query): string[] {
  const keys = [...q.where.map((c) => c.key), ...q.sort.map((s) => s.key)];
  if (q.mergeBy) keys.push(q.mergeBy);
  if (q.plot?.kind === 'scatter') keys.push(q.plot.x, q.plot.y, ...(q.plot.color ? [q.plot.color] : []));
  if (q.plot?.kind === 'bar') keys.push(q.plot.x, ...q.plot.ys);
  keys.push(...(q.cols ?? []).filter((c) => !c.includes('*')));
  return [...new Set(keys)];
}

export function runQuery(q: Query, ctx: QueryContext): QueryResult {
  let scoped = ctx.blocks
    .filter((b) => inScope(b, q.scope, ctx))
    .map(blockToRow)
    .filter((r): r is Row => r !== null);
  if (q.mergeBy) scoped = mergeRows(scoped, q.mergeBy);
  let rows = scoped.filter((r) => q.where.every((c) => matchCond(r, c, ctx.types)));
  if (q.sort.length) rows = sortRows(rows, q.sort, ctx.types);
  const present = keysInOrder(scoped);
  const cols = (q.cols ? expandCols(q.cols, present) : present).filter((k) => k !== q.mergeBy);
  const warnings: string[] = [];
  if (!scoped.length) warnings.push('No blocks with properties in this scope.');
  else for (const k of referencedKeys(q)) if (!present.includes(k)) warnings.push(`No block in this scope has '${k}'.`);
  return { scoped, rows, cols, types: ctx.types, warnings };
}
```

- [ ] **Step 4: Verify**: `npx vitest run tests/core/query.test.ts` → PASS.

- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(core): scoped, typed query pipeline"`

---

### Task 7: Charts

**Files:**
- Create: `src/core/chart.ts`, `tests/core/chart.test.ts`

**Interfaces:**
- Consumes: `Row`, `rowLabel` (Task 5); `ScatterPlot`, `BarPlot` (Task 4); `ValueType`, `toNumber`, `compareValues`, `isNumericType` (Task 3); `esc` (Task 1).
- Produces:
```ts
export interface LegendItem { label: string; color: string; shape: 'dot' | 'square' | 'dash' | 'none' }
export interface Chart { html: string; legend: LegendItem[] }
export const PALETTE_SIZE = 8;
export function colorFor(i: number): string;             // 'var(--dq-c<i>)' or 'var(--dq-muted)'
export function niceTicks(lo: number, hi: number, count?: number): number[];
export function formatTick(v: number, step: number): string;
export function commonPrefix(labels: string[]): string;
export interface BarGroup { cat: string; n: number; stats: Array<{ mean: number; min: number; max: number } | null> }
export function barGroups(rows: Row[], plot: BarPlot, types: Record<string, ValueType>): BarGroup[];
export function scatterSvg(rows: Row[], plot: ScatterPlot, types: Record<string, ValueType>, mergeBy?: string): Chart;
export function barSvg(rows: Row[], plot: BarPlot, types: Record<string, ValueType>): Chart;
export function legendHtml(items: LegendItem[]): string;
```
Scatter points are `<circle class="dq-pt" data-uuid="<sources[0].uuid>" data-on-click="dqJump">` so the inline view (host) and the panel (event delegation on `[data-uuid]`) can both jump.

- [ ] **Step 1: Write the failing test** `tests/core/chart.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { barGroups, barSvg, colorFor, commonPrefix, formatTick, niceTicks, scatterSvg } from '../../src/core/chart';
import type { Row } from '../../src/core/rows';

const row = (id: string, values: Record<string, string>): Row => ({
  id, title: id, values, sources: [{ uuid: id, pageTitle: 'P', journalDay: null }], conflicts: {},
});
const rows = [
  row('fsz-a', { x: '1.27', y: '0.96', seed: '0', combine: 'none' }),
  row('fsz-b', { x: '1.51', y: '1.32', seed: '0', combine: 'mean' }),
  row('fsz-c', { x: '1.49', y: '1.96', seed: '1', combine: 'mean' }),
  row('fsz-d', { x: '1.29', y: '1.36', seed: '2', combine: 'mean' }),
  row('fsz-e', { x: 'n/a', y: '1', seed: '2', combine: 'gate' }),
];
const types = { x: 'ratio', y: 'ratio', seed: 'category', combine: 'string' } as const;

describe('ticks', () => {
  it('nice steps covering the range', () => {
    expect(niceTicks(0.96, 1.96)).toEqual([0.8, 1, 1.2, 1.4, 1.6, 1.8, 2]);
    expect(niceTicks(0, 16.42)).toEqual([0, 5, 10, 15, 20]);
    expect(niceTicks(3, 3)).toEqual([2, 2.5, 3, 3.5, 4]);
    expect(formatTick(1.2, 0.2)).toBe('1.2');
    expect(formatTick(1, 0.2)).toBe('1.0');
  });
  it('palette wraps to muted after 8', () => {
    expect(colorFor(0)).toBe('var(--dq-c0)');
    expect(colorFor(8)).toBe('var(--dq-muted)');
  });
  it('common prefix cuts at the last dash', () => {
    expect(commonPrefix(['fsz-p8-o6', 'fsz-p8-o6-seed1', 'fsz-ms'])).toBe('fsz-');
    expect(commonPrefix(['a'])).toBe('');
  });
});

describe('scatterSvg', () => {
  const c = scatterSvg(rows, { kind: 'scatter', x: 'x', y: 'y', color: 'seed', labels: true }, types);
  it('draws one point per numeric row, with jump hooks', () => {
    expect(c.html.match(/<circle /g)).toHaveLength(4);
    expect(c.html).toContain('data-uuid="fsz-a" data-on-click="dqJump"');
  });
  it('ratio axes get reference lines and a pass region', () => {
    expect(c.html.match(/class="dq-ref"/g)).toHaveLength(2);
    expect(c.html).toContain('class="dq-passzone"');
  });
  it('labels drop the common prefix; legend lists colours and the ratio line', () => {
    expect(c.html).toContain('>a</text>');
    expect(c.legend).toEqual([
      { label: 'seed = 0', color: 'var(--dq-c0)', shape: 'dot' },
      { label: 'seed = 1', color: 'var(--dq-c1)', shape: 'dot' },
      { label: 'seed = 2', color: 'var(--dq-c2)', shape: 'dot' },
      { label: 'ratio 1.00', color: 'var(--dq-fail)', shape: 'dash' },
      { label: "labels omit 'fsz-'", color: '', shape: 'none' },
    ]);
  });
  it('labels=off removes point labels', () => {
    const off = scatterSvg(rows, { kind: 'scatter', x: 'x', y: 'y', labels: false }, types);
    expect(off.html).not.toContain('class="dq-lbl"');
  });
  it('explains when nothing is plottable', () => {
    const none = scatterSvg(rows, { kind: 'scatter', x: 'combine', y: 'y', labels: true }, types);
    expect(none.html).toBe('<p class="dq-empty">No rows have numeric combine and y.</p>');
  });
});

describe('bar', () => {
  const plot = { kind: 'bar', x: 'combine', ys: ['x', 'y'] } as const;
  it('groups, sorts categories and computes mean/min/max', () => {
    const g = barGroups(rows, plot, types);
    expect(g.map((x) => [x.cat, x.n])).toEqual([['gate', 1], ['mean', 3], ['none', 1]]);
    expect(g[0].stats[0]).toBeNull();
    const mean = g[1].stats[0]!;
    expect(mean.min).toBe(1.29);
    expect(mean.max).toBe(1.51);
    expect(mean.mean).toBeCloseTo(1.43, 10);
  });
  it('whiskers only where n >= 2', () => {
    const c = barSvg(rows, plot, types);
    expect(c.html.match(/class="dq-whisker"/g)).toHaveLength(2);
    expect(c.html).toContain('n=3');
  });
});
```

- [ ] **Step 2: Run to see it fail**: `npx vitest run tests/core/chart.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/core/chart.ts`
```ts
import type { BarPlot, ScatterPlot } from './dsl';
import { esc } from './html';
import { rowLabel, type Row } from './rows';
import { compareValues, toNumber, type ValueType } from './types';

export interface LegendItem { label: string; color: string; shape: 'dot' | 'square' | 'dash' | 'none' }
export interface Chart { html: string; legend: LegendItem[] }
export interface BarGroup { cat: string; n: number; stats: Array<{ mean: number; min: number; max: number } | null> }

export const PALETTE_SIZE = 8;
export const colorFor = (i: number): string => (i < PALETTE_SIZE ? `var(--dq-c${i})` : 'var(--dq-muted)');

const W = 640, H = 360, L = 56, R = 16, T = 14, B = 48;
const PW = W - L - R, PH = H - T - B;
const NONE = '(none)';
const f1 = (n: number) => n.toFixed(1);

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!isFinite(lo) || !isFinite(hi)) return [0, 1];
  if (lo === hi) {
    const d = Math.abs(lo) || 1;
    lo -= d / 3;
    hi += d / 3;
  }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const r = raw / mag;
  const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step)
    out.push(Number(v.toPrecision(12)));
  return out;
}

export function formatTick(v: number, step: number): string {
  return v.toFixed(Math.min(6, Math.max(0, -Math.floor(Math.log10(step)))));
}

export function commonPrefix(labels: string[]): string {
  if (labels.length < 2) return '';
  let p = labels[0];
  for (const l of labels) while (!l.startsWith(p)) p = p.slice(0, -1);
  const cut = p.lastIndexOf('-');
  return cut >= 0 ? p.slice(0, cut + 1) : '';
}

function sortCats(cats: string[], t: ValueType): string[] {
  return [...cats].sort((a, b) => (a === NONE ? 1 : b === NONE ? -1 : compareValues(t, a, b)));
}

function axisTitle(key: string, t: ValueType | undefined): string {
  return esc(key) + (t === 'ratio' ? ' (ratio)' : '');
}

function frame(inner: string, label: string): string {
  return `<svg class="dq-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${inner}</svg>`;
}

const empty = (msg: string): Chart => ({ html: `<p class="dq-empty">${esc(msg)}</p>`, legend: [] });

export function scatterSvg(rows: Row[], plot: ScatterPlot, types: Record<string, ValueType>, mergeBy?: string): Chart {
  const pts = rows
    .map((r) => ({ r, x: toNumber(r.values[plot.x]), y: toNumber(r.values[plot.y]) }))
    .filter((p) => !isNaN(p.x) && !isNaN(p.y));
  if (!pts.length) return empty(`No rows have numeric ${plot.x} and ${plot.y}.`);
  const rx = types[plot.x] === 'ratio';
  const ry = types[plot.y] === 'ratio';
  const xs = pts.map((p) => p.x).concat(rx ? [1] : []);
  const ys = pts.map((p) => p.y).concat(ry ? [1] : []);
  const tx = niceTicks(Math.min(...xs), Math.max(...xs));
  const ty = niceTicks(Math.min(...ys), Math.max(...ys));
  const [x0, x1, y0, y1] = [tx[0], tx[tx.length - 1], ty[0], ty[ty.length - 1]];
  const X = (v: number) => L + ((v - x0) / (x1 - x0)) * PW;
  const Y = (v: number) => T + PH - ((v - y0) / (y1 - y0)) * PH;
  let g = '';
  if (rx && ry) g += `<rect class="dq-passzone" x="${f1(L)}" y="${f1(Y(1))}" width="${f1(X(1) - L)}" height="${f1(T + PH - Y(1))}"/>`;
  for (const v of tx)
    g += `<line class="dq-grid" x1="${f1(X(v))}" y1="${T}" x2="${f1(X(v))}" y2="${T + PH}"/><text class="dq-tick" x="${f1(X(v))}" y="${T + PH + 15}" text-anchor="middle">${formatTick(v, tx[1] - tx[0])}</text>`;
  for (const v of ty)
    g += `<line class="dq-grid" x1="${L}" y1="${f1(Y(v))}" x2="${L + PW}" y2="${f1(Y(v))}"/><text class="dq-tick" x="${L - 6}" y="${f1(Y(v) + 3.5)}" text-anchor="end">${formatTick(v, ty[1] - ty[0])}</text>`;
  g += `<line class="dq-axis" x1="${L}" y1="${T + PH}" x2="${L + PW}" y2="${T + PH}"/><line class="dq-axis" x1="${L}" y1="${T}" x2="${L}" y2="${T + PH}"/>`;
  if (rx) g += `<line class="dq-ref" x1="${f1(X(1))}" y1="${T}" x2="${f1(X(1))}" y2="${T + PH}"/>`;
  if (ry) g += `<line class="dq-ref" x1="${L}" y1="${f1(Y(1))}" x2="${L + PW}" y2="${f1(Y(1))}"/>`;
  g += `<text class="dq-title" x="${L + PW / 2}" y="${H - 8}" text-anchor="middle">${axisTitle(plot.x, types[plot.x])}</text>`;
  g += `<text class="dq-title" x="14" y="${T + PH / 2}" text-anchor="middle" transform="rotate(-90 14 ${T + PH / 2})">${axisTitle(plot.y, types[plot.y])}</text>`;

  const legend: LegendItem[] = [];
  const colorOf = new Map<string, string>();
  if (plot.color) {
    const cats = sortCats([...new Set(pts.map((p) => p.r.values[plot.color!] ?? NONE))], types[plot.color] ?? 'string');
    cats.forEach((c, i) => {
      colorOf.set(c, colorFor(i));
      legend.push({ label: `${plot.color} = ${c}`, color: colorFor(i), shape: 'dot' });
    });
  }
  const labels = pts.map((p) => rowLabel(p.r, mergeBy));
  const prefix = plot.labels ? commonPrefix(labels) : '';
  pts.forEach((p, i) => {
    const fill = plot.color ? colorOf.get(p.r.values[plot.color] ?? NONE)! : 'var(--dq-c0)';
    const cx = f1(X(p.x));
    const cy = f1(Y(p.y));
    g += `<circle class="dq-pt" cx="${cx}" cy="${cy}" r="5.5" fill="${fill}" data-uuid="${esc(p.r.sources[0].uuid)}" data-on-click="dqJump"><title>${esc(labels[i])}  ${esc(plot.x)}=${esc(p.r.values[plot.x])}  ${esc(plot.y)}=${esc(p.r.values[plot.y])}</title></circle>`;
    if (plot.labels) g += `<text class="dq-lbl" x="${f1(X(p.x) + 8)}" y="${f1(Y(p.y) + 3.5)}">${esc(labels[i].slice(prefix.length) || labels[i])}</text>`;
  });
  if (rx || ry) legend.push({ label: 'ratio 1.00', color: 'var(--dq-fail)', shape: 'dash' });
  if (prefix) legend.push({ label: `labels omit '${prefix}'`, color: '', shape: 'none' });
  return { html: frame(g, `${plot.y} against ${plot.x}`), legend };
}

export function barGroups(rows: Row[], plot: BarPlot, types: Record<string, ValueType>): BarGroup[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const c = r.values[plot.x] ?? NONE;
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(r);
  }
  return sortCats([...groups.keys()], types[plot.x] ?? 'string').map((cat) => {
    const rs = groups.get(cat)!;
    return {
      cat,
      n: rs.length,
      stats: plot.ys.map((k) => {
        const v = rs.map((r) => toNumber(r.values[k])).filter((x) => !isNaN(x));
        if (!v.length) return null;
        return { mean: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v) };
      }),
    };
  });
}

export function barSvg(rows: Row[], plot: BarPlot, types: Record<string, ValueType>): Chart {
  const groups = barGroups(rows, plot, types);
  const all = groups.flatMap((gr) => gr.stats.filter((s): s is NonNullable<typeof s> => s !== null));
  if (!all.length) return empty(`No rows have numeric ${plot.ys.join(', ')}.`);
  const anyRatio = plot.ys.some((k) => types[k] === 'ratio');
  const lo = Math.min(0, ...all.map((s) => s.min));
  const hi = Math.max(...all.map((s) => s.max), anyRatio ? 1 : -Infinity);
  const ty = niceTicks(lo, hi);
  const [y0, y1] = [ty[0], ty[ty.length - 1]];
  const Y = (v: number) => T + PH - ((v - y0) / (y1 - y0)) * PH;
  let g = '';
  for (const v of ty)
    g += `<line class="dq-grid" x1="${L}" y1="${f1(Y(v))}" x2="${L + PW}" y2="${f1(Y(v))}"/><text class="dq-tick" x="${L - 6}" y="${f1(Y(v) + 3.5)}" text-anchor="end">${formatTick(v, ty[1] - ty[0])}</text>`;
  const gw = PW / groups.length;
  const bw = Math.min(40, (gw * 0.8) / plot.ys.length);
  groups.forEach((gr, i) => {
    const cx = L + gw * (i + 0.5);
    const left = cx - (bw * plot.ys.length) / 2;
    gr.stats.forEach((s, j) => {
      if (!s) return;
      const x = left + j * bw;
      const top = Math.min(Y(s.mean), Y(0));
      g += `<rect class="dq-bar" x="${f1(x + 1)}" y="${f1(top)}" width="${f1(bw - 2)}" height="${f1(Math.abs(Y(0) - Y(s.mean)))}" fill="${colorFor(j)}"><title>${esc(gr.cat)} ${esc(plot.ys[j])}: mean ${s.mean.toPrecision(4)} (min ${s.min}, max ${s.max}, n=${gr.n})</title></rect>`;
      if (gr.n >= 2) {
        const m = f1(x + bw / 2);
        g += `<g class="dq-whisker"><line x1="${m}" y1="${f1(Y(s.max))}" x2="${m}" y2="${f1(Y(s.min))}"/><line x1="${f1(x + bw / 2 - 5)}" y1="${f1(Y(s.max))}" x2="${f1(x + bw / 2 + 5)}" y2="${f1(Y(s.max))}"/><line x1="${f1(x + bw / 2 - 5)}" y1="${f1(Y(s.min))}" x2="${f1(x + bw / 2 + 5)}" y2="${f1(Y(s.min))}"/></g>`;
      }
    });
    g += `<text class="dq-cat" x="${f1(cx)}" y="${T + PH + 16}" text-anchor="middle">${esc(gr.cat)}</text><text class="dq-tick" x="${f1(cx)}" y="${T + PH + 30}" text-anchor="middle">n=${gr.n}</text>`;
  });
  g += `<line class="dq-axis" x1="${L}" y1="${f1(Y(0))}" x2="${L + PW}" y2="${f1(Y(0))}"/><line class="dq-axis" x1="${L}" y1="${T}" x2="${L}" y2="${T + PH}"/>`;
  if (anyRatio) g += `<line class="dq-ref" x1="${L}" y1="${f1(Y(1))}" x2="${L + PW}" y2="${f1(Y(1))}"/>`;
  const legend: LegendItem[] = plot.ys.map((k, j) => ({ label: k, color: colorFor(j), shape: 'square' }));
  legend.push({ label: 'whiskers: min–max (n ≥ 2)', color: '', shape: 'none' });
  if (anyRatio) legend.push({ label: 'ratio 1.00', color: 'var(--dq-fail)', shape: 'dash' });
  return { html: frame(g, `${plot.ys.join(', ')} by ${plot.x}`), legend };
}

export function legendHtml(items: LegendItem[]): string {
  if (!items.length) return '';
  const mark = (i: LegendItem) =>
    i.shape === 'none' ? '' : `<i class="dq-mark dq-${i.shape}" style="${i.shape === 'dash' ? 'border-color' : 'background'}:${i.color}"></i>`;
  return `<div class="dq-legend">${items.map((i) => `<span>${mark(i)}${esc(i.label)}</span>`).join('')}</div>`;
}
```

- [ ] **Step 4: Verify**: `npx vitest run tests/core/chart.test.ts` → PASS. If a `niceTicks` expectation differs only by float noise, keep the `toPrecision(12)` rounding and fix the algorithm, not the expectation.

- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(core): SVG scatter and bar charts"`

---

### Task 8: Inline view HTML and styles

**Files:**
- Create: `src/core/view.ts`, `src/style/tokens.css`, `src/style/inline.css`, `tests/core/view.test.ts`

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces:
```ts
export interface InlineInput { macroUuid: string; dsl: string; parsed: ParseResult; result?: QueryResult; error?: string }
export function renderInline(input: InlineInput): string;
export function cellClass(t: ValueType, v: string | undefined): string;   // 'dq-pass' | 'dq-fail' | ''
export function tableHtml(result: QueryResult, q: Query): string;
```

- [ ] **Step 1: Write the failing test** `tests/core/view.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { parseDsl } from '../../src/core/dsl';
import type { QueryResult } from '../../src/core/query';
import type { Row } from '../../src/core/rows';
import { cellClass, renderInline } from '../../src/core/view';

const row = (id: string, values: Record<string, string>, conflicts: Row['conflicts'] = {}): Row => ({
  id, title: id, values, sources: [{ uuid: id, pageTitle: 'P', journalDay: null }], conflicts,
});
const result = (rows: Row[], cols: string[], warnings: string[] = []): QueryResult => ({
  scoped: rows, rows, cols, types: { gre: 'ratio', note: 'string', run: 'string' }, warnings,
});

describe('renderInline', () => {
  it('shows the DSL error with a caret under the column', () => {
    const dsl = 'where gre <';
    const html = renderInline({ macroUuid: 'm', dsl, parsed: parseDsl(dsl) });
    expect(html).toContain('class="dq dq-error"');
    expect(html).toContain('where gre &lt;\n           ^');
    expect(html).toContain('Missing value after');
  });

  it('shows a runtime failure message', () => {
    const html = renderInline({ macroUuid: 'm', dsl: '', parsed: parseDsl(''), error: 'Could not read blocks (cause: boom)' });
    expect(html).toContain('Data query failed: Could not read blocks (cause: boom)');
  });

  it('renders header, table and conflict notes', () => {
    const dsl = 'merge by run | sort gre';
    const rows = [
      row('a', { run: 'r1', gre: '0.96' }),
      row('b', { run: 'r2', gre: '1.27' }, { gre: [{ value: '1.27', pageTitle: 'Sep 28th' }, { value: '1.72', pageTitle: 'Sep 27th' }] }),
    ];
    const html = renderInline({ macroUuid: 'm', dsl, parsed: parseDsl(dsl), result: result(rows, ['gre']) });
    expect(html).toContain('data-on-click="dqOpen" data-macro="m"');
    expect(html).toContain('2 rows');
    expect(html).toContain('⚠ 1');
    expect(html).toContain('<th>run</th>');
    expect(html).toContain('data-on-click="dqJump" data-uuid="b"');
    expect(html).toContain('class="dq-num dq-pass"');
    expect(html).toContain('r2: gre is 1.27 (Sep 28th) / 1.72 (Sep 27th). Showing the first.');
    expect(html).not.toContain('dqToggleLabels');
  });

  it('offers the labels toggle only for scatter plots', () => {
    const dsl = 'plot scatter x=gre y=gre labels=off';
    const html = renderInline({ macroUuid: 'm', dsl, parsed: parseDsl(dsl), result: result([row('a', { gre: '1' })], ['gre']) });
    expect(html).toContain('data-on-click="dqToggleLabels" data-macro="m">Show labels</button>');
  });

  it('escapes property values everywhere (Review Focus 4)', () => {
    const evil = '<img src=x onerror=alert(1)>"&';
    const dsl = 'plot scatter x=gre y=gre color=note';
    const rows = [row('a', { gre: '1', note: evil }, { note: [{ value: evil, pageTitle: evil }, { value: 'b', pageTitle: 'P' }] })];
    const html = renderInline({ macroUuid: 'm', dsl, parsed: parseDsl(dsl), result: result(rows, ['note'], [evil]) });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;&amp;');
  });

  it('says so when nothing matches', () => {
    const html = renderInline({ macroUuid: 'm', dsl: '', parsed: parseDsl(''), result: result([], []) });
    expect(html).toContain('No rows match.');
  });
});

describe('cellClass', () => {
  it('ratio below 1 passes, 1 or above fails, others unstyled', () => {
    expect(cellClass('ratio', '0.99')).toBe('dq-pass');
    expect(cellClass('ratio', '1.00')).toBe('dq-fail');
    expect(cellClass('ratio', 'x')).toBe('');
    expect(cellClass('number', '0.5')).toBe('');
  });
});
```

- [ ] **Step 2: Run to see it fail**: `npx vitest run tests/core/view.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/core/view.ts`
```ts
import { barSvg, legendHtml, scatterSvg } from './chart';
import type { ParseResult, Query } from './dsl';
import { esc } from './html';
import type { QueryResult } from './query';
import { rowLabel } from './rows';
import { isNumericType, toNumber, type ValueType } from './types';

export interface InlineInput {
  macroUuid: string;
  dsl: string;
  parsed: ParseResult;
  result?: QueryResult;
  error?: string;
}

export function cellClass(t: ValueType, v: string | undefined): string {
  if (t !== 'ratio') return '';
  const n = toNumber(v);
  return isNaN(n) ? '' : n < 1 ? 'dq-pass' : 'dq-fail';
}

const alignRight = (t: ValueType) => isNumericType(t) || t === 'numlist';

export function tableHtml(result: QueryResult, q: Query): string {
  if (!result.rows.length) return '<p class="dq-empty">No rows match.</p>';
  const sorted = q.sort[0];
  const head = result.cols
    .map((k) => {
      const t = result.types[k] ?? 'string';
      const arrow = sorted?.key === k ? (sorted.desc ? ' ▼' : ' ▲') : '';
      return `<th class="${alignRight(t) ? 'dq-num' : ''}">${esc(k)}${arrow}<span class="dq-type">${t}</span></th>`;
    })
    .join('');
  const body = result.rows
    .map((r) => {
      const cells = result.cols
        .map((k) => {
          const t = result.types[k] ?? 'string';
          const v = r.values[k];
          const cls = [alignRight(t) ? 'dq-num' : '', cellClass(t, v), r.conflicts[k] ? 'dq-conflict' : ''].filter(Boolean).join(' ');
          return `<td class="${cls}">${esc(v ?? '')}${r.conflicts[k] ? '<sup>⚠</sup>' : ''}</td>`;
        })
        .join('');
      return `<tr><td class="dq-link" data-on-click="dqJump" data-uuid="${esc(r.sources[0].uuid)}">${esc(rowLabel(r, q.mergeBy))}</td>${cells}</tr>`;
    })
    .join('');
  return `<div class="dq-tbl"><table><thead><tr><th>${esc(q.mergeBy ?? 'block')}</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function conflictNotes(result: QueryResult, q: Query): string {
  const lines: string[] = [];
  for (const r of result.rows)
    for (const [k, list] of Object.entries(r.conflicts))
      lines.push(`⚠ ${esc(rowLabel(r, q.mergeBy))}: ${esc(k)} is ${list.map((c) => `${esc(c.value)} (${esc(c.pageTitle)})`).join(' / ')}. Showing the first.`);
  return lines.length ? `<div class="dq-conflicts">${lines.map((l) => `<p>${l}</p>`).join('')}</div>` : '';
}

export function renderInline(inp: InlineInput): string {
  if (!inp.parsed.ok) {
    const { message, col } = inp.parsed.error;
    return `<div class="dq dq-error"><pre>${esc(inp.dsl)}\n${' '.repeat(col)}^</pre><p>${esc(message)}</p></div>`;
  }
  if (inp.error || !inp.result) {
    return `<div class="dq dq-error"><p>Data query failed: ${esc(inp.error ?? 'no result')}</p></div>`;
  }
  const q = inp.parsed.query;
  const res = inp.result;
  const nConflicts = res.rows.filter((r) => Object.keys(r.conflicts).length).length;
  const uuid = esc(inp.macroUuid);
  const labelsBtn =
    q.plot?.kind === 'scatter'
      ? `<button class="dq-btn" data-on-click="dqToggleLabels" data-macro="${uuid}">${q.plot.labels ? 'Hide labels' : 'Show labels'}</button>`
      : '';
  const head = `<div class="dq-head"><code class="dq-dsl">${esc(inp.dsl) || 'all blocks with properties here'}</code><span class="dq-meta">${res.rows.length} rows${nConflicts ? ` · <span class="dq-warn">⚠ ${nConflicts}</span>` : ''}</span>${labelsBtn}<button class="dq-btn dq-open" data-on-click="dqOpen" data-macro="${uuid}">Open ↗</button></div>`;
  let chart = '';
  if (q.plot) {
    const c = q.plot.kind === 'scatter' ? scatterSvg(res.rows, q.plot, res.types, q.mergeBy) : barSvg(res.rows, q.plot, res.types);
    chart = `<div class="dq-chartbox">${c.html}${legendHtml(c.legend)}</div>`;
  }
  const notes = res.warnings.map((w) => `<p class="dq-note">${esc(w)}</p>`).join('');
  return `<div class="dq">${head}${chart}${tableHtml(res, q)}${conflictNotes(res, q)}${notes}</div>`;
}
```

- [ ] **Step 4: Write styles.**

`src/style/tokens.css` (shared by host and panel):
```css
:root {
  --dq-c0: #2f6fd6; --dq-c1: #d9822b; --dq-c2: #7a4fc9; --dq-c3: #2e9a6a;
  --dq-c4: #c9476b; --dq-c5: #8a7a2a; --dq-c6: #3b9bb8; --dq-c7: #7d5a45;
  --dq-fail: #c2412d; --dq-fail-bg: #fbe9e5; --dq-pass: #2e7d4f; --dq-pass-bg: #e5f3ea;
  --dq-warn: #b7791f; --dq-warn-bg: #fdf3dc;
  --dq-bg: var(--ls-primary-background-color, #ffffff);
  --dq-fg: var(--ls-primary-text-color, #1d2326);
  --dq-muted: var(--ls-secondary-text-color, #6b7478);
  --dq-line: var(--ls-border-color, #dfe3e1);
  --dq-grid: var(--ls-quaternary-background-color, #eceeed);
  --dq-code: var(--ls-secondary-background-color, #f2f4f3);
  --dq-accent: var(--ls-link-text-color, #0e7c86);
}
html[data-theme='dark'] {
  --dq-c0: #6f9ff0; --dq-c1: #f0a45a; --dq-c2: #a987e8; --dq-c3: #5cc596;
  --dq-c4: #ec7d9b; --dq-c5: #c9b75a; --dq-c6: #6cc3dc; --dq-c7: #b98e74;
  --dq-fail: #f07d69; --dq-fail-bg: #3a1f1a; --dq-pass: #6cc790; --dq-pass-bg: #173024;
  --dq-warn: #e8b451; --dq-warn-bg: #3a2e14;
  --dq-bg: var(--ls-primary-background-color, #1b2023);
  --dq-fg: var(--ls-primary-text-color, #e4e8e9);
  --dq-muted: var(--ls-secondary-text-color, #8d989c);
  --dq-line: var(--ls-border-color, #2a3134);
  --dq-grid: var(--ls-quaternary-background-color, #232a2d);
  --dq-code: var(--ls-secondary-background-color, #20272a);
  --dq-accent: var(--ls-link-text-color, #4fb8c1);
}
```

`src/style/inline.css` (host DOM; every selector under `.dq`):
```css
.dq { border: 1px solid var(--dq-line); border-radius: 8px; overflow: hidden; background: var(--dq-bg); color: var(--dq-fg); font-size: 13px; margin: 4px 0; }
.dq-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 6px 10px; border-bottom: 1px solid var(--dq-line); }
.dq-dsl { flex: 1 1 240px; font-size: 12px; background: var(--dq-code); border-radius: 5px; padding: 3px 8px; overflow-x: auto; white-space: nowrap; }
.dq-meta { font-size: 12px; color: var(--dq-muted); font-variant-numeric: tabular-nums; }
.dq-warn { color: var(--dq-warn); font-weight: 600; }
.dq-btn { font: inherit; font-size: 12px; color: var(--dq-accent); background: transparent; border: 1px solid var(--dq-line); border-radius: 5px; padding: 2px 9px; cursor: pointer; }
.dq-btn:hover { border-color: var(--dq-accent); }
.dq-chartbox { padding: 6px 6px 2px; border-bottom: 1px solid var(--dq-line); }
.dq-chart { display: block; width: 100%; max-width: 560px; height: auto; margin: 0 auto; }
.dq-chart text { font-size: 11px; fill: var(--dq-muted); }
.dq-chart .dq-title, .dq-chart .dq-cat { fill: var(--dq-fg); font-size: 12px; }
.dq-chart .dq-lbl { font-size: 10px; }
.dq-chart .dq-grid { stroke: var(--dq-grid); }
.dq-chart .dq-axis { stroke: var(--dq-muted); }
.dq-chart .dq-ref { stroke: var(--dq-fail); stroke-width: 1.4; stroke-dasharray: 5 4; }
.dq-chart .dq-passzone { fill: var(--dq-pass-bg); }
.dq-chart .dq-pt { stroke: var(--dq-bg); stroke-width: 1.5; cursor: pointer; }
.dq-chart .dq-bar { opacity: 0.85; }
.dq-chart .dq-whisker line { stroke: var(--dq-fg); stroke-width: 1.3; }
.dq-legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 14px; font-size: 11.5px; color: var(--dq-muted); padding: 2px 0 6px; }
.dq-mark { display: inline-block; width: 9px; height: 9px; margin-right: 5px; vertical-align: -1px; }
.dq-dot { border-radius: 50%; }
.dq-square { border-radius: 2px; }
.dq-dash { width: 16px; height: 0; border-top: 2px dashed; vertical-align: 3px; }
.dq-tbl { overflow-x: auto; }
.dq table { border-collapse: collapse; width: 100%; font-size: 12.5px; font-variant-numeric: tabular-nums; margin: 0; }
.dq th, .dq td { padding: 4px 9px; border-bottom: 1px solid var(--dq-line); white-space: nowrap; text-align: left; }
.dq th { font-weight: 500; color: var(--dq-muted); font-size: 11.5px; }
.dq .dq-type { display: block; font-size: 10px; font-weight: 400; opacity: 0.8; }
.dq .dq-num { text-align: right; }
.dq .dq-link { color: var(--dq-accent); cursor: pointer; }
.dq .dq-pass { background: var(--dq-pass-bg); color: var(--dq-pass); }
.dq .dq-fail { background: var(--dq-fail-bg); color: var(--dq-fail); }
.dq .dq-conflict sup { color: var(--dq-warn); margin-left: 2px; }
.dq-conflicts { background: var(--dq-warn-bg); padding: 4px 10px; font-size: 12px; }
.dq-conflicts p, .dq-note { margin: 2px 0; }
.dq-note { padding: 2px 10px; font-size: 12px; color: var(--dq-muted); }
.dq-empty { padding: 10px; color: var(--dq-muted); text-align: center; margin: 0; }
.dq-error { border-color: var(--dq-fail); background: var(--dq-fail-bg); padding: 8px 10px; }
.dq-error pre { margin: 0; font-size: 12px; background: transparent; white-space: pre; overflow-x: auto; }
.dq-error p { margin: 4px 0 0; color: var(--dq-fail); }
```

- [ ] **Step 5: Verify**: `npx vitest run tests/core/view.test.ts` → PASS.

- [ ] **Step 6: Commit**: `git add -A && git commit -m "feat(core): inline view HTML and styles"`

---

### Task 9: Filter cards (panel model)

**Files:**
- Create: `src/core/cards.ts`, `tests/core/cards.test.ts`

**Interfaces:**
- Consumes: `Cond` (Task 4), `ValueType`, `isNumericType` (Task 3).
- Produces:
```ts
export type Card =
  | { kind: 'range'; key: string; min?: { op: '>' | '>='; value: string }; max?: { op: '<' | '<='; value: string } }
  | { kind: 'values'; key: string; values: string[] }   // [] = no restriction
  | { kind: 'has'; key: string; values: string[] }      // all must be contained
  | { kind: 'raw'; key: string; cond: Cond };
export function whereToCards(where: Cond[], types: Record<string, ValueType>): Card[];
export function cardsToWhere(cards: Card[]): Cond[];
export function newCard(key: string, t: ValueType): Card;
```

- [ ] **Step 1: Write the failing test** `tests/core/cards.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { cardsToWhere, newCard, whereToCards } from '../../src/core/cards';
import { parseDsl, type Cond } from '../../src/core/dsl';

const where = (t: string): Cond[] => {
  const r = parseDsl('where ' + t);
  if (!r.ok) throw new Error(r.error.message);
  return r.query.where;
};
const types = { gre: 'ratio', combine: 'string', patch: 'numlist', seed: 'category' } as const;

describe('whereToCards', () => {
  it('groups conditions into one card per key', () => {
    expect(whereToCards(where('gre >= 0.5 and combine in (none, mean) and gre < 1 and patch has 8 and patch has 16 and seed = 1'), types)).toEqual([
      { kind: 'range', key: 'gre', min: { op: '>=', value: '0.5' }, max: { op: '<', value: '1' } },
      { kind: 'values', key: 'combine', values: ['none', 'mean'] },
      { kind: 'has', key: 'patch', values: ['8', '16'] },
      { kind: 'values', key: 'seed', values: ['1'] },
    ]);
  });
  it('keeps what the GUI cannot express as raw cards', () => {
    expect(whereToCards(where('seed != 1 and gre < 1 and gre < 2 and combine = a and combine = b'), types)).toEqual([
      { kind: 'raw', key: 'seed', cond: { kind: 'cmp', key: 'seed', op: '!=', value: '1' } },
      { kind: 'range', key: 'gre', max: { op: '<', value: '1' } },
      { kind: 'raw', key: 'gre', cond: { kind: 'cmp', key: 'gre', op: '<', value: '2' } },
      { kind: 'values', key: 'combine', values: ['a'] },
      { kind: 'raw', key: 'combine', cond: { kind: 'cmp', key: 'combine', op: '=', value: 'b' } },
    ]);
  });
});

describe('cardsToWhere', () => {
  it('round-trips grouped conditions', () => {
    const w = where('gre >= 0.5 and gre < 1 and combine in (none, mean) and patch has 8 and patch has 16 and seed = 1 and seed != 2');
    expect(cardsToWhere(whereToCards(w, types))).toEqual(w);
  });
  it('drops empty cards', () => {
    expect(cardsToWhere([newCard('gre', 'ratio'), newCard('combine', 'string'), newCard('patch', 'numlist')])).toEqual([]);
  });
});

describe('newCard', () => {
  it('picks the card by type', () => {
    expect(newCard('gre', 'ratio').kind).toBe('range');
    expect(newCard('patch', 'numlist').kind).toBe('has');
    expect(newCard('seed', 'category').kind).toBe('values');
  });
});
```

- [ ] **Step 2: Run to see it fail**: `npx vitest run tests/core/cards.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/core/cards.ts`
```ts
import type { Cond } from './dsl';
import { isNumericType, type ValueType } from './types';

export type Card =
  | { kind: 'range'; key: string; min?: { op: '>' | '>='; value: string }; max?: { op: '<' | '<='; value: string } }
  | { kind: 'values'; key: string; values: string[] }
  | { kind: 'has'; key: string; values: string[] }
  | { kind: 'raw'; key: string; cond: Cond };

export function newCard(key: string, t: ValueType): Card {
  if (isNumericType(t)) return { kind: 'range', key };
  if (t === 'numlist') return { kind: 'has', key, values: [] };
  return { kind: 'values', key, values: [] };
}

/** Group AND-ed conditions into GUI cards; anything the GUI cannot show stays a raw card. */
export function whereToCards(where: Cond[], _types: Record<string, ValueType>): Card[] {
  const cards: Card[] = [];
  const find = <K extends Card['kind']>(kind: K, key: string) =>
    cards.find((c): c is Extract<Card, { kind: K }> => c.kind === kind && c.key === key);
  for (const c of where) {
    const raw = () => cards.push({ kind: 'raw', key: c.key, cond: c });
    if (c.kind === 'has') {
      const card = find('has', c.key);
      if (card) card.values.push(c.value);
      else cards.push({ kind: 'has', key: c.key, values: [c.value] });
    } else if (c.kind === 'in' || (c.kind === 'cmp' && c.op === '=')) {
      if (find('values', c.key)) raw();
      else cards.push({ kind: 'values', key: c.key, values: c.kind === 'in' ? [...c.values] : [c.value] });
    } else if (c.op === '<' || c.op === '<=' || c.op === '>' || c.op === '>=') {
      const side = c.op[0] === '<' ? 'max' : 'min';
      let card = find('range', c.key);
      if (card?.[side]) raw();
      else {
        if (!card) {
          card = { kind: 'range', key: c.key };
          cards.push(card);
        }
        if (side === 'max') card.max = { op: c.op as '<' | '<=', value: c.value };
        else card.min = { op: c.op as '>' | '>=', value: c.value };
      }
    } else raw();
  }
  return cards;
}

export function cardsToWhere(cards: Card[]): Cond[] {
  const out: Cond[] = [];
  for (const c of cards) {
    if (c.kind === 'range') {
      if (c.min) out.push({ kind: 'cmp', key: c.key, op: c.min.op, value: c.min.value });
      if (c.max) out.push({ kind: 'cmp', key: c.key, op: c.max.op, value: c.max.value });
    } else if (c.kind === 'values') {
      if (c.values.length === 1) out.push({ kind: 'cmp', key: c.key, op: '=', value: c.values[0] });
      else if (c.values.length > 1) out.push({ kind: 'in', key: c.key, values: [...c.values] });
    } else if (c.kind === 'has') {
      for (const v of c.values) out.push({ kind: 'has', key: c.key, value: v });
    } else out.push(c.cond);
  }
  return out;
}
```

Note: the round-trip test's input is already grouped (all `gre` conditions adjacent), which is the canonical order `cardsToWhere` produces; ungrouped input comes back grouped, which is equivalent under AND.

- [ ] **Step 4: Verify**: `npx vitest run tests/core/cards.test.ts` → PASS.

- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(core): filter cards model for the panel"`

---

### Task 10: Host layer (collection, engine, actions, inline registry)

**Files:**
- Create: `src/core/macroText.ts`, `src/host/api.ts`, `src/host/collect.ts`, `src/host/engine.ts`, `src/host/actions.ts`, `src/host/inline.ts`
- Test: `tests/core/macroText.test.ts`, `tests/host/fakeLogseq.ts`, `tests/host/host.test.ts`

**Interfaces:**
- Consumes: Tasks 2–8.
- Produces:
```ts
// core/macroText.ts
export const MACRO_TYPE = ':dataquery';
export function findMacro(content: string): string | null;
export function dslFromMacro(macro: string): string;
export function buildMacro(dsl: string): string;
export function replaceMacro(content: string, oldMacro: string, dsl: string): string | null;
// host/api.ts
export interface LogseqLike { DB: {...}; Editor: {...} }   // see code
// host/collect.ts
export const BLOCKS_QUERY: string;
export function toSourceBlock(raw: any): SourceBlock | null;
export function fetchBlocks(api: LogseqLike): Promise<SourceBlock[]>;
export function fetchTypeOverrides(api: LogseqLike, typesPage: string): Promise<TypeOverrides>;
export function fetchScope(api: LogseqLike, macroUuid: string): Promise<{ macroPage: string; hereIds: Set<string> }>;
// host/engine.ts
export interface Evaluation { parsed: ParseResult; result?: QueryResult }
export class Engine { constructor(api: LogseqLike, typesPage: () => string); invalidate(): void; evaluate(dsl: string, macroUuid: string): Promise<Evaluation> }
// host/actions.ts
export function errorText(e: unknown): string;
export function saveDsl(api: LogseqLike, macroUuid: string, oldMacro: string, dsl: string): Promise<string>; // returns the new macro text
export function setType(api: LogseqLike, typesPage: string, key: string, type: ValueType): Promise<void>;
export function jumpTo(api: LogseqLike, uuid: string): Promise<void>;
export function readMacro(api: LogseqLike, macroUuid: string): Promise<{ macro: string; dsl: string }>;
// host/inline.ts
export class InlineViews {
  constructor(engine: Engine, provide: (slot: string, html: string) => void, exists: (slot: string) => boolean);
  show(slot: string, uuid: string, dsl: string): Promise<void>;
  refreshAll(): Promise<void>;
}
```

- [ ] **Step 1: Write the failing tests**

`tests/core/macroText.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildMacro, dslFromMacro, findMacro, replaceMacro } from '../../src/core/macroText';

describe('macro text', () => {
  const content = 'before {{renderer :dataquery, in [[a/b]] | where x in (1, 2)}} after\nk:: v';
  it('finds the macro including [[links]]', () => {
    expect(findMacro(content)).toBe('{{renderer :dataquery, in [[a/b]] | where x in (1, 2)}}');
    expect(findMacro('{{renderer :other}}')).toBeNull();
    expect(findMacro('{{renderer :dataquery}}')).toBe('{{renderer :dataquery}}');
  });
  it('extracts and builds the DSL', () => {
    expect(dslFromMacro('{{renderer :dataquery, in [[a/b]] | sort x}}')).toBe('in [[a/b]] | sort x');
    expect(dslFromMacro('{{renderer :dataquery}}')).toBe('');
    expect(buildMacro('')).toBe('{{renderer :dataquery}}');
    expect(buildMacro(' sort x ')).toBe('{{renderer :dataquery, sort x}}');
  });
  it('replaces only when the old macro is still there (Review Focus 5)', () => {
    const old = findMacro(content)!;
    expect(replaceMacro(content, old, 'sort y')).toBe('before {{renderer :dataquery, sort y}} after\nk:: v');
    expect(replaceMacro(content, '{{renderer :dataquery, gone}}', 'sort y')).toBeNull();
  });
});
```

`tests/host/fakeLogseq.ts`:
```ts
import { vi } from 'vitest';
import type { LogseqLike } from '../../src/host/api';

export interface FakeBlock { uuid: string; content: string; page: string; children?: FakeBlock[]; preBlock?: boolean; journalDay?: number; refs?: string[] }

/** In-memory Logseq with pages of nested blocks; ids are 1-based positions in a flat list. */
export function fakeLogseq(pages: Record<string, FakeBlock[]>) {
  const flat: Array<{ b: FakeBlock; id: number; parentId: number; pageId: number }> = [];
  const pageIds = new Map<string, number>();
  let next = 1000;
  for (const [name, blocks] of Object.entries(pages)) {
    const pid = next++;
    pageIds.set(name, pid);
    const walk = (bs: FakeBlock[], parentId: number) => {
      for (const b of bs) {
        const id = next++;
        flat.push({ b, id, parentId, pageId: pid });
        walk(b.children ?? [], id);
      }
    };
    walk(blocks, pid);
  }
  const byUuid = (u: string) => flat.find((f) => f.b.uuid === u);
  const byId = (i: number) => flat.find((f) => f.id === i);
  const pageName = (pid: number) => [...pageIds].find(([, v]) => v === pid)![0];
  const entity = (f: (typeof flat)[number], withChildren: boolean): any => ({
    id: f.id, uuid: f.b.uuid, content: f.b.content, page: { id: f.pageId }, parent: { id: f.parentId },
    'preBlock?': !!f.b.preBlock,
    children: withChildren ? flat.filter((c) => c.parentId === f.id).map((c) => entity(c, true)) : [],
  });
  const api = {
    DB: {
      datascriptQuery: vi.fn(async () =>
        flat
          .filter((f) => /^\s*[\w.*-]+::\s*\S/m.test(f.b.content))
          .map((f) => [{
            uuid: f.b.uuid, content: f.b.content, 'pre-block?': !!f.b.preBlock,
            page: { name: pageName(f.pageId).toLowerCase(), 'original-name': pageName(f.pageId), 'journal-day': f.b.journalDay ?? null },
            'path-refs': (f.b.refs ?? []).map((n) => ({ name: n })),
          }])),
    },
    Editor: {
      getBlock: vi.fn(async (id: string | number, opts?: { includeChildren?: boolean }) => {
        const f = typeof id === 'number' ? byId(id) : byUuid(id);
        return f ? entity(f, !!opts?.includeChildren) : null;
      }),
      getPage: vi.fn(async (id: string | number) => {
        const name = typeof id === 'number' ? pageName(id) : [...pageIds.keys()].find((n) => n.toLowerCase() === String(id).toLowerCase());
        return name ? { id: pageIds.get(name), name: name.toLowerCase(), originalName: name } : null;
      }),
      getPageBlocksTree: vi.fn(async (name: string) => {
        const pid = [...pageIds].find(([n]) => n.toLowerCase() === name.toLowerCase())?.[1];
        return pid === undefined ? null : flat.filter((f) => f.parentId === pid).map((f) => entity(f, true));
      }),
      updateBlock: vi.fn(async (uuid: string, content: string) => { byUuid(uuid)!.b.content = content; }),
      upsertBlockProperty: vi.fn(async () => {}),
      insertBlock: vi.fn(async () => null),
      appendBlockInPage: vi.fn(async () => null),
      createPage: vi.fn(async () => null),
      scrollToBlockInPage: vi.fn(),
    },
  };
  return api as typeof api & LogseqLike;
}
```

`tests/host/host.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { errorText, jumpTo, readMacro, saveDsl, setType } from '../../src/host/actions';
import { fetchScope, fetchTypeOverrides, toSourceBlock } from '../../src/host/collect';
import { Engine } from '../../src/host/engine';
import { InlineViews } from '../../src/host/inline';
import { fakeLogseq } from './fakeLogseq';

const graph = () =>
  fakeLogseq({
    'Sep 28th, 2026': [
      {
        uuid: 'h', content: '## #work/nsb seeds\nreport:: x', refs: ['work/nsb'], journalDay: 20260928,
        children: [
          { uuid: 'm', content: '{{renderer :dataquery, sort gre}}', refs: ['work/nsb'], journalDay: 20260928 },
          { uuid: 'a', content: 'A\nrun:: a\ngre:: 1.27', refs: ['work/nsb'], journalDay: 20260928 },
          { uuid: 'b', content: 'B\nrun:: b\ngre:: 0.96', refs: ['work/nsb'], journalDay: 20260928 },
        ],
      },
      { uuid: 'z', content: 'Z\nrun:: z\ngre:: 3', journalDay: 20260928 },
    ],
    'dataquery/types': [{ uuid: 't', content: 'gre:: ratio\nseed:: float', preBlock: true }],
  });

describe('collect', () => {
  it('normalises both key spellings Logseq may return', () => {
    expect(toSourceBlock({ uuid: 'u', content: 'k:: v', preBlock: true, page: { name: 'P', originalName: 'P', journalDay: 1 }, pathRefs: [{ name: 'X' }] })).toEqual({
      uuid: 'u', content: 'k:: v', page: 'p', pageTitle: 'P', journalDay: 1, pathRefs: ['x'], preBlock: true,
    });
    expect(toSourceBlock({ content: 'no uuid' })).toBeNull();
  });
  it('here = siblings under the macro parent', async () => {
    const s = await fetchScope(graph(), 'm');
    expect(s.macroPage).toBe('sep 28th, 2026');
    expect([...s.hereIds].sort()).toEqual(['a', 'b', 'm']);
  });
  it('reads type overrides and their warnings', async () => {
    const ov = await fetchTypeOverrides(graph(), 'dataquery/types');
    expect(ov.exact).toEqual({ gre: 'ratio' });
    expect(ov.warnings).toHaveLength(1);
    expect((await fetchTypeOverrides(graph(), 'missing')).exact).toEqual({});
  });
});

describe('Engine', () => {
  it('evaluates in scope with graph-wide types, excluding the types page', async () => {
    const api = graph();
    const ev = await new Engine(api, () => 'dataquery/types').evaluate('sort gre', 'm');
    expect(ev.result!.rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(ev.result!.types.gre).toBe('ratio');
    expect(ev.result!.warnings[0]).toContain("Unknown type 'float'");
  });
  it('returns parse errors without touching the DB', async () => {
    const api = graph();
    const ev = await new Engine(api, () => 'dataquery/types').evaluate('where x <', 'm');
    expect(ev.parsed.ok).toBe(false);
    expect(api.DB.datascriptQuery).not.toHaveBeenCalled();
  });
  it('caches until invalidated', async () => {
    const api = graph();
    const e = new Engine(api, () => 'dataquery/types');
    await e.evaluate('', 'm');
    await e.evaluate('', 'm');
    expect(api.DB.datascriptQuery).toHaveBeenCalledTimes(1);
    e.invalidate();
    await e.evaluate('', 'm');
    expect(api.DB.datascriptQuery).toHaveBeenCalledTimes(2);
  });
  it('wraps DB failures with the cause attached', async () => {
    const api = graph();
    api.DB.datascriptQuery.mockRejectedValueOnce(new Error('boom'));
    const p = new Engine(api, () => 'dataquery/types').evaluate('', 'm');
    await expect(p).rejects.toThrow('Could not read blocks from the Logseq database.');
    await p.catch((e) => expect(errorText(e)).toBe('Could not read blocks from the Logseq database. (cause: boom)'));
  });
});

describe('actions', () => {
  it('saveDsl rewrites the macro and refuses after a concurrent edit (Review Focus 5)', async () => {
    const api = graph();
    const { macro, dsl } = await readMacro(api, 'm');
    expect(dsl).toBe('sort gre');
    expect(await saveDsl(api, 'm', macro, 'sort gre desc')).toBe('{{renderer :dataquery, sort gre desc}}');
    expect(api.Editor.updateBlock).toHaveBeenCalledWith('m', '{{renderer :dataquery, sort gre desc}}');
    await expect(saveDsl(api, 'm', macro, 'sort run')).rejects.toThrow('The query block was edited after this view opened.');
  });
  it('setType upserts into the page-properties block, or creates the page', async () => {
    const api = graph();
    await setType(api, 'dataquery/types', 'seed', 'category');
    expect(api.Editor.upsertBlockProperty).toHaveBeenCalledWith('t', 'seed', 'category');
    await setType(api, 'new/types', 'seed', 'category');
    expect(api.Editor.createPage).toHaveBeenCalledWith('new/types', { seed: 'category' }, { redirect: false, createFirstBlock: true });
  });
  it('jumpTo scrolls to the block in its page', async () => {
    const api = graph();
    await jumpTo(api, 'a');
    expect(api.Editor.scrollToBlockInPage).toHaveBeenCalledWith('Sep 28th, 2026', 'a');
  });
});

describe('InlineViews', () => {
  it('renders into the slot, re-renders on refresh, forgets vanished slots', async () => {
    const api = graph();
    const provide = vi.fn();
    const alive = new Set(['s1']);
    const views = new InlineViews(new Engine(api, () => 'dataquery/types'), provide, (s) => alive.has(s));
    await views.show('s1', 'm', 'sort gre');
    expect(provide).toHaveBeenLastCalledWith('s1', expect.stringContaining('2 rows'));
    alive.delete('s1');
    provide.mockClear();
    await views.refreshAll();
    expect(provide).not.toHaveBeenCalled();
  });
  it('shows failures inside the view instead of throwing', async () => {
    const api = graph();
    api.DB.datascriptQuery.mockRejectedValueOnce(new Error('boom'));
    const provide = vi.fn();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await new InlineViews(new Engine(api, () => 'dataquery/types'), provide, () => true).show('s', 'm', '');
    expect(provide.mock.calls[0][1]).toContain('Data query failed: Could not read blocks from the Logseq database. (cause: boom)');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
```

- [ ] **Step 2: Run to see them fail**: `npx vitest run tests/core/macroText.test.ts tests/host` → FAIL.

- [ ] **Step 3: Implement** `src/core/macroText.ts`
```ts
export const MACRO_TYPE = ':dataquery';
const MACRO = /\{\{renderer\s+:dataquery\b[\s\S]*?\}\}(?!\])/;

export function findMacro(content: string): string | null {
  return MACRO.exec(content)?.[0] ?? null;
}

export function dslFromMacro(macro: string): string {
  const m = /^\{\{renderer\s+:dataquery\s*,?([\s\S]*)\}\}$/.exec(macro);
  return m ? m[1].trim() : '';
}

export function buildMacro(dsl: string): string {
  const d = dsl.trim();
  return d ? `{{renderer :dataquery, ${d}}}` : '{{renderer :dataquery}}';
}

/** Swap the macro text, or return null when the block no longer contains `oldMacro`. */
export function replaceMacro(content: string, oldMacro: string, dsl: string): string | null {
  const i = content.indexOf(oldMacro);
  if (i < 0) return null;
  return content.slice(0, i) + buildMacro(dsl) + content.slice(i + oldMacro.length);
}
```

Note on the regex: `}}` inside `[[a/b]]` cannot occur (links close with `]]`), so a lazy match to the first `}}` is correct. The `(?!\])` guard is harmless and keeps `}}]` edge cases from matching early.

`src/host/api.ts`:
```ts
/** The slice of the Logseq plugin API this plugin uses; lets tests pass a fake. */
export interface LogseqLike {
  DB: { datascriptQuery(query: string, ...inputs: unknown[]): Promise<any> };
  Editor: {
    getBlock(id: string | number, opts?: { includeChildren?: boolean }): Promise<any>;
    getPage(id: string | number): Promise<any>;
    getPageBlocksTree(name: string): Promise<any[] | null>;
    updateBlock(uuid: string, content: string): Promise<unknown>;
    upsertBlockProperty(uuid: string, key: string, value: unknown): Promise<unknown>;
    insertBlock(uuid: string, content: string, opts?: { before?: boolean; sibling?: boolean }): Promise<unknown>;
    appendBlockInPage(page: string, content: string): Promise<unknown>;
    createPage(name: string, props?: Record<string, unknown>, opts?: { redirect?: boolean; createFirstBlock?: boolean }): Promise<unknown>;
    scrollToBlockInPage(page: string, uuid: string): void;
  };
}
```

`src/host/collect.ts`:
```ts
import type { SourceBlock } from '../core/rows';
import { parseContent } from '../core/text';
import { emptyOverrides, parseTypeOverrides, type TypeOverrides } from '../core/types';
import type { LogseqLike } from './api';

export const BLOCKS_QUERY = `[:find (pull ?b [:block/uuid :block/content :block/pre-block?
  {:block/page [:block/name :block/original-name :block/journal-day]}
  {:block/path-refs [:block/name]}])
 :where [?b :block/properties ?p] [(not= ?p {})]]`;

/** Logseq may return namespaced, kebab or camel keys depending on the call path. */
function pick(o: any, ...names: string[]): any {
  for (const n of names) if (o && o[n] !== undefined && o[n] !== null) return o[n];
  return undefined;
}

export function toSourceBlock(raw: any): SourceBlock | null {
  const uuid = pick(raw, 'uuid', 'block/uuid');
  const content = pick(raw, 'content', 'block/content');
  if (typeof uuid !== 'string' || typeof content !== 'string') return null;
  const page = pick(raw, 'page', 'block/page') ?? {};
  const name = String(pick(page, 'name', 'block/name') ?? '');
  const refs: any[] = pick(raw, 'path-refs', 'pathRefs', 'block/path-refs') ?? [];
  return {
    uuid,
    content,
    page: name.toLowerCase(),
    pageTitle: String(pick(page, 'original-name', 'originalName', 'block/original-name') ?? name),
    journalDay: pick(page, 'journal-day', 'journalDay', 'block/journal-day') ?? null,
    pathRefs: refs.map((r) => String(pick(r, 'name', 'block/name') ?? '').toLowerCase()).filter(Boolean),
    preBlock: !!pick(raw, 'pre-block?', 'preBlock?', 'preBlock', 'block/pre-block?'),
  };
}

export async function fetchBlocks(api: LogseqLike): Promise<SourceBlock[]> {
  let res: any;
  try {
    res = await api.DB.datascriptQuery(BLOCKS_QUERY);
  } catch (e) {
    throw new Error('Could not read blocks from the Logseq database.', { cause: e });
  }
  return (res ?? [])
    .map((r: any) => toSourceBlock(Array.isArray(r) ? r[0] : r))
    .filter((b: SourceBlock | null): b is SourceBlock => b !== null);
}

export async function fetchTypeOverrides(api: LogseqLike, typesPage: string): Promise<TypeOverrides> {
  let tree: any[] | null;
  try {
    tree = await api.Editor.getPageBlocksTree(typesPage);
  } catch (e) {
    throw new Error(`Could not read the types page '${typesPage}'.`, { cause: e });
  }
  if (!tree?.length) return emptyOverrides();
  return parseTypeOverrides(parseContent(String(tree[0].content ?? '')).props);
}

export async function fetchScope(api: LogseqLike, macroUuid: string): Promise<{ macroPage: string; hereIds: Set<string> }> {
  const macro = await api.Editor.getBlock(macroUuid);
  if (!macro) throw new Error(`The query block ${macroUuid} was not found.`);
  const page = await api.Editor.getPage(macro.page.id);
  const hereIds = new Set<string>();
  const walk = (bs: any[] | null | undefined) => {
    for (const b of bs ?? []) {
      if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
      if (typeof b.uuid === 'string') hereIds.add(b.uuid);
      walk(b.children);
    }
  };
  if (macro.parent.id === macro.page.id) walk(await api.Editor.getPageBlocksTree(page.originalName ?? page.name));
  else walk((await api.Editor.getBlock(macro.parent.id, { includeChildren: true }))?.children);
  return { macroPage: String(page?.name ?? '').toLowerCase(), hereIds };
}
```

`src/host/engine.ts`:
```ts
import { parseDsl, type ParseResult } from '../core/dsl';
import { computeTypes, runQuery, type QueryResult } from '../core/query';
import type { SourceBlock } from '../core/rows';
import type { TypeOverrides, ValueType } from '../core/types';
import type { LogseqLike } from './api';
import { fetchBlocks, fetchScope, fetchTypeOverrides } from './collect';

export interface Evaluation {
  parsed: ParseResult;
  result?: QueryResult;
}

interface Snapshot { blocks: SourceBlock[]; overrides: TypeOverrides; types: Record<string, ValueType> }

/** Reads the graph once per change and answers queries for any macro. */
export class Engine {
  private snapshot: Promise<Snapshot> | null = null;

  constructor(private api: LogseqLike, private typesPage: () => string) {}

  invalidate(): void {
    this.snapshot = null;
  }

  private load(): Promise<Snapshot> {
    this.snapshot ??= (async () => {
      const tp = this.typesPage();
      const blocks = (await fetchBlocks(this.api)).filter((b) => b.page !== tp.toLowerCase());
      const overrides = await fetchTypeOverrides(this.api, tp);
      return { blocks, overrides, types: computeTypes(blocks, overrides) };
    })();
    this.snapshot.catch(() => (this.snapshot = null));
    return this.snapshot;
  }

  async evaluate(dsl: string, macroUuid: string): Promise<Evaluation> {
    const parsed = parseDsl(dsl);
    if (!parsed.ok) return { parsed };
    const { blocks, overrides, types } = await this.load();
    const scope = await fetchScope(this.api, macroUuid);
    const result = runQuery(parsed.query, { blocks, types, macroUuid, ...scope });
    result.warnings.unshift(...overrides.warnings);
    return { parsed, result };
  }
}
```

`src/host/actions.ts`:
```ts
import { buildMacro, dslFromMacro, findMacro, replaceMacro } from '../core/macroText';
import type { ValueType } from '../core/types';
import type { LogseqLike } from './api';

/** Message plus the whole cause chain, for places that can only show text. */
export function errorText(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  while (cur) {
    parts.push(cur instanceof Error ? cur.message : String(cur));
    cur = cur instanceof Error ? cur.cause : undefined;
  }
  return parts[0] + parts.slice(1).map((p) => ` (cause: ${p})`).join('');
}

export async function readMacro(api: LogseqLike, macroUuid: string): Promise<{ macro: string; dsl: string }> {
  const block = await api.Editor.getBlock(macroUuid);
  const macro = block ? findMacro(String(block.content)) : null;
  if (!macro) throw new Error('The query block no longer contains a data query.');
  return { macro, dsl: dslFromMacro(macro) };
}

export async function saveDsl(api: LogseqLike, macroUuid: string, oldMacro: string, dsl: string): Promise<string> {
  const block = await api.Editor.getBlock(macroUuid);
  if (!block) throw new Error('The query block no longer exists.');
  const next = replaceMacro(String(block.content), oldMacro, dsl);
  if (next === null) throw new Error('The query block was edited after this view opened. Close the panel, reopen it, and try again.');
  await api.Editor.updateBlock(macroUuid, next);
  return buildMacro(dsl);
}

export async function setType(api: LogseqLike, typesPage: string, key: string, type: ValueType): Promise<void> {
  const page = await api.Editor.getPage(typesPage);
  if (!page) {
    await api.Editor.createPage(typesPage, { [key]: type }, { redirect: false, createFirstBlock: true });
    return;
  }
  const tree = (await api.Editor.getPageBlocksTree(typesPage)) ?? [];
  const first = tree[0];
  if (!first) await api.Editor.appendBlockInPage(typesPage, `${key}:: ${type}`);
  else if (first['preBlock?'] || first.preBlock) await api.Editor.upsertBlockProperty(first.uuid, key, type);
  else await api.Editor.insertBlock(first.uuid, `${key}:: ${type}`, { before: true, sibling: true });
}

export async function jumpTo(api: LogseqLike, uuid: string): Promise<void> {
  const block = await api.Editor.getBlock(uuid);
  if (!block) throw new Error('That block no longer exists.');
  const page = await api.Editor.getPage(block.page.id);
  api.Editor.scrollToBlockInPage(page.originalName ?? page.name, uuid);
}
```

Fix the fake for `setType`: `getPage('dataquery/types')` must find the page by name — the fake's `getPage` already accepts names case-insensitively.

`src/host/inline.ts`:
```ts
import { parseDsl } from '../core/dsl';
import { renderInline } from '../core/view';
import { errorText } from './actions';
import type { Engine } from './engine';

interface SlotInfo { uuid: string; dsl: string }

/** Tracks rendered macro slots so DB changes can re-render them. */
export class InlineViews {
  private slots = new Map<string, SlotInfo>();

  constructor(
    private engine: Engine,
    private provide: (slot: string, html: string) => void,
    private exists: (slot: string) => boolean,
  ) {}

  async show(slot: string, uuid: string, dsl: string): Promise<void> {
    this.slots.set(slot, { uuid, dsl });
    await this.render(slot);
  }

  async refreshAll(): Promise<void> {
    for (const slot of [...this.slots.keys()]) {
      if (!this.exists(slot)) this.slots.delete(slot);
      else await this.render(slot);
    }
  }

  private async render(slot: string): Promise<void> {
    const { uuid, dsl } = this.slots.get(slot)!;
    let html: string;
    try {
      html = renderInline({ macroUuid: uuid, dsl, ...(await this.engine.evaluate(dsl, uuid)) });
    } catch (e) {
      console.error('[dataquery] could not render the query view', e);
      html = renderInline({ macroUuid: uuid, dsl, parsed: parseDsl(dsl), error: errorText(e) });
    }
    this.provide(slot, html);
  }
}
```

- [ ] **Step 4: Verify**: `npx vitest run` → all PASS; `npx tsc -b` clean.

- [ ] **Step 5: Commit**: `git add -A && git commit -m "feat(host): collection, engine cache, actions and inline view registry"`

---

### Task 11: Plugin entry (inline view live in Logseq)

**Files:**
- Modify: `src/main.ts` (replace placeholder)
- Create: `docs/manual-checks.md`

**Interfaces:**
- Consumes: Tasks 8, 10. Panel mount is added in Task 12; this task opens nothing for `dqOpen` yet other than a message.

- [ ] **Step 1: Write `src/main.ts`**
```ts
import '@logseq/libs';
import { joinMacroArgs, parseDsl, printDsl } from './core/dsl';
import { MACRO_TYPE } from './core/macroText';
import { errorText, jumpTo, readMacro, saveDsl } from './host/actions';
import type { LogseqLike } from './host/api';
import { Engine } from './host/engine';
import { InlineViews } from './host/inline';
import inlineCss from './style/inline.css?raw';
import tokensCss from './style/tokens.css?raw';

const DEFAULT_TYPES_PAGE = 'dataquery/types';

export const api = logseq as unknown as LogseqLike;
export const typesPage = () => String(logseq.settings?.typesPage || DEFAULT_TYPES_PAGE);

export function report(e: unknown): void {
  console.error('[dataquery]', e);
  void logseq.UI.showMsg(errorText(e), 'error');
}

async function toggleLabels(uuid: string): Promise<void> {
  const { macro, dsl } = await readMacro(api, uuid);
  const parsed = parseDsl(dsl);
  if (!parsed.ok) throw new Error(`Fix the query before toggling labels: ${parsed.error.message}`);
  const plot = parsed.query.plot;
  if (plot?.kind !== 'scatter') return;
  plot.labels = !plot.labels;
  await saveDsl(api, uuid, macro, printDsl(parsed.query));
}

export let openPanel: (uuid: string) => Promise<void> = async () => {
  await logseq.UI.showMsg('The panel is not available yet.', 'warning');
};
export const setOpenPanel = (fn: typeof openPanel) => (openPanel = fn);

async function main(): Promise<void> {
  logseq.useSettingsSchema([
    {
      key: 'typesPage',
      type: 'string',
      default: DEFAULT_TYPES_PAGE,
      title: 'Types page',
      description: 'Page whose properties set column types, e.g. seed:: category or score-*:: ratio.',
    },
  ]);
  const engine = new Engine(api, typesPage);
  logseq.provideStyle(tokensCss + '\n' + inlineCss);

  const views = new InlineViews(
    engine,
    (slot, html) => logseq.provideUI({ key: `dataquery-${slot}`, slot, reset: true, template: html }),
    (slot) => {
      try {
        return !!parent.document.getElementById(slot);
      } catch (e) {
        console.warn('[dataquery] cannot inspect the Logseq window; keeping the view', e);
        return true;
      }
    },
  );

  logseq.App.onMacroRendererSlotted(({ slot, payload }) => {
    const [type, ...rest] = payload.arguments ?? [];
    if (type?.trim() !== MACRO_TYPE) return;
    void views.show(slot, payload.uuid, joinMacroArgs(rest));
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  logseq.DB.onChanged(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      engine.invalidate();
      void views.refreshAll();
      window.dispatchEvent(new CustomEvent('dataquery:changed'));
    }, 300);
  });

  logseq.provideModel({
    dqJump: (e: { dataset: { uuid: string } }) => jumpTo(api, e.dataset.uuid).catch(report),
    dqOpen: (e: { dataset: { macro: string } }) => openPanel(e.dataset.macro).catch(report),
    dqToggleLabels: (e: { dataset: { macro: string } }) => toggleLabels(e.dataset.macro).catch(report),
  });

  logseq.Editor.registerSlashCommand('Data query', async () => {
    await logseq.Editor.insertAtEditingCursor('{{renderer :dataquery}}');
  });

  (window as any).__dataquery = { engine };
}

logseq.ready(main).catch((e) => console.error('[dataquery] failed to start', e));
```

- [ ] **Step 2: Verify build**: `npx tsc -b && npx vitest run && npx vite build` → clean, `dist/index.html` present.

- [ ] **Step 3: Write `docs/manual-checks.md`** (hand-off list for gyp; Claude does not tick these)
```markdown
# Manual checks (Logseq OG desktop)

Build: `npm run build`. Logseq → Settings → Advanced → Developer mode ON → Plugins → Load unpacked plugin → select this repo folder.

## M1 inline view
- [ ] Under a heading block, add a child `/Data query`. A table of the sibling property blocks appears.
- [ ] Edit it to `{{renderer :dataquery, where type = run | sort gre-thin | plot scatter x=gre-thin y=gre-thick color=seed}}` — chart and sorted table render; numbers sort numerically.
- [ ] `where combine in (none, mean)` works (comma inside the macro).
- [ ] `in [[work/nsb]] | where type = run | merge by run` works (link inside the macro); duplicated runs appear once, conflicts show ⚠.
- [ ] Add `dataquery/types` page with `gre-*:: ratio` and `seed:: category` as page properties; the 1.00 line and green/red cells appear.
- [ ] Click a table link and a chart point → Logseq scrolls to the block.
- [ ] Hide labels / Show labels rewrites the macro with/without `labels=off`.
- [ ] Type `where gre-thin <` → red box with caret and message.
- [ ] Edit a run value → view updates within a second.
- [ ] Toggle light/dark theme → view stays readable.
```

- [ ] **Step 4: Commit**: `git add -A && git commit -m "feat: plugin entry wiring the inline view"`

---

### Task 12: Panel — shell, DSL bar, scope, filters

**Files:**
- Create: `src/panel/mount.tsx`, `src/panel/App.tsx`, `src/panel/DslBar.tsx`, `src/panel/ScopeSwitch.tsx`, `src/panel/FilterPanel.tsx`, `src/style/panel.css`
- Modify: `src/main.ts` (mount panel, set `openPanel`)
- Test: `tests/panel/app.test.tsx`

**Interfaces:**
- Consumes: `Engine`/`Evaluation` (Task 10), cards (Task 9), dsl (Task 4), query (Task 6).
- Produces:
```ts
// panel/mount.tsx
export interface Session { uuid: string; dsl: string; macro: string }
export interface PanelDeps {
  evaluate(dsl: string, uuid: string): Promise<Evaluation>;
  save(uuid: string, oldMacro: string, dsl: string): Promise<string>;
  setType(key: string, type: ValueType): Promise<void>;
  jump(uuid: string): Promise<void>;
  close(): void;
  report(e: unknown): void;
}
export function mountPanel(el: HTMLElement, deps: PanelDeps): { open(s: Session): void; refresh(): void };
// panel/App.tsx
export function App(props: { session: Session; deps: PanelDeps; tick: number }): JSX.Element;
```

- [ ] **Step 1: Write the failing test** `tests/panel/app.test.tsx`
```tsx
// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDsl } from '../../src/core/dsl';
import { computeTypes, runQuery } from '../../src/core/query';
import type { SourceBlock } from '../../src/core/rows';
import { parseTypeOverrides } from '../../src/core/types';
import { App } from '../../src/panel/App';
import type { PanelDeps } from '../../src/panel/mount';

const b = (uuid: string, content: string): SourceBlock => ({
  uuid, content, page: 'day', pageTitle: 'Day', journalDay: 1, pathRefs: [], preBlock: false,
});
const blocks = [
  b('a', 'run:: a\ncombine:: none\ngre:: 1.27\npatch:: 8'),
  b('b', 'run:: b\ncombine:: mean\ngre:: 1.49\npatch:: 8/16'),
  b('c', 'run:: c\ncombine:: mean\ngre:: 0.20\npatch:: 8/16'),
];
const types = computeTypes(blocks, parseTypeOverrides({ gre: 'ratio' }));

function deps(): PanelDeps {
  return {
    evaluate: vi.fn(async (dsl: string) => {
      const parsed = parseDsl(dsl);
      if (!parsed.ok) return { parsed };
      return { parsed, result: runQuery(parsed.query, { blocks, types, macroUuid: 'm', macroPage: 'day', hereIds: new Set(['a', 'b', 'c']) }) };
    }),
    save: vi.fn(async (_u, _m, dsl: string) => `{{renderer :dataquery, ${dsl}}}`),
    setType: vi.fn(async () => {}),
    jump: vi.fn(async () => {}),
    close: vi.fn(),
    report: vi.fn(),
  };
}
const session = { uuid: 'm', dsl: 'where combine in (none, mean) | sort gre', macro: '{{renderer :dataquery, where combine in (none, mean) | sort gre}}' };

afterEach(cleanup);

describe('panel App', () => {
  it('shows the DSL and the row count', async () => {
    render(<App session={session} deps={deps()} tick={0} />);
    expect((screen.getByLabelText('Query') as HTMLTextAreaElement).value).toBe(session.dsl);
    await screen.findByText(/3 of 3 rows/);
  });

  it('GUI edits rewrite the DSL', async () => {
    const user = userEvent.setup();
    render(<App session={session} deps={deps()} tick={0} />);
    await screen.findByText(/3 of 3 rows/);
    await user.click(screen.getByRole('checkbox', { name: /none/ }));
    expect((screen.getByLabelText('Query') as HTMLTextAreaElement).value).toBe('where combine = mean | sort gre');
    await screen.findByText(/2 of 3 rows/);
  });

  it('typed DSL updates the GUI on Enter and reports errors in place', async () => {
    const user = userEvent.setup();
    render(<App session={session} deps={deps()} tick={0} />);
    const box = screen.getByLabelText('Query');
    await user.clear(box);
    await user.type(box, 'where gre < 1{Enter}');
    await screen.findByText(/1 of 3 rows/);
    expect(screen.getByText('gre')).toBeTruthy();
    await user.clear(box);
    await user.type(box, 'where gre <{Enter}');
    expect(await screen.findByText(/Missing value after '<'/)).toBeTruthy();
  });

  it('adds a condition card from the picker', async () => {
    const user = userEvent.setup();
    render(<App session={{ ...session, dsl: '' }} deps={deps()} tick={0} />);
    await screen.findByText(/3 of 3 rows/);
    await user.selectOptions(screen.getByLabelText('Add condition'), 'patch');
    await user.click(screen.getByRole('checkbox', { name: '16' }));
    expect((screen.getByLabelText('Query') as HTMLTextAreaElement).value).toBe('where patch has 16');
  });

  it('Save to page sends the current DSL; Revert restores the session DSL', async () => {
    const user = userEvent.setup();
    const d = deps();
    render(<App session={session} deps={d} tick={0} />);
    await screen.findByText(/3 of 3 rows/);
    await user.click(screen.getByRole('button', { name: 'Here' }));
    await user.click(screen.getByRole('button', { name: 'Page' }));
    await user.click(screen.getByRole('button', { name: 'Save to page' }));
    expect(d.save).toHaveBeenCalledWith('m', session.macro, 'in page | where combine in (none, mean) | sort gre');
    await user.click(screen.getByRole('button', { name: 'Revert' }));
    expect((screen.getByLabelText('Query') as HTMLTextAreaElement).value).toBe(session.dsl);
  });

  it('re-evaluates when tick changes', async () => {
    const d = deps();
    const { rerender } = render(<App session={session} deps={d} tick={0} />);
    await screen.findByText(/3 of 3 rows/);
    await act(async () => rerender(<App session={session} deps={d} tick={1} />));
    await waitFor(() => expect(d.evaluate).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run to see it fail**: `npx vitest run tests/panel` → FAIL.

- [ ] **Step 3: Implement**

`src/panel/mount.tsx`:
```tsx
import { createRoot } from 'react-dom/client';
import type { ValueType } from '../core/types';
import type { Evaluation } from '../host/engine';
import { App } from './App';

export interface Session { uuid: string; dsl: string; macro: string }
export interface PanelDeps {
  evaluate(dsl: string, uuid: string): Promise<Evaluation>;
  save(uuid: string, oldMacro: string, dsl: string): Promise<string>;
  setType(key: string, type: ValueType): Promise<void>;
  jump(uuid: string): Promise<void>;
  close(): void;
  report(e: unknown): void;
}

export function mountPanel(el: HTMLElement, deps: PanelDeps) {
  const root = createRoot(el);
  let session: Session | null = null;
  let nonce = 0;
  let tick = 0;
  const draw = () => session && root.render(<App key={nonce} session={session} deps={deps} tick={tick} />);
  return {
    open(s: Session) {
      session = s;
      nonce++;
      draw();
    },
    refresh() {
      tick++;
      draw();
    },
  };
}
```

`src/panel/App.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { emptyQuery, parseDsl, printDsl, type DslError, type Query } from '../core/dsl';
import type { Evaluation } from '../host/engine';
import { DslBar } from './DslBar';
import { FilterPanel } from './FilterPanel';
import type { PanelDeps, Session } from './mount';
import { ScopeSwitch } from './ScopeSwitch';
import { Stage } from './Stage';

function initial(dsl: string): { query: Query; error: DslError | null } {
  const p = parseDsl(dsl);
  return p.ok ? { query: p.query, error: null } : { query: emptyQuery(), error: p.error };
}

export function App({ session, deps, tick }: { session: Session; deps: PanelDeps; tick: number }) {
  const [query, setQuery] = useState(() => initial(session.dsl).query);
  const [text, setText] = useState(session.dsl);
  const [error, setError] = useState<DslError | null>(() => initial(session.dsl).error);
  const [ev, setEv] = useState<Evaluation | null>(null);
  const [macro, setMacro] = useState(session.macro);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let live = true;
    deps.evaluate(printDsl(query), session.uuid).then(
      (r) => live && setEv(r),
      (e) => live && deps.report(e),
    );
    return () => {
      live = false;
    };
  }, [query, tick]);

  const update = (q: Query) => {
    setQuery(q);
    setText(printDsl(q));
    setError(null);
    setStatus('');
  };
  const apply = () => {
    const p = parseDsl(text);
    if (p.ok) {
      setQuery(p.query);
      setError(null);
      setStatus('Applied.');
    } else setError(p.error);
  };
  const save = async () => {
    try {
      setMacro(await deps.save(session.uuid, macro, printDsl(query)));
      setStatus('Saved to page.');
    } catch (e) {
      deps.report(e);
    }
  };
  const revert = () => {
    const i = initial(session.dsl);
    setQuery(i.query);
    setText(session.dsl);
    setError(i.error);
    setStatus('Reverted to the query on the page.');
  };

  const result = ev?.result;
  return (
    <div className="dqp">
      <header className="dqp-top">
        <div className="dqp-row">
          <strong className="dqp-brand">Data query</strong>
          <ScopeSwitch scope={query.scope} onChange={(scope) => update({ ...query, scope })} />
          <span className="dqp-spacer" />
          <button type="button" className="dqp-btn" onClick={revert}>Revert</button>
          <button type="button" className="dqp-btn dqp-primary" onClick={save}>Save to page</button>
          <button type="button" className="dqp-btn" aria-label="Close" onClick={deps.close}>✕</button>
        </div>
        <DslBar text={text} error={error} status={status} onText={setText} onApply={apply} />
      </header>
      <main className="dqp-main">
        <FilterPanel query={query} result={result} onChange={(where) => update({ ...query, where })} />
        <Stage query={query} result={result} deps={deps} onChange={update} />
      </main>
    </div>
  );
}
```

For this task, create a minimal `src/panel/Stage.tsx` that Task 13 replaces:
```tsx
import type { Query } from '../core/dsl';
import type { QueryResult } from '../core/query';
import type { PanelDeps } from './mount';

export function Stage(_: { query: Query; result?: QueryResult; deps: PanelDeps; onChange(q: Query): void }) {
  return <section className="dqp-stage" />;
}
```

`src/panel/DslBar.tsx`:
```tsx
import type { DslError } from '../core/dsl';

export function DslBar(props: { text: string; error: DslError | null; status: string; onText(t: string): void; onApply(): void }) {
  const { text, error, status } = props;
  return (
    <div className="dqp-dsl">
      <textarea
        aria-label="Query"
        className={error ? 'dqp-bad' : ''}
        rows={2}
        spellCheck={false}
        value={text}
        onChange={(e) => props.onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            props.onApply();
          }
        }}
      />
      {error ? (
        <pre className="dqp-msg dqp-bad">{`${text}\n${' '.repeat(error.col)}^ ${error.message}`}</pre>
      ) : (
        <p className="dqp-msg">{status || 'Edit filters on the left, or type here and press Enter.'}</p>
      )}
    </div>
  );
}
```

`src/panel/ScopeSwitch.tsx`:
```tsx
import { useState } from 'react';
import type { Scope } from '../core/dsl';

export function ScopeSwitch({ scope, onChange }: { scope: Scope; onChange(s: Scope): void }) {
  const [page, setPage] = useState(scope.kind === 'ref' ? scope.page : '');
  return (
    <span className="dqp-seg" role="group" aria-label="Scope">
      <button type="button" aria-pressed={scope.kind === 'here'} onClick={() => onChange({ kind: 'here' })}>Here</button>
      <button type="button" aria-pressed={scope.kind === 'page'} onClick={() => onChange({ kind: 'page' })}>Page</button>
      <input
        aria-label="Linked page"
        className={scope.kind === 'ref' ? 'dqp-on' : ''}
        placeholder="[[linked page]]"
        value={page}
        onChange={(e) => setPage(e.target.value)}
        onKeyDown={(e) => {
          const name = page.replace(/^\[\[|\]\]$/g, '').trim();
          if (e.key === 'Enter' && name) onChange({ kind: 'ref', page: name });
        }}
      />
    </span>
  );
}
```

`src/panel/FilterPanel.tsx` — newly added cards emit no condition until the user picks something, so `FilterPanel` keeps them in local `extra` state; rendered cards = `whereToCards(query.where)` plus `extra` cards whose key is not already shown. On edit it writes back `cardsToWhere(allCards)` and keeps in `extra` only the cards that still emit nothing:

```tsx
import { useState } from 'react';
import { cardsToWhere, newCard, whereToCards, type Card } from '../core/cards';
import { printCond, type Cond, type Query } from '../core/dsl';
import type { QueryResult } from '../core/query';
import type { Row } from '../core/rows';
import { compareValues, toList, toNumber, type ValueType } from '../core/types';

interface Props { query: Query; result?: QueryResult; onChange(where: Cond[]): void }

export function FilterPanel({ query, result, onChange }: Props) {
  const types = result?.types ?? {};
  const scoped = result?.scoped ?? [];
  const [extra, setExtra] = useState<Card[]>([]);
  const fromWhere = whereToCards(query.where, types);
  const cards = [...fromWhere, ...extra.filter((e) => !fromWhere.some((c) => c.key === e.key))];
  const commit = (next: Card[]) => {
    onChange(cardsToWhere(next));
    setExtra(next.filter((c) => cardsToWhere([c]).length === 0));
  };
  const used = new Set(cards.map((c) => c.key));
  const keys = [...new Set(scoped.flatMap((r) => Object.keys(r.values)))].filter((k) => !used.has(k));
  return (
    <aside className="dqp-side" aria-label="Filters">
      <p className="dqp-count"><b>{result?.rows.length ?? 0}</b> of {scoped.length} rows</p>
      {cards.map((c, i) => (
        <CardView
          key={`${c.kind}-${c.key}-${i}`}
          card={c}
          type={types[c.key] ?? 'string'}
          scoped={scoped}
          rows={result?.rows ?? []}
          onChange={(n) => commit(cards.map((x, j) => (j === i ? n : x)))}
          onRemove={() => commit(cards.filter((_, j) => j !== i))}
        />
      ))}
      <select
        aria-label="Add condition"
        className="dqp-add"
        value=""
        onChange={(e) => e.target.value && setExtra([...extra, newCard(e.target.value, types[e.target.value] ?? 'string')])}
      >
        <option value="">+ Add condition…</option>
        {keys.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
    </aside>
  );
}

function CardView(props: { card: Card; type: ValueType; scoped: Row[]; rows: Row[]; onChange(c: Card): void; onRemove(): void }) {
  const { card, type, scoped } = props;
  return (
    <div className="dqp-card">
      <div className="dqp-card-h">
        <span className="dqp-key">{card.key}</span>
        <span className="dqp-badge">{type}</span>
        <button type="button" className="dqp-x" aria-label={`Remove ${card.key} condition`} onClick={props.onRemove}>×</button>
      </div>
      {card.kind === 'range' && <RangeBody card={card} type={type} scoped={scoped} rows={props.rows} onChange={props.onChange} />}
      {card.kind === 'values' && <ValuesBody card={card} type={type} scoped={scoped} onChange={props.onChange} />}
      {card.kind === 'has' && <HasBody card={card} scoped={scoped} onChange={props.onChange} />}
      {card.kind === 'raw' && (
        <p className="dqp-raw"><code>{printCond(card.cond)}</code><br />Edit this condition in the query text.</p>
      )}
    </div>
  );
}

function RangeBody({ card, type, scoped, rows, onChange }: { card: Extract<Card, { kind: 'range' }>; type: ValueType; scoped: Row[]; rows: Row[]; onChange(c: Card): void }) {
  const vals = scoped.map((r) => ({ id: r.id, v: toNumber(r.values[card.key]) })).filter((x) => !isNaN(x.v));
  const lo = Math.min(...vals.map((x) => x.v), type === 'ratio' ? 1 : Infinity);
  const hi = Math.max(...vals.map((x) => x.v), type === 'ratio' ? 1 : -Infinity);
  const pos = (v: number) => `${(((v - lo) / (hi - lo || 1)) * 96 + 2).toFixed(1)}%`;
  const on = new Set(rows.map((r) => r.id));
  const edit = (side: 'min' | 'max', text: string) => {
    const t = text.trim();
    if (t && isNaN(Number(t))) return;
    const next = { ...card };
    if (!t) delete next[side];
    else if (side === 'min') next.min = { op: card.min?.op ?? '>=', value: t };
    else next.max = { op: card.max?.op ?? '<', value: t };
    onChange(next);
  };
  return (
    <>
      <div className="dqp-strip" aria-hidden="true">
        {type === 'ratio' && isFinite(lo) && <span className="dqp-ref" style={{ left: pos(1) }} />}
        {vals.map((x) => <i key={x.id} className={on.has(x.id) ? 'dqp-on' : ''} style={{ left: pos(x.v) }} />)}
      </div>
      <div className="dqp-range">
        <input aria-label={`${card.key} minimum`} inputMode="decimal" defaultValue={card.min?.value ?? ''} placeholder={isFinite(lo) ? String(lo) : ''} onBlur={(e) => edit('min', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && edit('min', (e.target as HTMLInputElement).value)} />
        <span>{card.min?.op === '>' ? '<' : '≤'} {card.key} {card.max?.op === '<=' ? '≤' : '<'}</span>
        <input aria-label={`${card.key} maximum`} inputMode="decimal" defaultValue={card.max?.value ?? ''} placeholder={isFinite(hi) ? String(hi) : ''} onBlur={(e) => edit('max', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && edit('max', (e.target as HTMLInputElement).value)} />
      </div>
    </>
  );
}

function ValuesBody({ card, type, scoped, onChange }: { card: Extract<Card, { kind: 'values' }>; type: ValueType; scoped: Row[]; onChange(c: Card): void }) {
  const counts = new Map<string, number>();
  for (const r of scoped) {
    const v = r.values[card.key];
    if (v !== undefined) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const domain = [...counts.keys()].sort((a, b) => compareValues(type, a, b));
  const checked = (v: string) => card.values.length === 0 || card.values.includes(v);
  const toggle = (v: string) => {
    const now = domain.filter(checked);
    const next = now.includes(v) ? now.filter((x) => x !== v) : [...now, v];
    if (next.length === 0) return;
    onChange({ ...card, values: next.length === domain.length ? [] : domain.filter((x) => next.includes(x)) });
  };
  return (
    <div className="dqp-checks">
      {domain.map((v) => (
        <label key={v} className="dqp-chk">
          <input type="checkbox" checked={checked(v)} onChange={() => toggle(v)} />
          {v}
          <span className="dqp-n">{counts.get(v)}</span>
        </label>
      ))}
    </div>
  );
}

function HasBody({ card, scoped, onChange }: { card: Extract<Card, { kind: 'has' }>; scoped: Row[]; onChange(c: Card): void }) {
  const elems = [...new Set(scoped.flatMap((r) => toList(r.values[card.key]) ?? []))].sort((a, b) => a - b).map(String);
  const toggle = (v: string) =>
    onChange({ ...card, values: card.values.includes(v) ? card.values.filter((x) => x !== v) : [...card.values, v] });
  return (
    <>
      <p className="dqp-hint">Contains all of</p>
      <div className="dqp-checks">
        {elems.map((v) => (
          <label key={v} className="dqp-chk">
            <input type="checkbox" checked={card.values.includes(v)} onChange={() => toggle(v)} />
            {v}
          </label>
        ))}
      </div>
    </>
  );
}
```

Note: the checkbox accessible name includes the count (`none1`); the test uses a regex `/none/` for that reason. The `has` checkboxes have no count, so the test uses the exact name `'16'`.

`src/style/panel.css` — port the tokens and layout from the approved mock (`https://claude.ai/artifact/9rXTRyvxpAaKYssKKwquaL`), renaming classes to the `dqp-` prefix used above:
```css
@import './tokens.css';
html, body { margin: 0; height: 100%; }
body { background: rgba(0, 0, 0, 0.35); }
.dqp { position: fixed; inset: 24px; overflow: auto; background: var(--dq-bg); color: var(--dq-fg); border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,.35); font: 13.5px/1.55 system-ui, sans-serif; padding: 12px 16px 24px; display: flex; flex-direction: column; gap: 12px; }
.dqp-top { display: flex; flex-direction: column; gap: 8px; }
.dqp-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.dqp-brand { letter-spacing: .02em; }
.dqp-spacer { flex: 1; }
.dqp-btn { font: inherit; font-size: 12.5px; border-radius: 6px; padding: 5px 12px; cursor: pointer; border: 1px solid var(--dq-line); background: var(--dq-bg); color: var(--dq-fg); }
.dqp-primary { background: var(--dq-accent); border-color: var(--dq-accent); color: var(--dq-bg); font-weight: 500; }
.dqp-seg { display: inline-flex; border: 1px solid var(--dq-line); border-radius: 6px; overflow: hidden; }
.dqp-seg button, .dqp-seg input { font: inherit; font-size: 12.5px; background: transparent; color: var(--dq-fg); border: 0; padding: 4px 10px; }
.dqp-seg > * + * { border-left: 1px solid var(--dq-line); }
.dqp-seg button[aria-pressed='true'], .dqp-seg input.dqp-on { background: var(--dq-accent); color: var(--dq-bg); }
.dqp-seg input { width: 150px; }
.dqp-dsl textarea { width: 100%; box-sizing: border-box; font: 12.5px/1.5 ui-monospace, monospace; background: var(--dq-code); color: var(--dq-fg); border: 1px solid transparent; border-radius: 6px; padding: 6px 8px; resize: vertical; }
.dqp-dsl textarea.dqp-bad { border-color: var(--dq-fail); }
.dqp-msg { margin: 4px 0 0; font-size: 12px; color: var(--dq-muted); }
pre.dqp-msg { font: 12px/1.5 ui-monospace, monospace; white-space: pre; overflow-x: auto; }
.dqp-msg.dqp-bad { color: var(--dq-fail); }
.dqp-main { display: grid; grid-template-columns: 270px minmax(0, 1fr); gap: 12px; align-items: start; }
@media (max-width: 760px) { .dqp-main { grid-template-columns: 1fr; } }
.dqp-side, .dqp-stage { border: 1px solid var(--dq-line); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.dqp-count { margin: 0; font-variant-numeric: tabular-nums; }
.dqp-count b { font-size: 16px; }
.dqp-card { border: 1px solid var(--dq-line); border-radius: 8px; padding: 8px 9px; display: flex; flex-direction: column; gap: 6px; }
.dqp-card-h { display: flex; align-items: center; gap: 6px; }
.dqp-key { font-family: ui-monospace, monospace; font-weight: 500; font-size: 12.5px; }
.dqp-badge { font-size: 10px; letter-spacing: .04em; color: var(--dq-muted); border: 1px solid var(--dq-line); border-radius: 4px; padding: 0 5px; }
.dqp-x { margin-left: auto; font: inherit; font-size: 15px; background: transparent; border: 0; color: var(--dq-muted); cursor: pointer; }
.dqp-strip { position: relative; height: 14px; border-radius: 3px; background: var(--dq-code); }
.dqp-strip i { position: absolute; top: 3px; width: 3px; height: 8px; border-radius: 1px; background: var(--dq-muted); opacity: .55; }
.dqp-strip i.dqp-on { background: var(--dq-accent); opacity: 1; }
.dqp-ref { position: absolute; top: 0; bottom: 0; border-left: 1.5px dashed var(--dq-fail); }
.dqp-range { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.dqp-range input { width: 64px; font: inherit; font-size: 12px; padding: 3px 5px; border: 1px solid var(--dq-line); border-radius: 5px; background: var(--dq-bg); color: var(--dq-fg); }
.dqp-checks { display: flex; flex-wrap: wrap; gap: 4px; }
.dqp-chk { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; border: 1px solid var(--dq-line); border-radius: 999px; padding: 1px 8px 1px 5px; cursor: pointer; }
.dqp-chk input { margin: 0; accent-color: var(--dq-accent); }
.dqp-n { color: var(--dq-muted); font-variant-numeric: tabular-nums; }
.dqp-hint, .dqp-raw { margin: 0; font-size: 12px; color: var(--dq-muted); }
.dqp-add { font: inherit; font-size: 12.5px; padding: 5px 6px; border: 1px dashed var(--dq-line); border-radius: 6px; background: transparent; color: var(--dq-fg); }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--dq-accent); outline-offset: 1px; }
```

- [ ] **Step 4: Wire into `src/main.ts`** — add imports and, at the end of `main()`:
```ts
import { mountPanel } from './panel/mount';
import { setType } from './host/actions';
import panelCss from './style/panel.css?inline';
// … inside main(), after provideModel:
  const style = document.createElement('style');
  style.textContent = panelCss;
  document.head.appendChild(style);
  const panel = mountPanel(document.getElementById('app')!, {
    evaluate: (dsl, uuid) => engine.evaluate(dsl, uuid),
    save: (uuid, macro, dsl) => saveDsl(api, uuid, macro, dsl),
    setType: (key, type) => setType(api, typesPage(), key, type),
    jump: async (uuid) => {
      logseq.hideMainUI();
      await jumpTo(api, uuid);
    },
    close: () => logseq.hideMainUI(),
    report,
  });
  window.addEventListener('dataquery:changed', () => panel.refresh());
  setOpenPanel(async (uuid) => {
    const { macro, dsl } = await readMacro(api, uuid);
    panel.open({ uuid, dsl, macro });
    logseq.showMainUI({ autoFocus: true });
  });
  const applyTheme = (mode: string) => (document.documentElement.dataset.theme = mode === 'dark' ? 'dark' : 'light');
  applyTheme((await logseq.App.getUserConfigs()).preferredThemeMode);
  logseq.App.onThemeModeChanged(({ mode }) => applyTheme(mode));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && logseq.hideMainUI());
```

- [ ] **Step 5: Verify**: `npx vitest run && npx tsc -b && npx vite build` → all PASS.

- [ ] **Step 6: Commit**: `git add -A && git commit -m "feat(panel): shell, DSL bar, scope switch and filter cards"`

---

### Task 13: Panel — plot controls, chart, table

**Files:**
- Create: `src/panel/PlotControls.tsx`, `src/panel/ChartView.tsx`, `src/panel/DataTable.tsx`
- Replace: `src/panel/Stage.tsx`
- Modify: `src/style/panel.css` (append)
- Test: `tests/panel/stage.test.tsx`

**Interfaces:**
- Consumes: chart (Task 7), view `cellClass` (Task 8), `PanelDeps` (Task 12).
- Produces: `Stage(props: { query: Query; result?: QueryResult; deps: PanelDeps; onChange(q: Query): void })`.

- [ ] **Step 1: Write the failing test** `tests/panel/stage.test.tsx`
```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDsl, printDsl, type Query } from '../../src/core/dsl';
import type { QueryResult } from '../../src/core/query';
import type { Row } from '../../src/core/rows';
import type { PanelDeps } from '../../src/panel/mount';
import { Stage } from '../../src/panel/Stage';

const row = (id: string, values: Record<string, string>): Row => ({
  id, title: id, values, sources: [{ uuid: id, pageTitle: 'P', journalDay: null }], conflicts: {},
});
const rows = [row('a', { gre: '1.27', r2: '0.99', combine: 'none' }), row('b', { gre: '0.20', r2: '0.98', combine: 'mean' })];
const result: QueryResult = { scoped: rows, rows, cols: ['gre', 'r2', 'combine'], types: { gre: 'ratio', r2: 'number', combine: 'string' }, warnings: [] };
const q = (t: string): Query => {
  const r = parseDsl(t);
  if (!r.ok) throw new Error(r.error.message);
  return r.query;
};
const deps = (): PanelDeps => ({
  evaluate: vi.fn(), save: vi.fn(), setType: vi.fn(async () => {}), jump: vi.fn(async () => {}), close: vi.fn(), report: vi.fn(),
});

afterEach(cleanup);

describe('Stage', () => {
  it('switching to Scatter picks the first two numeric keys', async () => {
    const onChange = vi.fn();
    render(<Stage query={q('')} result={result} deps={deps()} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Scatter' }));
    expect(printDsl(onChange.mock.calls[0][0])).toBe('plot scatter x=gre y=r2');
  });

  it('switching to Bar picks the first discrete key and first numeric key', async () => {
    const onChange = vi.fn();
    render(<Stage query={q('')} result={result} deps={deps()} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bar' }));
    expect(printDsl(onChange.mock.calls[0][0])).toBe('plot bar x=combine y=gre');
  });

  it('header click cycles sort asc → desc → none', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Stage query={q('')} result={result} deps={deps()} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /^gre/ }));
    expect(printDsl(onChange.mock.lastCall![0])).toBe('sort gre');
    rerender(<Stage query={q('sort gre')} result={result} deps={deps()} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /^gre/ }));
    expect(printDsl(onChange.mock.lastCall![0])).toBe('sort gre desc');
    rerender(<Stage query={q('sort gre desc')} result={result} deps={deps()} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /^gre/ }));
    expect(printDsl(onChange.mock.lastCall![0])).toBe('');
  });

  it('changing a column type writes to the types page', async () => {
    const d = deps();
    render(<Stage query={q('')} result={result} deps={d} onChange={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText('r2 type'), 'ratio');
    expect(d.setType).toHaveBeenCalledWith('r2', 'ratio');
  });

  it('clicking a point or row link jumps', async () => {
    const d = deps();
    const { container } = render(<Stage query={q('plot scatter x=gre y=r2')} result={result} deps={d} onChange={vi.fn()} />);
    await userEvent.click(container.querySelector('circle[data-uuid="b"]')!);
    expect(d.jump).toHaveBeenCalledWith('b');
    await userEvent.click(screen.getByRole('button', { name: 'a' }));
    expect(d.jump).toHaveBeenCalledWith('a');
  });
});
```

- [ ] **Step 2: Run to see it fail**: `npx vitest run tests/panel/stage.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

`src/panel/Stage.tsx`:
```tsx
import type { Query } from '../core/dsl';
import type { QueryResult } from '../core/query';
import { ChartView } from './ChartView';
import { DataTable } from './DataTable';
import type { PanelDeps } from './mount';
import { PlotControls } from './PlotControls';

export function Stage({ query, result, deps, onChange }: { query: Query; result?: QueryResult; deps: PanelDeps; onChange(q: Query): void }) {
  return (
    <section className="dqp-stage">
      <PlotControls query={query} result={result} onChange={onChange} />
      {result && query.plot && <ChartView query={query} result={result} onJump={(u) => void deps.jump(u).catch(deps.report)} />}
      {result && <DataTable query={query} result={result} deps={deps} onChange={onChange} />}
      {result?.warnings.map((w) => <p key={w} className="dqp-msg">{w}</p>)}
    </section>
  );
}
```

`src/panel/PlotControls.tsx`:
```tsx
import type { Plot, Query } from '../core/dsl';
import type { QueryResult } from '../core/query';
import { isNumericType } from '../core/types';

export function PlotControls({ query, result, onChange }: { query: Query; result?: QueryResult; onChange(q: Query): void }) {
  const types = result?.types ?? {};
  const keys = [...new Set((result?.scoped ?? []).flatMap((r) => Object.keys(r.values)))];
  const numeric = keys.filter((k) => isNumericType(types[k] ?? 'string'));
  const discrete = keys.filter((k) => !isNumericType(types[k] ?? 'string'));
  const plot = query.plot;
  const set = (p: Plot | undefined) => onChange({ ...query, plot: p });
  const kind = plot?.kind ?? 'none';
  const pick = (value: string, options: string[], label: string, onPick: (v: string) => void, allowNone = false) => (
    <label className="dqp-field">
      {label}
      <select aria-label={label} value={value} onChange={(e) => onPick(e.target.value)}>
        {allowNone && <option value="">(none)</option>}
        {options.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
    </label>
  );
  return (
    <div className="dqp-pctl">
      <span className="dqp-seg" role="group" aria-label="Chart">
        <button type="button" aria-pressed={kind === 'scatter'} onClick={() => set({ kind: 'scatter', x: numeric[0] ?? keys[0] ?? 'x', y: numeric[1] ?? numeric[0] ?? keys[0] ?? 'y', labels: true })}>Scatter</button>
        <button type="button" aria-pressed={kind === 'bar'} onClick={() => set({ kind: 'bar', x: discrete[0] ?? keys[0] ?? 'x', ys: [numeric[0] ?? keys[0] ?? 'y'] })}>Bar</button>
        <button type="button" aria-pressed={kind === 'none'} onClick={() => set(undefined)}>Table only</button>
      </span>
      {plot?.kind === 'scatter' && (
        <>
          {pick(plot.x, numeric, 'x', (x) => set({ ...plot, x }))}
          {pick(plot.y, numeric, 'y', (y) => set({ ...plot, y }))}
          {pick(plot.color ?? '', discrete, 'Colour', (c) => set({ ...plot, color: c || undefined }), true)}
          <label className="dqp-chk">
            <input type="checkbox" checked={plot.labels} onChange={(e) => set({ ...plot, labels: e.target.checked })} />
            Labels
          </label>
        </>
      )}
      {plot?.kind === 'bar' && (
        <>
          {pick(plot.x, discrete, 'x', (x) => set({ ...plot, x }))}
          <span className="dqp-checks">
            {numeric.map((k) => (
              <label key={k} className="dqp-chk">
                <input
                  type="checkbox"
                  checked={plot.ys.includes(k)}
                  onChange={() => {
                    const ys = plot.ys.includes(k) ? plot.ys.filter((y) => y !== k) : [...plot.ys, k];
                    if (ys.length) set({ ...plot, ys });
                  }}
                />
                {k}
              </label>
            ))}
          </span>
        </>
      )}
    </div>
  );
}
```

`src/panel/ChartView.tsx`:
```tsx
import { barSvg, legendHtml, scatterSvg } from '../core/chart';
import type { Query } from '../core/dsl';
import type { QueryResult } from '../core/query';

export function ChartView({ query, result, onJump }: { query: Query; result: QueryResult; onJump(uuid: string): void }) {
  const p = query.plot!;
  const c = p.kind === 'scatter' ? scatterSvg(result.rows, p, result.types, query.mergeBy) : barSvg(result.rows, p, result.types);
  return (
    <div
      className="dq dqp-chart"
      onClick={(e) => {
        const el = (e.target as Element).closest('[data-uuid]');
        if (el) onJump(el.getAttribute('data-uuid')!);
      }}
      dangerouslySetInnerHTML={{ __html: c.html + legendHtml(c.legend) }}
    />
  );
}
```

`src/panel/DataTable.tsx`:
```tsx
import type { Query } from '../core/dsl';
import type { QueryResult } from '../core/query';
import { rowLabel } from '../core/rows';
import { isNumericType, VALUE_TYPES, type ValueType } from '../core/types';
import { cellClass } from '../core/view';
import type { PanelDeps } from './mount';

export function DataTable({ query, result, deps, onChange }: { query: Query; result: QueryResult; deps: PanelDeps; onChange(q: Query): void }) {
  const sorted = query.sort[0];
  const cycle = (key: string) => {
    if (sorted?.key !== key) onChange({ ...query, sort: [{ key, desc: false }] });
    else if (!sorted.desc) onChange({ ...query, sort: [{ key, desc: true }] });
    else onChange({ ...query, sort: [] });
  };
  const right = (t: ValueType) => isNumericType(t) || t === 'numlist';
  if (!result.rows.length) return <p className="dqp-msg">No rows match.</p>;
  return (
    <div className="dq dqp-tbl">
      <table>
        <thead>
          <tr>
            <th>{query.mergeBy ?? 'block'}</th>
            {result.cols.map((k) => {
              const t = result.types[k] ?? 'string';
              return (
                <th key={k} className={right(t) ? 'dq-num' : ''}>
                  <button type="button" className="dqp-sort" onClick={() => cycle(k)}>
                    {k}{sorted?.key === k ? (sorted.desc ? ' ▼' : ' ▲') : ''}
                  </button>
                  <select aria-label={`${k} type`} className="dqp-type" value={t} onChange={(e) => void deps.setType(k, e.target.value as ValueType).catch(deps.report)}>
                    {VALUE_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => (
            <tr key={r.id}>
              <td>
                <button type="button" className="dqp-link" onClick={() => void deps.jump(r.sources[0].uuid).catch(deps.report)}>
                  {rowLabel(r, query.mergeBy)}
                </button>
              </td>
              {result.cols.map((k) => {
                const t = result.types[k] ?? 'string';
                const cls = [right(t) ? 'dq-num' : '', cellClass(t, r.values[k]), r.conflicts[k] ? 'dq-conflict' : ''].filter(Boolean).join(' ');
                return (
                  <td key={k} className={cls} title={r.conflicts[k]?.map((c) => `${c.value} (${c.pageTitle})`).join(' / ')}>
                    {r.values[k] ?? ''}
                    {r.conflicts[k] && <sup>⚠</sup>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Append to `src/style/panel.css` (the panel reuses the inline `.dq` chart/table rules, so import them too):
```css
@import './inline.css';
.dqp-pctl { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 12.5px; }
.dqp-field { display: inline-flex; align-items: center; gap: 4px; color: var(--dq-muted); }
.dqp-field select { font: inherit; font-size: 12.5px; padding: 3px 5px; border: 1px solid var(--dq-line); border-radius: 5px; background: var(--dq-bg); color: var(--dq-fg); }
.dqp-chart, .dqp-tbl { border: 0; margin: 0; }
.dqp-chart .dq-chart { max-width: 100%; max-height: 440px; }
.dqp-sort { font: inherit; font-weight: 500; background: transparent; border: 0; padding: 0; color: inherit; cursor: pointer; }
.dqp-type { display: block; margin-top: 2px; font: inherit; font-size: 10px; color: var(--dq-muted); background: transparent; border: 1px solid transparent; border-radius: 4px; cursor: pointer; }
.dqp-type:hover { border-color: var(--dq-line); }
.dqp-link { font: inherit; background: transparent; border: 0; padding: 0; color: var(--dq-accent); cursor: pointer; }
```
Place the `@import` lines at the very top of `panel.css` (CSS requires imports first): the file starts with `@import './tokens.css'; @import './inline.css';`.

- [ ] **Step 4: Verify**: `npx vitest run && npx tsc -b && npx vite build` → all PASS.

- [ ] **Step 5: Add M2 to `docs/manual-checks.md`**
```markdown
## M2 panel
- [ ] "Open ↗" opens the panel with the macro's query; Esc and ✕ close it.
- [ ] Unticking a value chip, editing a min/max, adding a condition all rewrite the query text and the count.
- [ ] Typing a query and pressing Enter updates the cards; a bad query shows the caret message.
- [ ] Scatter/Bar/Table only, axis pickers, Labels work; clicking a point closes the panel and scrolls to the block.
- [ ] Column header click sorts; the type picker writes `key:: type` into the types page and the view re-types.
- [ ] Save to page rewrites the macro; editing the macro block meanwhile and then saving shows the "edited after this view opened" error.
- [ ] Panel follows light/dark theme.
```

- [ ] **Step 6: Commit**: `git add -A && git commit -m "feat(panel): plot controls, chart and sortable typed table"`

---

### Task 14: README and release shape

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`** (English):
```markdown
# Data Query for Logseq

Turn blocks with properties into a typed table, scatter plot or bar chart — right where you write them — and explore them in a filter panel.

    - Seed sweep
      - {{renderer :dataquery, where type = run | sort score | plot scatter x=score y=loss color=seed}}
      - run-a
        type:: run
        seed:: 0
        score:: 0.96
        loss:: 1.27

## Why
Logseq's built-in query tables compare property values as text: `10 < 9`, `0.20 ≠ 0.2`, and there are no charts. Data Query reads the raw property text, infers a type per key, and compares numbers as numbers.

## Query language
Clauses are separated by `|`; all are optional.

| Clause | Meaning |
|---|---|
| `in here` / `in page` / `in [[Page]]` | Which blocks: under the macro's parent (default), this page, or blocks linked to a page (tags on ancestors count) |
| `merge by key` | Blocks with the same `key` value become one row; disagreements are flagged ⚠ |
| `where a < 1 and b in (x, y) and c has 16` | Filters. Operators: `= != < <= > >=`, `in (…)`, `has n` (number lists like `8/16`) |
| `sort a desc, b` | Typed sort; missing values last |
| `cols a, b, prefix-*` | Table columns |
| `plot scatter x=a y=b [color=c] [labels=off]` | Scatter plot |
| `plot bar x=c y=a,b` | Bar chart; groups with 2+ rows show mean and min–max whiskers |

## Types
Inferred per key across the graph: `number`, `numlist` (`8/16`), `string`. Override on the types page (default `dataquery/types`, configurable) as page properties:

    seed:: category
    score-*:: ratio

`ratio` means "value divided by its threshold": charts draw a line at 1.00 and table cells turn green below 1.00 and red at or above.

## Panel
Click **Open ↗** on a view to filter with cards, switch charts, sort by clicking headers and change column types. The panel and the query text stay in sync; **Save to page** writes the query back into the macro.

## Install (development)
    npm install && npm run build
Logseq → Settings → Advanced → Developer mode → Plugins → Load unpacked plugin → this folder.

Works with Logseq 0.10.x (file graphs).

## License
MIT
```

The short `{{dataquery …}}` alias is **not** documented until the manual check confirms it works (spec §8).

- [ ] **Step 2: Verify**: `npx vitest run && npx tsc -b && npx vite build` → all PASS.

- [ ] **Step 3: Commit**: `git add -A && git commit -m "docs: README"`

---

## Spec coverage map

| Spec section | Task |
|---|---|
| §1 DSL grammar, errors, print round-trip, comma rejoin | 4 |
| §1 rows definition, merge by, cols, clause order | 5, 6 |
| §2 types, inference, overrides, verbatim display | 3, 6, 8 |
| §3 collection, raw text parsing, merge priority, onChanged 300 ms | 2, 5, 10, 11 |
| §4 inline view, jump/open/labels, error box, theme, palette | 7, 8, 11 |
| §5 panel: scope, DSL bar, cards, chart/table, save, conflict refusal | 9, 12, 13 |
| §6 errors with cause | 10 (`errorText`, collect wrappers), 11 (`report`) |
| §7 tests; manual checks for gyp | all; `docs/manual-checks.md` (11, 13) |
| §8 release shape, README, alias only after check | 1, 14 |
