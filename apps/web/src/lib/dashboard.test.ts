import { describe, expect, it } from 'vitest';
import type { PlanItem, PlanResponse, SiteMapNode } from '@/types';
import { incompleteByAssignee, nextRunLabel, planFunnel, unplannedScreens } from './dashboard';

const node = (routeKey: string, over: Partial<SiteMapNode> = {}): SiteMapNode =>
  ({ routeKey, title: routeKey, sourceFile: null, origin: 'CODE', stale: false, excluded: false, ...over }) as SiteMapNode;
const stat = (routeKey: string, planned: number): PlanResponse['screens'][number] =>
  ({ routeKey, planned, written: planned, passed: 0, failed: 0 });

describe('unplannedScreens', () => {
  it('계획이 0이거나 집계에 없는 화면만, 지도 순서대로 돌려준다', () => {
    const nodes = [node('/login', { title: '로그인' }), node('/pay', { title: '결제' }), node('/mypage', { title: '마이페이지' }), node('/faq')];
    const screens = [stat('/login', 3), stat('/pay', 0)];
    expect(unplannedScreens(nodes, screens).map((s) => s.name)).toEqual(['결제', '마이페이지', '/faq']);
  });

  it('코드에서 사라진(stale) 화면과 제외한 화면은 세지 않는다', () => {
    const nodes = [node('/old', { stale: true }), node('/skip', { excluded: true }), node('/home')];
    expect(unplannedScreens(nodes, []).map((s) => s.routeKey)).toEqual(['/home']);
  });
});

describe('incompleteByAssignee', () => {
  const item = (over: Partial<PlanItem>): PlanItem =>
    ({ enabled: true, lastStatus: null, assignee: null, assigneeUserId: null, ...over }) as PlanItem;

  it('사용 중 · 통과 아님만 담당자별로 세고, 많은 순으로 자른다', () => {
    const items = [
      item({ assignee: '게스트', assigneeUserId: 1 }),
      item({ assignee: '게스트', assigneeUserId: 1, lastStatus: 'FAILED' }),
      item({ assignee: '게스트', assigneeUserId: 1, lastStatus: 'PASSED' }), // 통과는 뺀다
      item({ assignee: '민지', assigneeUserId: 2 }),
      item({}), // 담당자 없음 → 미지정
      item({}),
      item({}),
      item({ assignee: '끈', assigneeUserId: 3, enabled: false }), // 미사용은 뺀다
      item({ assignee: '완료', assigneeUserId: 4, lastStatus: 'PASSED' }), // 미완료 0 → 목록에 없다
    ];
    expect(incompleteByAssignee(items).map((r) => [r.assignee, r.count])).toEqual([['미지정', 3], ['게스트', 2], ['민지', 1]]);
  });

  it('상위 limit명까지만', () => {
    const items = [1, 2, 3, 4].map((id) => item({ assignee: `사람${id}`, assigneeUserId: id }));
    expect(incompleteByAssignee(items, 2)).toHaveLength(2);
  });
});

describe('planFunnel', () => {
  const summary = { enabled: 40, written: 32, passed: 27, failed: 3 } as PlanResponse['summary'];

  it('계획 → 작성 → 실행(통과+실패) → 통과', () => {
    expect(planFunnel(summary)).toEqual([
      { key: 'planned', label: '계획', count: 40 },
      { key: 'written', label: '작성', count: 32 },
      { key: 'ran', label: '실행', count: 30 },
      { key: 'passed', label: '통과', count: 27 },
    ]);
  });
});

describe('nextRunLabel', () => {
  const now = new Date(2026, 10, 22, 15, 30); // 일요일 오후 3:30

  it('오늘 · 내일은 낱말로, 그 뒤는 날짜와 요일로 쓴다 (24시간제)', () => {
    expect(nextRunLabel(new Date(2026, 10, 22, 18, 5), now)).toBe('오늘 18:05');
    expect(nextRunLabel(new Date(2026, 10, 23, 3, 0), now)).toBe('내일 03:00');
    expect(nextRunLabel(new Date(2026, 10, 25, 3, 0), now)).toBe('11월 25일 (수) 03:00');
  });

  it('자정을 넘기면 시각이 가까워도 내일이다', () => {
    expect(nextRunLabel(new Date(2026, 10, 23, 0, 10), new Date(2026, 10, 22, 23, 50))).toBe('내일 00:10');
  });
});
