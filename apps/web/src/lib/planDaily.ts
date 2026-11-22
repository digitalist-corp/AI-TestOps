import type { PlanDailyCell, PlanDailyResponse, PlanItem, PlanItemKey } from '@/types';

/** 일자별 정기 실행 격자 (F-3) 규칙. 계획 표 행과 (파일 경로, grep)으로 잇는다. */
export const dailyRowId = (k: Pick<PlanItemKey, 'specPath' | 'grep'>) => `${k.specPath}\n${k.grep}`;

export function cellsByRow(daily: PlanDailyResponse): Map<string, PlanDailyCell[]> {
  return new Map(daily.items.map((i) => [dailyRowId(i), i.cells]));
}

/** 정기 실행 결과가 한 칸이라도 있는지 */
export function hasScheduledRuns(daily: PlanDailyResponse): boolean {
  return daily.items.some((i) => i.cells.some((c) => c.status !== null));
}

/**
 * 보이는 행 중 사용 중 항목으로 날짜별 통과율(0~1). 그날 결과가 없으면 null.
 * 서버 totals 와 같은 규칙이고, 스위트로 행을 거르면 거른 행만으로 다시 센다.
 */
export function dailyPassRates(days: string[], rows: PlanItem[], cells: Map<string, PlanDailyCell[]>): (number | null)[] {
  const on = rows.filter((r) => r.enabled);
  return days.map((_, d) => {
    let passed = 0;
    let failed = 0;
    for (const r of on) {
      const status = cells.get(dailyRowId(r))?.[d]?.status;
      if (status === 'PASSED') passed++;
      else if (status === 'FAILED') failed++;
    }
    return passed + failed === 0 ? null : passed / (passed + failed);
  });
}

/** '2026-11-22' → '11/22' */
export const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 통과율 표기: 0.857 → '86%', 결과 없음 → '–' */
export const percent = (rate: number | null) => (rate === null ? '–' : `${Math.round(rate * 100)}%`);
