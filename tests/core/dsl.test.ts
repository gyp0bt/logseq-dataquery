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
    expect(ok('').scope).toEqual({ kind: 'all' });
    expect(ok('from run').mergeBy).toBe('run');
    expect(err('from run | merge by x').message).toBe("Use either 'from' or 'merge by', not both.");
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
    expect(err('frm run')).toEqual({ message: "Unknown clause 'frm'. Use from, in, where, sort, cols or plot.", col: 0 });
    expect(err('where a < b').message).toBe("'<' compares numbers, got 'b'.");
    expect(err('where a = 1 | where b = 2').message).toBe("Duplicate 'where' clause. Combine them into one.");
    expect(err('where combine in none').message).toBe("Write 'in' values in parentheses, e.g. combine in (none, mean).");
    expect(err('where a = 1 and').message).toBe("Cannot read condition 'a = 1 and'. Example: gre-thin < 1.3");
    expect(err('plot scatter x=a').message).toBe('plot scatter needs y=.');
    expect(err('plot pie x=a').message).toBe("Unknown plot 'pie'. Use scatter or bar.");
    expect(err('plot bar x=a y=b color=c').message).toBe("'color=' is not an option of plot bar. Use x=, y=.");
    expect(err('in everywhere').message).toBe("'in' takes all, here, page or [[Page name]].");
    expect(err('merge run').message).toBe("Write 'merge by <key>', e.g. merge by run.");
    expect(err('sort a | | where b = 1')).toEqual({ message: "Empty clause between '|'. Remove the extra '|'.", col: 9 });
    expect(err('where patch has x').message).toBe("'has' takes a number, got 'x'.");
  });
});

describe('keys and macro safety', () => {
  it('accepts Unicode and ? keys', () => {
    expect(ok('where 温度 >= 20 and done? = true').where.map((c) => c.key)).toEqual(['温度', 'done?']);
  });
  it('rejects text that would break the macro', () => {
    expect(err('where a = "}}"')).toEqual({ message: "'}}' would end the macro. Remove it from the query.", col: 11 });
    expect(err('where a = 1\n| sort a').message).toBe('Write the query on one line.');
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
    expect(printDsl(ok('in all | plot scatter x=a y=b labels=on'))).toBe('plot scatter x=a y=b');
    expect(printDsl(ok('merge by run | in here'))).toBe('from run | in here');
  });

  it('asks for a | when a clause follows from without one', () => {
    const r = parseDsl('from run where a = 1');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain("Put '|' before 'where'");
      expect(r.error.col).toBe(9);
    }
  });
});
