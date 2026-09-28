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
  uuid, content, page: 'day', pageTitle: 'Day', journalDay: 1, pathRefs: [], preBlock: false, seq: 0,
});
const blocks = [
  b('a', 'run:: a\ncombine:: none\ngre:: 1.27\npatch:: 8'),
  b('b', 'run:: b\ncombine:: mean\ngre:: 1.49\npatch:: 8/16'),
  b('c', 'run:: c\ncombine:: mean\ngre:: 0.20\npatch:: 8/16'),
];
const types = computeTypes(blocks, parseTypeOverrides({ gre: 'ratio' }));

function deps(): PanelDeps & { [K in keyof PanelDeps]: ReturnType<typeof vi.fn> } {
  return {
    evaluate: vi.fn(async (dsl: string) => {
      const parsed = parseDsl(dsl);
      if (!parsed.ok) return { parsed };
      return { parsed, result: runQuery(parsed.query, { blocks, types, macroUuid: 'm', macroPage: 'day', hereIds: new Set(['a', 'b', 'c']) }) };
    }),
    save: vi.fn(async (_u: string, _m: string, dsl: string) => `{{renderer :dataquery, ${dsl}}}`),
    setType: vi.fn(async () => {}),
    jump: vi.fn(async () => {}),
    close: vi.fn(),
    report: vi.fn(),
  } as any;
}
const session = { uuid: 'm', dsl: 'where combine in (none, mean) | sort gre', macro: '{{renderer :dataquery, where combine in (none, mean) | sort gre}}' };
const queryBox = () => screen.getByLabelText('Query') as HTMLTextAreaElement;

afterEach(cleanup);

describe('panel App', () => {
  it('shows the DSL and the row count', async () => {
    render(<App session={session} deps={deps()} tick={0} />);
    expect(queryBox().value).toBe(session.dsl);
    await screen.findByText('3 of 3 rows');
  });

  it('GUI edits rewrite the DSL', async () => {
    const user = userEvent.setup();
    render(<App session={session} deps={deps()} tick={0} />);
    await screen.findByText('3 of 3 rows');
    await user.click(screen.getByRole('checkbox', { name: /none/ }));
    expect(queryBox().value).toBe('where combine = mean | sort gre');
    await screen.findByText('2 of 3 rows');
  });

  it('typed DSL updates the GUI on Enter and reports errors in place', async () => {
    const user = userEvent.setup();
    render(<App session={session} deps={deps()} tick={0} />);
    await screen.findByText('3 of 3 rows');
    await user.clear(queryBox());
    await user.type(queryBox(), 'where gre < 1{Enter}');
    await screen.findByText('1 of 3 rows');
    expect((screen.getByLabelText('gre maximum') as HTMLInputElement).value).toBe('1');
    await user.clear(queryBox());
    await user.type(queryBox(), 'where gre <{Enter}');
    expect(await screen.findByText(/Missing value after '<'/)).toBeTruthy();
  });

  it('adds a condition card from the picker', async () => {
    const user = userEvent.setup();
    render(<App session={{ ...session, dsl: '' }} deps={deps()} tick={0} />);
    await screen.findByText('3 of 3 rows');
    await user.selectOptions(screen.getByLabelText('Add condition'), 'patch');
    await user.click(screen.getByRole('checkbox', { name: '16' }));
    expect(queryBox().value).toBe('where patch has 16');
    await screen.findByText('2 of 3 rows');
  });

  it('Save to page sends the current DSL; Revert goes back to what the page holds', async () => {
    const user = userEvent.setup();
    const d = deps();
    render(<App session={session} deps={d} tick={0} />);
    await screen.findByText('3 of 3 rows');
    await user.click(screen.getByRole('button', { name: 'Page' }));
    await user.click(screen.getByRole('button', { name: 'Save to page' }));
    const saved = 'in page | where combine in (none, mean) | sort gre';
    expect(d.save).toHaveBeenCalledWith('m', session.macro, saved);
    await screen.findByText('Saved to page.');
    await user.click(screen.getByRole('button', { name: 'Here' }));
    await user.click(screen.getByRole('button', { name: 'Revert' }));
    expect(queryBox().value).toBe(saved);
    await user.click(screen.getByRole('button', { name: 'Save to page' }));
    expect(d.save).toHaveBeenLastCalledWith('m', `{{renderer :dataquery, ${saved}}}`, saved);
  });

  it('saves typed text that was not applied yet, and refuses invalid text', async () => {
    const user = userEvent.setup();
    const d = deps();
    render(<App session={session} deps={d} tick={0} />);
    await screen.findByText('3 of 3 rows');
    await user.clear(queryBox());
    await user.type(queryBox(), 'where gre <');
    await user.click(screen.getByRole('button', { name: 'Save to page' }));
    expect(d.save).not.toHaveBeenCalled();
    expect(screen.getByText(/Missing value after '<'/)).toBeTruthy();
    await user.type(queryBox(), ' 1');
    await user.click(screen.getByRole('button', { name: 'Save to page' }));
    expect(d.save).toHaveBeenCalledWith('m', session.macro, 'where gre < 1');
    await screen.findByText('1 of 3 rows');
  });

  it('save failures are reported, not swallowed', async () => {
    const user = userEvent.setup();
    const d = deps();
    const boom = new Error('edited elsewhere');
    d.save.mockRejectedValueOnce(boom);
    render(<App session={session} deps={d} tick={0} />);
    await screen.findByText('3 of 3 rows');
    await user.click(screen.getByRole('button', { name: 'Save to page' }));
    expect(d.report).toHaveBeenCalledWith(boom);
  });

  it('re-evaluates when tick changes', async () => {
    const d = deps();
    const { rerender } = render(<App session={session} deps={d} tick={0} />);
    await screen.findByText('3 of 3 rows');
    await act(async () => rerender(<App session={session} deps={d} tick={1} />));
    await waitFor(() => expect(d.evaluate).toHaveBeenCalledTimes(2));
  });
});
