import { esc } from './html';

/** Cells as the clipboard carries them: tab between cells, newline between rows, quotes around a cell that holds either. */
export function toTsv(rows: string[][]): string {
  const q = (v: string) => (/[\t\r\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(q).join('\t')).join('\n');
}

/** The same cells as an HTML table, which Excel and Google Sheets paste as cells. */
export function toHtmlTable(rows: string[][]): string {
  return `<table><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v).replace(/\r?\n/g, '<br>')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

/** Read tab-separated text back into rows of cells (quotes may hold tabs, newlines and doubled quotes). */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const s = text.replace(/\r\n?/g, '\n');
  const endRow = () => {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = '';
  };
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === '\t') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') endRow();
    else cell += c;
    i++;
  }
  // A trailing newline (every spreadsheet copy ends with one) does not start another row.
  if (cell !== '' || row.length) endRow();
  return rows;
}
