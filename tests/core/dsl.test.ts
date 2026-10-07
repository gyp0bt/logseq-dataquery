import { describe, expect, it } from 'vitest';
import { joinMacroArgs, parseQuery, setSetting, toggleErr, type Cond, type Query } from '../../src/core/dsl';

const ok = (t: string): Query => {
  const r = parseQuery(t);
  if (!r.ok) throw new Error(`unexpected error: ${r.error.message} @${r.error.col}`);
  return r.query;
};
const err = (t: string) => {
  const r = parseQuery(t);
  if (r.ok) throw new Error('expected an error');
  return r.error;
};

describe('parseQuery', () => {
  it('empty text is the empty query', () =>
    expect(ok('  ')).toEqual({ refs: [], conds: [], ys: [], labels: false, err: 'bar' }));

  it('reads every kind of term', () => {
    expect(ok('#work/nsb seed==0 gre-interp<0 x:gre-thin y:gre-thick color:seed sort:-r2 by:run labels:on err:band done?')).toEqual({
      refs: ['work/nsb'],
      conds: [
        { kind: 'cmp', key: 'seed', op: '==', values: ['0'] },
        { kind: 'cmp', key: 'gre-interp', op: '<', values: ['0'] },
        { kind: 'has', key: 'done?' },
      ],
      x: 'gre-thin', ys: ['gre-thick'], color: 'seed',
      sort: { key: 'r2', desc: true }, by: 'run', labels: true, err: 'band',
    });
  });

  it('refs: #tag, #[[a b]] and [[a b]] (Review Focus 1)', () => {
    expect(ok('#Work/NSB #[[my page]] [[Other Page]] seed==1').refs).toEqual(['work/nsb', 'my page', 'other page']);
    expect(ok('[[my page]]  x:a').x).toBe('a');
  });

  it('operators: = is ==, all six comparisons, lists only for == and !=', () => {
    const c = (t: string) => ok(t).conds[0] as Extract<Cond, { kind: 'cmp' }>;
    expect(c('a=1')).toEqual({ kind: 'cmp', key: 'a', op: '==', values: ['1'] });
    for (const op of ['==', '!=', '<', '<=', '>', '>='])
      expect(c(`a${op}2`)).toMatchObject({ op, values: ['2'] });
    expect(c('combine==none,mean')).toEqual({ kind: 'cmp', key: 'combine', op: '==', values: ['none', 'mean'] });
    expect(c('combine!=none,mean').values).toEqual(['none', 'mean']);
    expect(c('Seed==1').key).toBe('seed');
    expect(c('温度>=20').key).toBe('温度');
  });

  it('quoted values keep spaces, commas and operators (Review Focus 2)', () => {
    const c = (t: string) => ok(t).conds[0] as Extract<Cond, { kind: 'cmp' }>;
    expect(c('section=="8 cells, seed"')).toEqual({ kind: 'cmp', key: 'section', op: '==', values: ['8 cells, seed'] });
    expect(c('note=="a<b"')).toEqual({ kind: 'cmp', key: 'note', op: '==', values: ['a<b'] });
    expect(c('note!=""').values).toEqual(['']);
    expect(c('a=="x y","z"').values).toEqual(['x y', 'z']);
    expect(ok('#t note=="a b" seed==0').conds).toHaveLength(2);
  });

  it('y: takes a list; sort: ascending by default', () => {
    expect(ok('y:a,b').ys).toEqual(['a', 'b']);
    expect(ok('sort:r2').sort).toEqual({ key: 'r2', desc: false });
    expect(ok('labels:off').labels).toBe(false);
    expect(ok('err:off').err).toBe('off');
  });

  it('survives Logseq comma splitting', () => {
    const original = '#t combine==none,mean y:a,b';
    expect(ok(joinMacroArgs(original.split(',')))).toEqual(ok(original));
  });

  it('reports mistakes with the column of the offending term', () => {
    expect(err('#t a<b')).toEqual({ message: "'<' compares numbers, got 'b'.", col: 5 });
    expect(err('a<1,2').message).toBe("'<' compares numbers, got '1,2'.");
    expect(err('x:a x:b')).toEqual({ message: "Duplicate 'x:' setting. Keep one.", col: 4 });
    expect(err('#t foo:bar')).toEqual({ message: "Unknown setting 'foo'. Use x, y, color, sort, by, labels or err.", col: 3 });
    expect(err('seed== x:a')).toEqual({ message: "Missing value after '=='. Example: seed==1.3", col: 6 });
    expect(err('x:')).toEqual({ message: "Missing value after 'x:'.", col: 2 });
    expect(err('labels:yes').message).toBe('labels: takes on or off.');
    expect(err('err:whisker').message).toBe('err: takes bar, band or off.');
    expect(err('a b ==1')).toEqual({ message: "Missing key before '=='.", col: 4 });
    expect(err('x:a,b')).toEqual({ message: "'a,b' is not a property key.", col: 2 });
    expect(err('a==1, ')).toEqual({ message: "Empty value in 'a==1,'.", col: 0 });
    expect(err('note=="abc')).toEqual({ message: 'Unclosed quote.', col: 6 });
    expect(err('[[abc')).toEqual({ message: "Unclosed '[['.", col: 0 });
    expect(err('"abc"').message).toBe("Cannot read '\"abc\"'. Example: #tag, seed==0, x:gre-thin or gre-thin.");
    expect(err('#').message).toBe("'#' needs a page name, e.g. #work/nsb.");
  });

  it('rejects text that would break the macro', () => {
    expect(err('a=="}}"')).toEqual({ message: "'}}' would end the macro. Remove it from the query.", col: 4 });
    expect(err('a==1\nb').message).toBe('Write the query on one line.');
  });
});

describe('setSetting (Review Focus 3)', () => {
  it('replaces one setting and keeps the other text byte for byte', () => {
    expect(setSetting('#a  seed==0 x:p', 'x', 'q')).toBe('#a  seed==0 x:q');
    expect(setSetting('x:p   #a  seed==0', 'x', 'q')).toBe('x:q   #a  seed==0');
    expect(setSetting('#a X:p note=="x:p"', 'x', 'q')).toBe('#a x:q note=="x:p"');
  });
  it('removes a setting with the space before it', () => {
    expect(setSetting('#a  seed==0 x:p', 'x', null)).toBe('#a  seed==0');
    expect(setSetting('x:p  #a', 'x', null)).toBe('#a');
    expect(setSetting('#a sort:-r2  seed==0', 'sort', null)).toBe('#a  seed==0');
    expect(setSetting('#a', 'x', null)).toBe('#a');
  });
  it('appends a missing setting with one space', () => {
    expect(setSetting('#a  seed==0 x:p', 'y', 'r')).toBe('#a  seed==0 x:p y:r');
    expect(setSetting('#a ', 'err', 'band')).toBe('#a err:band');
    expect(setSetting('', 'x', 'a')).toBe('x:a');
  });
});

describe('toggleErr', () => {
  it('± and ▤ are two exclusive on/off toggles', () => {
    expect(toggleErr('bar', 'bar')).toBe('off');
    expect(toggleErr('off', 'bar')).toBeNull();
    expect(toggleErr('band', 'bar')).toBeNull();
    expect(toggleErr('band', 'band')).toBe('off');
    expect(toggleErr('off', 'band')).toBe('band');
    expect(toggleErr('bar', 'band')).toBe('band');
  });
});
