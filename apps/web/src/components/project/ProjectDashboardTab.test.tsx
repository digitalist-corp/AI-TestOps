import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/api/client';
import type { Me } from '@/lib/access';
import type { ExecutionSchedule, PlanDailyResponse, PlanItem, PlanResponse, Project } from '@/types';
import { ProjectDashboardTab } from './ProjectDashboardTab';

let me: Me;
vi.mock('@/lib/access', async (orig) => {
  const mod = await orig<typeof import('@/lib/access')>();
  return { ...mod, useAccess: () => mod.accessOf(me) };
});
vi.mock('@/api/client', () => ({
  api: {
    plan: { get: vi.fn(), daily: vi.fn() },
    defects: { list: vi.fn() },
    getScenarios: vi.fn(),
    getSiteMap: vi.fn(),
    getSiteMapCoverage: vi.fn(),
    schedules: { listByProject: vi.fn() },
  },
}));

const project = { projectId: 'p1', projectName: '쇼핑몰' } as Project;
const user = (role: 'PM' | 'MEMBER'): Me => ({ id: 9, username: 'u', displayName: null, role: 'USER', projects: [{ projectId: 'p1', role }] });

const item = (over: Partial<PlanItem>): PlanItem => ({
  planId: null, stage: 'WRITTEN', screenRouteKey: null, expected: null, aiJobId: null, aiJobStatus: null,
  specPath: '', grep: '', title: '', describePath: '', line: 0, enabled: true, parentEnabled: true,
  sortOrder: null, assignee: null, dueDate: null, priority: null, lastStatus: null, lastRunAt: null,
  prevStatus: null, prevRunAt: null, defectStatus: null, defectFailCount: 0,
  assigneeUserId: null, updatedByName: null, updatedAt: null, ...over,
});

/** 계획 40 → 작성 32(80%) → 실행 30 → 통과 27, 완료율 68%. 미사용 2 */
const planResponse: PlanResponse = {
  items: [
    item({ specPath: 'tests/login.spec.ts', grep: '로그인된다', title: '로그인된다', lastStatus: 'FAILED' }),
    item({ grep: '결제', title: '결제', assignee: '게스트', assigneeUserId: 1, dueDate: '2000-01-01' }), // 마감 지남 · 미실행
    item({ grep: '탈퇴', title: '탈퇴', assignee: '게스트', assigneeUserId: 1 }),
    item({ grep: '환불', title: '환불', assignee: '민지', assigneeUserId: 2, lastStatus: 'PASSED', dueDate: '2000-01-01' }), // 통과라 마감 지남이 아니다
    item({ grep: '끔', title: '끔', enabled: false, assignee: '민지', assigneeUserId: 2 }),
  ],
  summary: { total: 42, enabled: 40, disabled: 2, unwritten: 8, written: 32, writtenRate: 0.8, passed: 27, failed: 3, notRun: 2, completionRate: 0.68 },
  screens: [{ routeKey: '/login', planned: 3, written: 3, passed: 2, failed: 1 }, { routeKey: '/pay', planned: 0, written: 0, passed: 0, failed: 0 }],
};

const node = (routeKey: string, title: string) =>
  ({ routeKey, title, sourceFile: null, origin: 'CODE', stale: false, excluded: false }) as never;

const DAYS = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
const dailyOf = (rates: (number | null)[]): PlanDailyResponse => ({
  days: DAYS,
  items: [{ specPath: 'tests/login.spec.ts', grep: '로그인된다', cells: DAYS.map((date, i) => ({ date, status: rates[i] === null ? null : 'PASSED', executionId: null })) }],
  totals: DAYS.map((date, i) => ({ date, passed: rates[i] === null ? 0 : 6, failed: rates[i] === null ? 0 : 1, enabled: 8, passRate: rates[i] })),
});
const noRuns = dailyOf(DAYS.map(() => null));

const schedule = (over: Partial<ExecutionSchedule> = {}): ExecutionSchedule =>
  ({ id: 1, projectId: 'p1', hour: 3, minute: 0, daysOfWeek: '*', enabled: true, createdAt: '', updatedAt: '', ...over });

function renderTab(props: Partial<Parameters<typeof ProjectDashboardTab>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ProjectDashboardTab project={project} executions={[]} {...props} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  me = user('PM');
  vi.mocked(api.plan.get).mockResolvedValue(planResponse);
  vi.mocked(api.plan.daily).mockResolvedValue(noRuns);
  vi.mocked(api.defects.list).mockResolvedValue({ defects: [], open: 3, resolved: 0 });
  vi.mocked(api.getScenarios).mockResolvedValue({
    projectId: 'p1', totalSpecs: 1, totalCases: 1,
    specs: [{ path: 'tests/login.spec.ts', caseCount: 1, enabled: true, cases: [{ type: 'TEST', title: '로그인된다', line: 1, grep: '', enabled: true, children: [] }] }],
  });
  vi.mocked(api.getSiteMap).mockResolvedValue({
    nodes: [node('/login', '로그인'), node('/pay', '결제'), node('/mypage', '마이페이지')],
  } as never);
  vi.mocked(api.getSiteMapCoverage).mockResolvedValue({
    summary: { screens: 1, tested: 1, observed: 0, unseen: 0, blocked: 0, flows: 1, lastRunAt: null },
    nodes: [],
    edges: [],
    flows: [{ specPath: 'tests/login.spec.ts', title: '로그인', source: 'RECORDED', lastStatus: 'FAILED', lastRunAt: null, executionId: 20,
              steps: [{ routeKey: '/login', state: 'FAILED' }] }],
  });
  vi.mocked(api.schedules.listByProject).mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('ProjectDashboardTab — 세 질문', () => {
  it('① 퍼널: 계획 → 작성(%) → 실행 → 통과와 완료율, 마감 지난 항목 · 미사용. 숫자는 계획 표로 가는 링크', async () => {
    renderTab();

    const funnel = await screen.findByRole('list', { name: '계획 진척 퍼널' });
    const rows = within(funnel).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual(['계획40', '작성32 (80%)', '실행30', '통과27']);
    for (const link of within(funnel).getAllByRole('link')) expect(link.getAttribute('href')).toBe('/projects/p1/plan');

    const region = screen.getByRole('region', { name: '계획 진척' });
    expect(region.textContent).toContain('68%');
    // 결제만 마감이 지났다 (환불은 통과라 제외)
    expect(region.textContent).toContain('마감 지난 항목 1');
    expect(region.textContent).toContain('미사용 2');
    expect(within(region).getByRole('link', { name: '2' }).getAttribute('href')).toBe('/projects/p1/plan');
  });

  it('사용 중인 계획이 없으면 퍼널 대신 계획 표로 안내한다', async () => {
    vi.mocked(api.plan.get).mockResolvedValue({
      items: [],
      summary: { total: 0, enabled: 0, disabled: 0, unwritten: 0, written: 0, writtenRate: 0, passed: 0, failed: 0, notRun: 0, completionRate: 0 },
      screens: [],
    });
    renderTab();

    expect(await screen.findByText(/아직 사용 중인 계획이 없어요/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '계획 표 열기 →' }).getAttribute('href')).toBe('/projects/p1/plan');
    expect(screen.queryByRole('list', { name: '계획 진척 퍼널' })).toBeNull();
  });

  it('② 문제: 미해결 결함 링크 · 오류 난 화면 · 계획 없는 화면 · 담당자별 미완료', async () => {
    renderTab();

    expect((await screen.findByRole('link', { name: '미해결 결함 3건 →' })).getAttribute('href')).toBe('/projects/p1/defects');
    // 로그인 화면에 실패 1건
    const failing = await screen.findByRole('list', { name: '오류 난 화면' });
    expect(failing.textContent).toContain('로그인');
    expect(failing.textContent).toContain('실패 1건');
    // 계획이 0인 결제, 집계에 없는 마이페이지
    const unplanned = await screen.findByRole('list', { name: '계획 없는 화면' });
    expect(within(unplanned).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['결제', '마이페이지']);
    expect(screen.getByRole('link', { name: '화면 지도에서 보기 →' }).getAttribute('href')).toBe('/projects/p1/structure');
    // 사용 중 · 통과 아님: 게스트 2(결제 · 탈퇴), 미지정 1(로그인된다 실패). 환불(통과) · 끔(미사용)은 제외
    const assignees = screen.getByRole('list', { name: '담당자별 미완료' });
    expect(within(assignees).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['게스트2건', '미지정1건']);
  });

  it('계획 없는 화면은 5개까지만 보이고 나머지는 "외 N개"', async () => {
    vi.mocked(api.getSiteMap).mockResolvedValue({
      nodes: ['가', '나', '다', '라', '마', '바', '사'].map((n) => node(`/${n}`, n)),
    } as never);
    renderTab();

    const unplanned = await screen.findByRole('list', { name: '계획 없는 화면' });
    expect(within(unplanned).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['가', '나', '다', '라', '마', '외 2개']);
  });

  it('모든 화면에 계획이 있고 실패가 없으면 그렇다고 말한다', async () => {
    vi.mocked(api.plan.get).mockResolvedValue({
      items: [item({ grep: '로그인', title: '로그인', lastStatus: 'PASSED', assignee: '민지', assigneeUserId: 2 })],
      summary: { ...planResponse.summary, enabled: 1, total: 1, passed: 1, failed: 0 },
      screens: [{ routeKey: '/login', planned: 1, written: 1, passed: 1, failed: 0 }, { routeKey: '/pay', planned: 1, written: 1, passed: 1, failed: 0 },
                { routeKey: '/mypage', planned: 1, written: 1, passed: 1, failed: 0 }],
    });
    renderTab();

    expect(await screen.findByText('모든 화면에 계획이 있어요.')).toBeTruthy();
    expect(await screen.findByText('오류 난 화면이 없어요.')).toBeTruthy();
    expect(await screen.findByText('미완료 항목이 없어요.')).toBeTruthy();
  });

  it('③ 정기 실행 기록이 없으면 안내와 설정 링크(PM)를 보이고, 켜진 정기 실행이 없다고 말한다', async () => {
    renderTab();

    expect(await screen.findByText(/정기 실행을 켜면 여기에 쌓여요/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '정기 실행 설정 →' }).getAttribute('href')).toBe('/projects/p1/schedules');
    expect(await screen.findByText('없음')).toBeTruthy();
    expect(screen.queryByRole('list', { name: '일자별 정기 실행 통과율' })).toBeNull();
  });

  it('③ 정기 실행 기록이 있으면 7일 통과율 막대와 다음 정기 실행 시각을 보인다', async () => {
    // Date 만 고정한다 — 약속(Promise)과 타이머는 그대로 돌아야 findBy 가 동작한다.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 22, 15, 0));
    vi.mocked(api.plan.daily).mockResolvedValue(dailyOf([null, null, 0.5, 1, 0.857, null, 0.75]));
    vi.mocked(api.schedules.listByProject).mockResolvedValue([schedule({ hour: 3, minute: 0 })]);
    renderTab();

    const bars = await screen.findByRole('list', { name: '일자별 정기 실행 통과율' });
    const days = within(bars).getAllByRole('listitem');
    expect(days.map((li) => li.getAttribute('aria-label'))).toEqual([
      '11/16 통과율 –', '11/17 통과율 –', '11/18 통과율 50%', '11/19 통과율 100%', '11/20 통과율 86%', '11/21 통과율 –', '11/22 통과율 75%',
    ]);
    expect(screen.queryByText(/정기 실행을 켜면/)).toBeNull();
    expect(await screen.findByText('내일 03:00')).toBeTruthy();
  });

  it('팀원에게는 정기 실행 설정 링크를 보이지 않는다 (예약 관리는 PM)', async () => {
    me = user('MEMBER');
    renderTab();

    expect(await screen.findByText(/정기 실행을 켜면 여기에 쌓여요/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /정기 실행 설정/ })).toBeNull();
  });
});

describe('ProjectDashboardTab — 상단 버튼', () => {
  it.each([['PM'], ['MEMBER']] as const)('%s: 카드에는 버튼이 없다 (전체 실행은 페이지 머리글에 있음)', async (role) => {
    me = user(role);
    renderTab({});
    await screen.findByRole('list', { name: '계획 진척 퍼널' });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('실행 중이면 전체 실행 대신 중지 버튼을 보이고, 누르면 그 실행을 멈춘다', async () => {
    const onStop = vi.fn();
    renderTab({ executions: [{ id: 9, status: 'RUNNING' } as never], onStop });

    expect(screen.queryByRole('button', { name: /전체 실행/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /중지/ }));
    expect(onStop).toHaveBeenCalledWith(9);
    await screen.findByRole('list', { name: '계획 진척 퍼널' });
  });

  it('차수별 결과 · 화면별 케이스 · 매핑 · 예약 카드는 더 이상 없다', async () => {
    renderTab();
    await screen.findByRole('list', { name: '계획 진척 퍼널' });

    for (const name of ['차수별 결과', '화면별 케이스', '매핑', '화면 지도', '언제']) {
      expect(screen.queryByRole('region', { name })).toBeNull();
    }
    expect(screen.queryByLabelText('차수 고르기')).toBeNull();
  });
});
