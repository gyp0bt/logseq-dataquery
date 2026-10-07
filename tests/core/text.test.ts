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

describe('unicode keys', () => {
  it('reads keys in any script', () => expect(parseContent('温度:: 20\ndone?:: true').props).toEqual({ '温度': '20', 'done?': 'true' }));
});

describe('isBuiltinKey', () => {
  it('knows Logseq keys and prefixes', () => {
    for (const k of ['id', 'collapsed', 'heading', 'query-properties', 'card-next-schedule', 'hl-page', 'logseq.order-list-type'])
      expect(isBuiltinKey(k)).toBe(true);
    expect(isBuiltinKey('seed')).toBe(false);
  });
});
