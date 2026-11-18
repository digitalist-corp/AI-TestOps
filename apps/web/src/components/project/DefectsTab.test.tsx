import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '@/api/client';
import type { Defect } from '@/types';
import { DefectsTab } from './DefectsTab';

vi.mock('@/api/client', () => ({
  api: {
    defects: { list: vi.fn() },
    members: { list: vi.fn() },
    testSuites: { listByProject: vi.fn() },
    getSiteMap: vi.fn(),
  },
}));

const defect = (over: Partial<Defect>): Defect => ({
  specPath: 'tests/a.spec.ts', grep: '로그인', title: '로그인', describePath: '', status: 'OPEN',
  assignee: '윤재', assigneeUserId: 7, failCount: 2,
  firstFailedExecutionId: 3, firstFailedAt: null, lastExecutionId: 4, lastRunAt: null,
  resolvedExecutionId: null, resolvedAt: null, errorMessage: 'Timeout\n자세히', routeKeys: ['/login'],
  runs: [{ executionId: 3, status: 'FAILED', at: null, rerunOf: null }, { executionId: 4, status: 'FAILED', at: null, rerunOf: 3 }],
  ...over,
});

beforeEach(() => {
  vi.mocked(api.defects.list).mockResolvedValue({
    defects: [defect({}), defect({ grep: '결제(카드)', title: '결제(카드)', specPath: 'tests/b.spec.ts', routeKeys: [] })],
    open: 2,
    resolved: 0,
  });
  vi.mocked(api.members.list).mockResolvedValue([{ userId: 7, username: 'yj', displayName: '윤재', role: 'MEMBER' }] as never);
  vi.mocked(api.testSuites.listByProject).mockResolvedValue([]);
  vi.mocked(api.getSiteMap).mockResolvedValue({
    nodes: [{ routeKey: '/login', title: '로그인 화면', stale: false, excluded: false }],
  } as never);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderTab(onRerun = vi.fn(), onOpenExecution = vi.fn()) {
  render(<DefectsTab projectId="p1" refreshKey="" onRerun={onRerun} onOpenExecution={onOpenExecution} />);
  return { onRerun, onOpenExecution };
}

describe('결함 탭', () => {
  it('처음에는 미해결만 불러오고 화면 이름 · 담당자 · 실패 횟수 · 오류 첫 줄을 보여 준다', async () => {
    renderTab();
    expect(await screen.findByText('결제(카드)')).toBeTruthy();
    expect(api.defects.list).toHaveBeenCalledWith('p1', { status: 'OPEN' });
    expect(screen.getByText('미해결 2 · 해결 0')).toBeTruthy();
    expect(screen.getAllByText('로그인 화면').length).toBeGreaterThan(0);
    expect(screen.getByText('미지정')).toBeTruthy();
    expect(screen.getAllByText('2회')).toHaveLength(2);
    expect(screen.getAllByText('Timeout')).toHaveLength(2);
  });

  it('필터를 바꾸면 그 조건으로 다시 불러온다', async () => {
    renderTab();
    await screen.findByText('결제(카드)');
    fireEvent.change(screen.getByLabelText('상태'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('담당자'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('화면'), { target: { value: '/login' } });
    await waitFor(() =>
      expect(api.defects.list).toHaveBeenLastCalledWith('p1', { status: undefined, assigneeUserId: 7, screen: '/login' }),
    );
  });

  it('고른 결함만 키(파일 · 이름)로 다시 실행한다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onRerun } = renderTab();
    await screen.findByText('결제(카드)');
    const button = screen.getByRole('button', { name: /고른 0건 다시 실행/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('모두 고르기'));
    fireEvent.click(screen.getByRole('button', { name: /고른 2건 다시 실행/ }));

    expect(onRerun).toHaveBeenCalledWith([
      { specPath: 'tests/a.spec.ts', grep: '로그인' },
      { specPath: 'tests/b.spec.ts', grep: '결제(카드)' },
    ]);
  });

  it('실패만 다시 실행은 필터와 상관없이 미해결 전부를 빈 목록으로 보낸다', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onRerun } = renderTab();
    await screen.findByText('결제(카드)');
    fireEvent.click(screen.getByRole('button', { name: /실패만 다시 실행/ }));
    await waitFor(() => expect(onRerun).toHaveBeenCalledWith([]));
    expect(confirm).toHaveBeenCalledWith('미해결 결함 2건을 모두 다시 실행할까요?');
  });

  it('실행 흐름 칸: 발견 → 다시 실행 → 해결, 누르면 그 실행으로', async () => {
    vi.mocked(api.defects.list).mockResolvedValue({
      defects: [defect({
        status: 'RESOLVED', resolvedExecutionId: 5,
        runs: [
          { executionId: 3, status: 'FAILED', at: null, rerunOf: null },
          { executionId: 4, status: 'FAILED', at: null, rerunOf: 3 },
          { executionId: 5, status: 'PASSED', at: null, rerunOf: 4 },
        ],
      })],
      open: 0,
      resolved: 1,
    });
    const { onOpenExecution } = renderTab();
    const flow = await screen.findByRole('list', { name: '로그인 실행 흐름' });
    expect(flow.textContent).toBe('#3 발견→#4 실패 · 다시→#5 해결 · 다시');
    fireEvent.click(screen.getByRole('button', { name: '#5 해결 · 다시' }));
    expect(onOpenExecution).toHaveBeenCalledWith(5);
  });

  it('실행 중이면 다시 실행을 잠근다', async () => {
    render(<DefectsTab projectId="p1" refreshKey="" runDisabled onRerun={vi.fn()} onOpenExecution={vi.fn()} />);
    await screen.findByText('결제(카드)');
    fireEvent.click(screen.getByLabelText('모두 고르기'));
    expect((screen.getByRole('button', { name: /고른 2건 다시 실행/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /실패만 다시 실행/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('케이스 이름을 누르면 마지막으로 실패한 실행 결과로 간다', async () => {
    vi.mocked(api.defects.list).mockResolvedValue({
      defects: [defect({
        status: 'RESOLVED', lastExecutionId: 9, resolvedExecutionId: 5,
        runs: [
          { executionId: 3, status: 'FAILED', at: null, rerunOf: null },
          { executionId: 4, status: 'FAILED', at: null, rerunOf: null },
          { executionId: 5, status: 'PASSED', at: null, rerunOf: null },
        ],
      })],
      open: 0,
      resolved: 1,
    });
    const { onOpenExecution } = renderTab();
    fireEvent.click(await screen.findByRole('button', { name: '로그인' }));
    expect(onOpenExecution).toHaveBeenCalledWith(4);
  });
});
