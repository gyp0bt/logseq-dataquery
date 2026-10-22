import { describe, expect, it } from 'vitest';
import { parseTsv, toHtmlTable, toTsv } from '../../src/core/tsv';

describe('tsv', () => {
  it('round-trips cells holding tabs, quotes and newlines', () => {
    const rows = [['a', 'b\tc', 'say "hi"'], ['line1\nline2', '', 'z']];
    expect(parseTsv(toTsv(rows))).toEqual(rows);
  });
  it('reads a spreadsheet copy with a trailing newline and CRLF', () => {
    expect(parseTsv('1\t2\r\n3\t4\r\n')).toEqual([['1', '2'], ['3', '4']]);
    expect(parseTsv('only')).toEqual([['only']]);
    expect(parseTsv('')).toEqual([]);
  });
  it('keeps empty cells', () => {
    expect(parseTsv('a\t\tc')).toEqual([['a', '', 'c']]);
  });
  it('builds an escaped HTML table', () => {
    expect(toHtmlTable([['<b>', 'x\ny']])).toBe('<table><tbody><tr><td>&lt;b&gt;</td><td>x<br>y</td></tr></tbody></table>');
  });
});
