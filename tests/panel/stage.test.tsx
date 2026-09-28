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
const deps = () => ({
  evaluate: vi.fn(), save: vi.fn(), setType: vi.fn(async () => {}), jump: vi.fn(async () => {}), close: vi.fn(), report: vi.fn(),
}) satisfies PanelDeps;

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
