import type { PlanItem, PlanResponse, PlanSummary, SiteMapNode } from '@/types';
import { screenName } from '@/lib/coverage';
import { byAssignee } from '@/lib/plan';

/** 프로젝트 대시보드가 쓰는 계산. 서버가 준 계획 응답(summary · screens · items)을 화면 문장으로 바꾼다. */

/** 계획 → 작성 → 실행 → 통과. 모두 사용 중 항목 기준이라 앞 단계보다 커지지 않는다. */
export function planFunnel(summary: Pick<PlanSummary, 'enabled' | 'written' | 'passed' | 'failed'>) {
  return [
    { key: 'planned', label: '계획', count: summary.enabled },
    { key: 'written', label: '작성', count: summary.written },
    { key: 'ran', label: '실행', count: summary.passed + summary.failed },
    { key: 'passed', label: '통과', count: summary.passed },
  ];
}

/** 화면 지도의 화면 중 계획이 하나도 없는 화면. 사라진(stale) 화면과 제외한 화면은 뺀다. */
export function unplannedScreens(nodes: SiteMapNode[], screens: PlanResponse['screens']): { routeKey: string; name: string }[] {
  const planned = new Set(screens.filter((s) => s.planned > 0).map((s) => s.routeKey));
  return nodes
    .filter((n) => !n.stale && !n.excluded && !planned.has(n.routeKey))
    .map((n) => ({ routeKey: n.routeKey, name: screenName(n, n.routeKey) }));
}

/** 담당자별 미완료(사용 중 · 통과 아님) 건수, 많은 순으로 상위 limit명. 담당자가 없으면 '미지정'. */
export function incompleteByAssignee(items: PlanItem[], limit = 5): { key: string; assignee: string; count: number }[] {
  return byAssignee(items)
    .map((r) => ({ key: r.key, assignee: r.assignee, count: r.total - r.passed }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');

/** 다음 정기 실행 시각: '내일 03:00', '오늘 18:05', 그 뒤는 '11월 25일 (수) 03:00' */
export function nextRunLabel(at: Date, now: Date = new Date()): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(at) - startOf(now)) / 86_400_000);
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (days === 0) return `오늘 ${time}`;
  if (days === 1) return `내일 ${time}`;
  return `${at.getMonth() + 1}월 ${at.getDate()}일 (${WEEKDAY[at.getDay()]}) ${time}`;
}
