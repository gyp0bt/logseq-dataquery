import { describe, expect, it, vi } from 'vitest';
import { CardCopier, StaleSnippet, type CardCopyDeps } from '../../src/host/cardCopy';
import { snippetId } from '../../src/core/cards';
import type { LogseqLike } from '../../src/host/api';

function setup(content: string, kids: Array<{ uuid: string; content: string }> = []) {
  const tree = { uuid: 'A', content, children: kids };
  const api = {
    Editor: {
      getBlock: vi.fn(async () => structuredClone(tree)),
      upsertBlockProperty: vi.fn(async (_u: string, _k: string, v: number) => {
        tree.content = tree.content.replace(/copies:: .*/, `copies:: ${v}`);
        if (!/copies::/.test(tree.content)) tree.content += `\ncopies:: ${v}`;
      }),
    },
  } as unknown as LogseqLike;
  const deps: CardCopyDeps = { writeText: vi.fn(async () => {}), writeImage: vi.fn(async () => {}) };
  return { api, deps, tree, copier: new CardCopier(api, deps) };
}
const code = { kind: 'code' as const, index: 0, id: snippetId('ls') };

describe('CardCopier', () => {
  it('copies a code body and adds one to copies', async () => {
    const { api, deps, copier } = setup('t\ncopies:: 12', [{ uuid: 'c', content: '```\nls\n```' }]);
    await expect(copier.copy('A', code)).resolves.toBe(13);
    expect(deps.writeText).toHaveBeenCalledWith('ls');
    expect(api.Editor.upsertBlockProperty).toHaveBeenCalledWith('A', 'copies', 13);
    expect(api.Editor.getBlock).toHaveBeenCalledWith('A', { includeChildren: true });
  });
  it('copies nothing when the snippet changed since it was drawn', async () => {
    const { api, deps, copier } = setup('t', [{ uuid: 'c', content: '```\nrm\n```' }]);
    await expect(copier.copy('A', code)).rejects.toBeInstanceOf(StaleSnippet);
    await expect(copier.copy('A', code)).rejects.toThrow('中身が変わったので選び直してください');
    expect(deps.writeText).not.toHaveBeenCalled();
    expect(api.Editor.upsertBlockProperty).not.toHaveBeenCalled();
  });
  it('does not count a failed clipboard write', async () => {
    const { api, deps, copier } = setup('t', [{ uuid: 'c', content: '```\nls\n```' }]);
    const boom = new Error('denied');
    (deps.writeText as any).mockRejectedValueOnce(boom);
    const err = await copier.copy('A', code).catch((e) => e);
    expect(err.cause).toBe(boom);
    expect(api.Editor.upsertBlockProperty).not.toHaveBeenCalled();
  });
  it('falls back to the image reference when the picture cannot go on the clipboard', async () => {
    const { deps, copier } = setup('t ![](../assets/a.png)');
    (deps.writeImage as any).mockRejectedValueOnce(new Error('no png'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(copier.copy('A', { kind: 'image', index: 0, id: snippetId('../assets/a.png') })).resolves.toBe(1);
    expect(warn).toHaveBeenCalled();
    expect(deps.writeText).toHaveBeenCalledWith('![](../assets/a.png)');
    warn.mockRestore();
  });
  it('counts two quick copies of one card as two', async () => {
    const { api, copier } = setup('t\ncopies:: 12', [{ uuid: 'c', content: '```\nls\n```' }]);
    await Promise.all([copier.copy('A', code), copier.copy('A', code)]);
    expect((api.Editor.upsertBlockProperty as any).mock.calls.map((c: any[]) => c[2])).toEqual([13, 14]);
  });
  it('starts a broken count again at 1', async () => {
    const { api, copier } = setup('t\ncopies:: abc', [{ uuid: 'c', content: '```\nls\n```' }]);
    await copier.copy('A', code);
    expect(api.Editor.upsertBlockProperty).toHaveBeenCalledWith('A', 'copies', 1);
  });
  it('copies the whole card as outline text', async () => {
    const { deps, copier } = setup('t\ncopies:: 2', [{ uuid: 'c', content: 'child' }]);
    await copier.copy('A', 'whole');
    expect(deps.writeText).toHaveBeenCalledWith('t\n- child');
  });
  it('says so when the block is gone', async () => {
    const { api, copier } = setup('t');
    (api.Editor.getBlock as any).mockResolvedValueOnce(null);
    await expect(copier.copy('A', 'whole')).rejects.toThrow('The card block no longer exists.');
  });
});
