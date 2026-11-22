import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '@/api/client';
import type { TestRound, TestRoundDetail } from '@/types';
import { ExecutionsTab } from './ExecutionsTab';

vi.mock('ag-grid-react', () => ({ AgGridReact: () => <div data-testid="grid" /> }));
vi.mock('@/components/project/ExecutionLogPanel', () => ({ ExecutionLogPanel: () => null }));
vi.mock('@/components/dashboard/ChartBox', () => ({
  ChartBox: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
  useChartTheme: () => ({ dark: false, text: '', strong: '', grid: '', tooltip: {} }),
}));
vi.mock('@/api/client', () => ({ api: { rounds: { list: vi.fn(), get: vi.fn() } } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const props = {
  projectId: 'p1',
  executions: [],
  loading: false,
  activeExecutionId: null,
  onRefresh: vi.fn(),
  onSelect: vi.fn(),
  onCancel: vi.fn(),
  onDelete: vi.fn(),
  onReset: vi.fn(),
  selectedId: null,
};

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
    { specPath: 'login.spec.ts', caseTitle: 'login.spec.ts > 로그아웃된다', status: 'PASSED', errorMessage: null, change: 'STILL_PASS', previousRound: r.round - 1 || null },
  ],
});

beforeEach(() => {
  const r2 = round(2, 1);
  const r1 = round(1, 0);
  vi.mocked(api.rounds.list).mockResolvedValue([r2, r1]);
  vi.mocked(api.rounds.get).mockImplementation(async (_p, id) => (id === 20 ? detailOf(r2, 'FAILED') : detailOf(r1, 'PASSED')));
});

describe('실행 이력 (#108)', () => {
  it('팀원에게는 이력 삭제 · 초기화 버튼을 보이지 않는다 (서버도 막는다)', () => {
    render(<ExecutionsTab {...props} canManage={false} />);
    expect(screen.getByRole('button', { name: /새로고침/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /선택 삭제/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /전체 초기화/ })).toBeNull();
  });

  it('PM · 관리자에게는 보인다', () => {
    render(<ExecutionsTab {...props} />);
    expect(screen.getByRole('button', { name: /선택 삭제/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /전체 초기화/ })).toBeTruthy();
  });
});

describe('실행 이력 상단 — 차수별 결과', () => {
  it('최근 차수를 한 문장으로 요약하고 지난번과 비교한다', async () => {
    render(<ExecutionsTab {...props} />);

    expect(await screen.findByRole('region', { name: '차수별 결과' })).toBeTruthy();
    expect(await screen.findByText('2차 테스트에서 2개 중 1개가 통과했어요. 지난번보다 1개가 새로 실패했어요.')).toBeTruthy();
    expect(screen.getByRole('img', { name: '최근 차수별 통과 · 실패 케이스 수 막대 차트' })).toBeTruthy();
    expect(screen.getByText("'로그인' 버튼을 찾지 못했어요")).toBeTruthy();
    expect(api.rounds.list).toHaveBeenCalledWith('p1');
  });

  it('콤보박스로 다른 차수를 고르면 그 차수로 바뀐다', async () => {
    render(<ExecutionsTab {...props} />);
    await screen.findByText(/2차 테스트에서 2개 중 1개가 통과했어요/);

    fireEvent.change(screen.getByLabelText('차수 고르기'), { target: { value: '10' } });

    await waitFor(() => expect(api.rounds.get).toHaveBeenCalledWith('p1', 10));
    expect(await screen.findByText('1차 테스트에서 2개 중 2개가 통과했어요. 지난번과 달라진 케이스는 없어요.')).toBeTruthy();
  });

  it('"로그와 화면 기록 보기"는 고른 차수의 실행 결과를 연다', async () => {
    const onSelect = vi.fn();
    render(<ExecutionsTab {...props} onSelect={onSelect} />);
    await screen.findByText(/2차 테스트에서 2개 중 1개가 통과했어요/);

    fireEvent.change(screen.getByLabelText('차수 고르기'), { target: { value: '10' } });
    await screen.findByText(/1차 테스트에서 2개 중 2개가 통과했어요/);
    fireEvent.click(screen.getByRole('button', { name: '로그와 화면 기록 보기' }));

    expect(onSelect).toHaveBeenCalledWith(10);
  });

  it('접으면 내용이 사라지고, 다시 펼치면 돌아온다', async () => {
    render(<ExecutionsTab {...props} />);
    await screen.findByText(/2차 테스트에서 2개 중 1개가 통과했어요/);

    const toggle = screen.getByRole('button', { name: '차수별 결과' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/2차 테스트에서 2개 중 1개가 통과했어요/)).toBeNull();
    expect(screen.queryByLabelText('차수 고르기')).toBeNull();

    fireEvent.click(toggle);
    expect(await screen.findByText(/2차 테스트에서 2개 중 1개가 통과했어요/)).toBeTruthy();
  });

  it('돌린 테스트가 없으면 1차 테스트를 시작하라고 안내한다', async () => {
    vi.mocked(api.rounds.list).mockResolvedValue([]);
    render(<ExecutionsTab {...props} />);

    expect(await screen.findByText(/‘전체 실행’을 누르면 1차 테스트가 시작돼요/)).toBeTruthy();
  });
});
