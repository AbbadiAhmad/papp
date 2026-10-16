import { describe, expect, it } from '@jest/globals';
import { dailyAverages, dailyCounts, MAX_ANSWER_FILTERS, parseReportFilter, toQuery } from '../../backend/report-filter';

const Q = '5b2f1d0e-1111-4222-8333-444455556666';

describe('parseReportFilter', () => {
  it('reads dates as whole UTC days, with the last day included', () => {
    const r = parseReportFilter({ from: '2026-03-01', to: '2026-03-03' });
    expect('filter' in r && r.filter.from?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect('filter' in r && r.filter.toExclusive?.toISOString()).toBe('2026-03-04T00:00:00.000Z');
  });
  it('reads one or several answer conditions; the value may contain colons', () => {
    const one = parseReportFilter({ a: `${Q}:fic` });
    expect('filter' in one && one.filter.answers).toEqual([{ questionId: Q, value: 'fic' }]);
    const many = parseReportFilter({ a: [`${Q.toUpperCase()}:a:b`, `${Q}:c`] });
    expect('filter' in many && many.filter.answers).toEqual([{ questionId: Q, value: 'a:b' }, { questionId: Q, value: 'c' }]);
    expect('filter' in parseReportFilter({}) && parseReportFilter({})).toEqual({ filter: { answers: [] } });
  });
  it('reports the first problem', () => {
    for (const bad of [{ from: 'yesterday' }, { to: '2026-02-30' }, { from: '2026-03-05', to: '2026-03-01' }, { a: 'x' }, { a: `${Q}:` }, { a: `nope:v` }, { a: `${Q}:${'v'.repeat(201)}` }]) {
      expect(parseReportFilter(bad)).toHaveProperty('error');
    }
    expect(parseReportFilter({ a: Array.from({ length: MAX_ANSWER_FILTERS + 1 }, () => `${Q}:v`) })).toHaveProperty('error');
  });
  it('toQuery is the inverse the page uses', () => {
    expect(toQuery({ from: '2026-03-01', answers: [{ questionId: Q, value: 'v' }] })).toEqual({ from: '2026-03-01', a: [`${Q}:v`] });
    expect(toQuery({ answers: [] })).toEqual({});
  });
});

describe('trend helpers', () => {
  it('dailyCounts fills the quiet days between the first and last response', () => {
    expect(dailyCounts([new Date('2026-03-01T10:00:00Z'), new Date('2026-03-01T23:59:59Z'), new Date('2026-03-03T00:00:00Z')])).toEqual([
      { date: '2026-03-01', count: 2 },
      { date: '2026-03-02', count: 0 },
      { date: '2026-03-03', count: 1 },
    ]);
    expect(dailyCounts([])).toEqual([]);
  });
  it('dailyCounts does not invent hundreds of empty days over a long span', () => {
    const out = dailyCounts([new Date('2024-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z')]);
    expect(out).toEqual([{ date: '2024-01-01', count: 1 }, { date: '2026-01-01', count: 1 }]);
  });
  it('dailyAverages averages per day, rounded, skipping days without data', () => {
    expect(
      dailyAverages([
        { at: new Date('2026-03-02T01:00:00Z'), value: 5 },
        { at: new Date('2026-03-01T01:00:00Z'), value: 4 },
        { at: new Date('2026-03-01T02:00:00Z'), value: 1 },
        { at: new Date('2026-03-01T03:00:00Z'), value: 1 },
      ]),
    ).toEqual([
      { date: '2026-03-01', average: 2, count: 3 },
      { date: '2026-03-02', average: 5, count: 1 },
    ]);
  });
});
