import type { PlanItem, PlanPriority, TestRoundCase, TestSuite } from '@/types';
import { samePath, type ScreenCases } from '@/lib/rounds';

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

/** 실패가 있는 화면만, 실패 많은 순 → 이름순. 화면을 모르는 묶음도 포함. */
export function failingScreens(groups: ScreenCases[]): { name: string; failed: number }[] {
  return groups
    .filter((g) => g.counts.failed > 0)
    .map((g) => ({ name: g.name, failed: g.counts.failed }))
    .sort((a, b) => b.failed - a.failed || a.name.localeCompare(b.name, 'ko'));
}

/**
 * 계획 항목이 스위트에 들어가는지. Playwright 처럼 파일이 스위트 목록에 있고,
 * 필터(grep)가 있으면 "파일 묶음 제목"이 그 정규식에 맞아야 한다. 잘못된 정규식이면 글자 포함으로 본다.
 */
export function inSuite(suite: Pick<TestSuite, 'specPaths' | 'grep'>, item: PlanItem): boolean {
  if (!suite.specPaths.some((p) => samePath(p, item.specPath))) return false;
  if (!suite.grep) return true;
  const full = [item.specPath, item.describePath, item.title].filter(Boolean).join(' ');
  try {
    return new RegExp(suite.grep).test(full);
  } catch {
    return full.includes(suite.grep);
  }
}

/** 성공 · 실패 · 미수행은 사용 중 항목만, 미사용은 따로 센다. */
export function planCounts(items: PlanItem[]): { passed: number; failed: number; notRun: number; disabled: number } {
  const on = items.filter((i) => i.enabled);
  const passed = on.filter((i) => i.lastStatus === 'PASSED').length;
  const failed = on.filter((i) => i.lastStatus === 'FAILED').length;
  return { passed, failed, notRun: on.length - passed - failed, disabled: items.length - on.length };
}
