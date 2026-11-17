import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/api/client';
import type { Project, TestRound, TestRoundDetail } from '@/types';
import { ProjectDashboardTab } from './ProjectDashboardTab';

vi.mock('@/components/dashboard/ChartBox', () => ({
  ChartBox: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
  useChartTheme: () => ({ dark: false, text: '', strong: '', grid: '', tooltip: {} }),
}));
vi.mock('@/api/client', () => ({
  api: {
    rounds: { list: vi.fn(), get: vi.fn() },
    getScenarios: vi.fn(),
    getSiteMap: vi.fn(),
    getSiteMapCoverage: vi.fn(),
    schedules: { listByProject: vi.fn() },
  },
}));

const round = (n: number, failed: number): TestRound => ({
  round: n,
  executionId: n * 10,
  status: failed ? 'FAILED' : 'PASSED',
  title: '전체 실행',
  source: 'MANUAL',
  startedAt: '2026-11-10T05:20:00Z',
  finishedAt: '2026-11-10T05:21:00Z',
  durationMs: 61000,
  total: 2,
  passed: 2 - failed,
  failed,
  skipped: 0,
});

const detailOf = (r: TestRound, loginStatus: 'PASSED' | 'FAILED'): TestRoundDetail => ({
  round: r,
  previousRound: r.round > 1 ? r.round - 1 : null,
  changes: {
    NEW_FAIL: loginStatus === 'FAILED' ? 1 : 0,
    STILL_FAIL: 0,
    FIXED: 0,
    STILL_PASS: loginStatus === 'FAILED' ? 1 : 2,
    FIRST_RUN: 0,
    SKIPPED: 0,
  },
  cases: [
    {
      specPath: 'login.spec.ts',
      caseTitle: 'login.spec.ts > 로그인된다',
      status: loginStatus,
      errorMessage: loginStatus === 'FAILED' ? "'로그인' 버튼을 찾지 못했어요" : null,
      change: loginStatus === 'FAILED' ? 'NEW_FAIL' : 'STILL_PASS',
      previousRound: r.round - 1 || null,
    },
    {
      specPath: 'login.spec.ts',
      caseTitle: 'login.spec.ts > 로그아웃된다',
      status: 'PASSED',
      errorMessage: null,
      change: 'STILL_PASS',
      previousRound: r.round - 1 || null,
    },
  ],
});

const project = { projectId: 'p1', projectName: '쇼핑몰' } as Project;

afterEach(cleanup);

describe('ProjectDashboardTab', () => {
  it('최근 차수를 한 문장으로 요약하고, 콤보박스로 다른 차수를 고르면 그 차수로 바뀐다', async () => {
    const r2 = round(2, 1);
    const r1 = round(1, 0);
    vi.mocked(api.rounds.list).mockResolvedValue([r2, r1]);
    vi.mocked(api.rounds.get).mockImplementation(async (_p, id) => (id === 20 ? detailOf(r2, 'FAILED') : detailOf(r1, 'PASSED')));
    vi.mocked(api.getScenarios).mockResolvedValue({
      projectId: 'p1',
      totalSpecs: 1,
      totalCases: 2,
      specs: [
        {
          path: 'tests/login.spec.ts',
          caseCount: 2,
          enabled: true,
          cases: [
            { type: 'TEST', title: '로그인된다', line: 1, grep: '', enabled: true, children: [] },
            { type: 'TEST', title: '로그아웃된다', line: 2, grep: '', enabled: true, children: [] },
          ],
        },
      ],
    });
    vi.mocked(api.getSiteMap).mockResolvedValue({
      nodes: [{ routeKey: '/login', title: '로그인', sourceFile: null, origin: 'CODE', stale: false, excluded: false }],
    } as never);
    vi.mocked(api.getSiteMapCoverage).mockResolvedValue({
      summary: { screens: 1, tested: 1, observed: 0, unseen: 0, blocked: 0, flows: 1, lastRunAt: null },
      nodes: [],
      edges: [],
      flows: [
        {
          specPath: 'tests/login.spec.ts',
          title: '로그인',
          source: 'RECORDED',
          lastStatus: 'FAILED',
          lastRunAt: null,
          executionId: 20,
          steps: [{ routeKey: '/login', state: 'FAILED' }],
        },
      ],
    });
    vi.mocked(api.schedules.listByProject).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <ProjectDashboardTab
          project={project}
          executions={[]}
          onRun={() => {}}
          onOpenSource={() => {}}
          onOpenRuns={() => {}}
          onOpenResults={() => {}}
        />
      </MemoryRouter>
    );

    expect(
      await screen.findByText('2차 테스트에서 2개 중 1개가 통과했어요. 지난번보다 1개가 새로 실패했어요.')
    ).toBeTruthy();
    expect(screen.getByText('화면 1개 중 1개')).toBeTruthy(); // 매핑 칸
    expect(screen.getByText("'로그인' 버튼을 찾지 못했어요")).toBeTruthy();
    // 화면별 케이스: 로그인 화면에 두 케이스, 로그인된다는 실패
    const list = await screen.findByRole('list', { name: '로그인 케이스 목록' });
    expect(list.textContent).toContain('로그인된다');
    expect(list.textContent).toContain('새로 실패');

    fireEvent.change(screen.getByLabelText('차수 고르기'), { target: { value: '10' } });
    await waitFor(() => expect(api.rounds.get).toHaveBeenCalledWith('p1', 10));
    expect(await screen.findByText('1차 테스트에서 2개 중 2개가 통과했어요. 지난번과 달라진 케이스는 없어요.')).toBeTruthy();
  });

  it('돌린 테스트가 없으면 1차 테스트를 시작하라고 안내한다', async () => {
    vi.mocked(api.rounds.list).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <ProjectDashboardTab
          project={project}
          executions={[]}
          onRun={() => {}}
          onOpenSource={() => {}}
          onOpenRuns={() => {}}
          onOpenResults={() => {}}
        />
      </MemoryRouter>
    );
    expect(await screen.findByText(/‘전체 실행’을 누르면 1차 테스트가 시작돼요/)).toBeTruthy();
  });
});
