import type { PlanItem, PlanPriority, TestRoundCase } from '@/types';
import type { ScreenCases } from '@/lib/rounds';

export const PRIORITY_LABEL: Record<PlanPriority, string> = { HIGH: '높음', MEDIUM: '보통', LOW: '낮음' };

export const planKey = (specPath: string, title: string) => `${specPath}\n${title}`;

/** 계획 항목의 최근 결과를 casesByScreen 이 받는 결과 모양으로. 결과 없는 항목은 뺀다. */
export function planAsResults(items: PlanItem[]): TestRoundCase[] {
  return items
    .filter((i) => i.lastStatus)
    .map((i) => ({
      specPath: i.specPath,
      caseTitle: i.title,
      status: i.lastStatus!,
      errorMessage: null,
      change: 'FIRST_RUN',
      previousRound: null,
    }));
}

/** 케이스(파일 경로 + 제목)별 화면 이름. 여러 화면이면 "첫 화면 외 N", 화면을 모르면 키가 없다. */
export function screenNameByCase(groups: ScreenCases[]): Map<string, string> {
  const names = new Map<string, string[]>();
  for (const g of groups) {
    if (g.routeKey === null) continue;
    for (const c of g.cases) {
      const key = planKey(c.specPath, c.title);
      names.set(key, [...(names.get(key) ?? []), g.name]);
    }
  }
  return new Map([...names].map(([k, v]) => [k, v.length > 1 ? `${v[0]} 외 ${v.length - 1}` : v[0]]));
}
