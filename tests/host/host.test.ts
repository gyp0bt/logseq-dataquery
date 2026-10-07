import { describe, expect, it, vi } from 'vitest';
import { errorText, jumpTo, readMacro, saveDsl, setSettingInMacro } from '../../src/host/actions';
import { fetchOrder, fetchTypeOverrides, toSourceBlock } from '../../src/host/collect';
import { Engine } from '../../src/host/engine';
import { InlineViews } from '../../src/host/inline';
import { fakeLogseq } from './fakeLogseq';

const graph = () =>
  fakeLogseq({
    'Sep 28th, 2026': [
      {
        uuid: 'h', content: '## #work/nsb seeds\nreport:: x', refs: ['work/nsb'], journalDay: 20260928,
        children: [
          { uuid: 'm', content: '{{renderer :DQtable, #work/nsb  sort:gre}}', refs: ['work/nsb'], journalDay: 20260928 },
          { uuid: 'a', content: 'A\nrun:: a\ngre:: 1.27', refs: ['work/nsb'], journalDay: 20260928 },
          { uuid: 'b', content: 'B\nrun:: b\ngre:: 0.96', refs: ['work/nsb'], journalDay: 20260928 },
        ],
      },
      { uuid: 'z', content: 'Z\nrun:: z\ngre:: 3', journalDay: 20260928 },
    ],
    'dataquery/types': [{ uuid: 't', content: 'gre:: ratio\nseed:: float', preBlock: true }],
  });

describe('collect', () => {
  it('normalises the key spellings Logseq may return', () => {
    const want = { uuid: 'u', content: 'k:: v', page: 'p', pageTitle: 'P', journalDay: 1, pathRefs: ['x'], preBlock: true, seq: 0 };
    expect(toSourceBlock({ uuid: 'u', content: 'k:: v', 'preBlock?': true, page: { name: 'P', originalName: 'P', journalDay: 1 }, pathRefs: [{ name: 'X' }] })).toEqual(want);
    expect(toSourceBlock({ uuid: 'u', content: 'k:: v', 'pre-block?': true, page: { name: 'P', 'original-name': 'P', 'journal-day': 1 }, 'path-refs': [{ name: 'X' }] })).toEqual(want);
    expect(toSourceBlock({ content: 'no uuid' })).toBeNull();
  });
  it('returns the outline order of the whole page', async () => {
    expect([...(await fetchOrder(graph(), 'm')).keys()]).toEqual(['h', 'm', 'a', 'b', 'z']);
  });
  it('accepts a UUID object and keeps the database id', () => {
    expect(toSourceBlock({ id: 42, uuid: { uuid: 'u' }, content: 'k:: v', page: { name: 'p' } })).toMatchObject({ uuid: 'u', seq: 42 });
  });
  it('reads type overrides and their warnings', async () => {
    const ov = await fetchTypeOverrides(graph(), 'dataquery/types');
    expect(ov.exact).toEqual({ gre: 'ratio' });
    expect(ov.warnings).toHaveLength(1);
    expect((await fetchTypeOverrides(graph(), 'missing')).exact).toEqual({});
  });
});

describe('Engine', () => {
  it('evaluates with graph-wide types, excluding the types page', async () => {
    const ev = await new Engine(graph(), () => 'dataquery/types').evaluate('#work/nsb sort:gre', 'table', 'm');
    expect(ev.result!.rows.map((r) => r.id)).toEqual(['b', 'a', 'h']);
    expect(ev.result!.types.gre).toBe('ratio');
    expect(ev.result!.types.seed).toBeUndefined();
    expect(ev.result!.warnings[0]).toContain("Unknown type 'float'");
  });
  it('returns parse errors without touching the DB', async () => {
    const api = graph();
    const ev = await new Engine(api, () => 'dataquery/types').evaluate('x<', 'table', 'm');
    expect(ev.parsed.ok).toBe(false);
    expect(api.DB.datascriptQuery).not.toHaveBeenCalled();
  });
  it('caches until invalidated', async () => {
    const api = graph();
    const e = new Engine(api, () => 'dataquery/types');
    await e.evaluate('', 'table', 'm');
    await e.evaluate('', 'table', 'm');
    expect(api.DB.datascriptQuery).toHaveBeenCalledTimes(1);
    e.invalidate();
    await e.evaluate('', 'table', 'm');
    expect(api.DB.datascriptQuery).toHaveBeenCalledTimes(2);
  });
  it('wraps DB failures with the cause attached and does not cache them', async () => {
    const api = graph();
    api.DB.datascriptQuery.mockRejectedValueOnce(new Error('boom'));
    const e = new Engine(api, () => 'dataquery/types');
    const err = await e.evaluate('', 'table', 'm').catch((x) => x);
    expect(errorText(err)).toBe('Could not read blocks from the Logseq database. (cause: boom)');
    expect((await e.evaluate('run', 'table', 'm')).result!.rows).toHaveLength(3);
  });
});

describe('actions', () => {
  it('saveDsl rewrites the macro and refuses after a concurrent edit', async () => {
    const api = graph();
    const { macro, kind, dsl } = await readMacro(api, 'm');
    expect([kind, dsl]).toEqual(['table', '#work/nsb  sort:gre']);
    expect(await saveDsl(api, 'm', macro, 'scatter', 'sort:-gre')).toBe('{{renderer :DQscatter, sort:-gre}}');
    expect(api.Editor.updateBlock).toHaveBeenCalledWith('m', '{{renderer :DQscatter, sort:-gre}}');
    await expect(saveDsl(api, 'm', macro, 'table', 'sort:run')).rejects.toThrow('The query block was edited after this view was drawn.');
  });
  it('setSettingInMacro edits one setting and keeps the rest of the text (Review Focus 3)', async () => {
    const api = graph();
    await setSettingInMacro(api, 'm', 'sort', '-gre');
    expect(api.Editor.updateBlock).toHaveBeenLastCalledWith('m', '{{renderer :DQtable, #work/nsb  sort:-gre}}');
    await setSettingInMacro(api, 'm', 'x', 'run');
    expect(api.Editor.updateBlock).toHaveBeenLastCalledWith('m', '{{renderer :DQtable, #work/nsb  sort:-gre x:run}}');
    await setSettingInMacro(api, 'm', 'sort', null);
    expect(api.Editor.updateBlock).toHaveBeenLastCalledWith('m', '{{renderer :DQtable, #work/nsb x:run}}');
    api.Editor.updateBlock.mockClear();
    await setSettingInMacro(api, 'm', 'color', null);
    expect(api.Editor.updateBlock).not.toHaveBeenCalled();
  });
  it('readMacro says so when the macro is gone', async () => {
    await expect(readMacro(graph(), 'a')).rejects.toThrow('no longer contains a DQtable, DQscatter or DQbar macro');
  });
  it('jumpTo scrolls to the block in its page', async () => {
    const api = graph();
    await jumpTo(api, 'a');
    expect(api.Editor.scrollToBlockInPage).toHaveBeenCalledWith('Sep 28th, 2026', 'a');
  });
});

describe('InlineViews', () => {
  it('renders into the slot, re-renders on refresh, forgets vanished slots', async () => {
    const provide = vi.fn();
    const alive = new Set(['s1']);
    const views = new InlineViews(new Engine(graph(), () => 'dataquery/types'), provide, (s) => alive.has(s));
    await views.show('s1', 'm', 'table', '#work/nsb sort:gre');
    expect(provide).toHaveBeenLastCalledWith('s1', expect.stringContaining('3 rows'));
    expect(views.view('m')!.result.rows).toHaveLength(3);
    provide.mockClear();
    await views.refreshAll();
    expect(provide).toHaveBeenCalledTimes(1);
    alive.delete('s1');
    provide.mockClear();
    await views.refreshAll();
    expect(provide).not.toHaveBeenCalled();
  });
  it('a slow older render does not overwrite a newer one', async () => {
    const real = new Engine(graph(), () => 'dataquery/types');
    const done = await real.evaluate('#work/nsb sort:gre', 'table', 'm');
    let releaseOld!: () => void;
    const evaluate = vi
      .fn()
      .mockImplementationOnce(() => new Promise((r) => (releaseOld = () => r({ ...done, result: { ...done.result!, rows: [] } }))))
      .mockImplementationOnce(async () => done);
    const provide = vi.fn();
    const views = new InlineViews({ evaluate } as unknown as Engine, provide, () => true);
    const first = views.show('s', 'm', 'table', '#work/nsb sort:gre');
    await views.refreshAll();
    releaseOld();
    await first;
    expect(provide).toHaveBeenCalledTimes(1);
    expect(provide.mock.calls[0][1]).toContain('3 rows');
  });
  it('shows failures inside the view instead of throwing', async () => {
    const api = graph();
    api.DB.datascriptQuery.mockRejectedValueOnce(new Error('boom'));
    const provide = vi.fn();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await new InlineViews(new Engine(api, () => 'dataquery/types'), provide, () => true).show('s', 'm', 'table', '');
    expect(provide.mock.calls[0][1]).toContain('Data query failed: Could not read blocks from the Logseq database. (cause: boom)');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
