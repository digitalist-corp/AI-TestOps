import { describe, expect, it } from 'vitest';
import type { PlanDailyResponse, PlanItem } from '@/types';
import { cellsByRow, dailyPassRates, hasScheduledRuns, percent, shortDate } from '@/lib/planDaily';

const row = (grep: string, enabled = true) => ({ specPath: 'a.spec.ts', grep, enabled }) as PlanItem;

const daily: PlanDailyResponse = {
  days: ['2026-11-21', '2026-11-22'],
  items: [
    { specPath: 'a.spec.ts', grep: '로그인', cells: [
      { date: '2026-11-21', status: 'FAILED', executionId: 1 }, { date: '2026-11-22', status: 'PASSED', executionId: 2 }] },
    { specPath: 'a.spec.ts', grep: '검색', cells: [
      { date: '2026-11-21', status: null, executionId: null }, { date: '2026-11-22', status: 'FAILED', executionId: 2 }] },
  ],
  totals: [],
};

describe('planDaily', () => {
  it('사용 중인 보이는 행만으로 날짜별 통과율을 센다. 결과 없는 날은 null', () => {
    const cells = cellsByRow(daily);
    expect(dailyPassRates(daily.days, [row('로그인'), row('검색')], cells)).toEqual([0, 0.5]);
    expect(dailyPassRates(daily.days, [row('로그인'), row('검색', false)], cells)).toEqual([0, 1]);
    expect(dailyPassRates(daily.days, [row('검색')], cells)).toEqual([null, 0]);
  });

  it('결과가 한 칸도 없으면 기록 없음', () => {
    expect(hasScheduledRuns(daily)).toBe(true);
    expect(hasScheduledRuns({ ...daily, items: [{ specPath: 'a', grep: 'b', cells: [{ date: '2026-11-22', status: null, executionId: null }] }] })).toBe(false);
  });

  it('표기', () => {
    expect(shortDate('2026-01-05')).toBe('1/5');
    expect(percent(0.857)).toBe('86%');
    expect(percent(null)).toBe('–');
  });
});
