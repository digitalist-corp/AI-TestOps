import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '@/api/client';
import type { Me } from '@/lib/access';
import type { AiJob, FailureCluster } from '@/types';
import { AiLoopPanel } from './AiLoopPanel';

let me: Me | null = null;
vi.mock('@/lib/access', async (orig) => {
  const mod = await orig<typeof import('@/lib/access')>();
  return { ...mod, useAccess: () => mod.accessOf(me) };
});
vi.mock('@/hooks/useAiTaskEvents', () => ({ useAiTaskEvents: () => {} }));
vi.mock('@/api/client', () => ({
  api: {
    failures: { clusters: vi.fn() },
    aiLoop: { status: vi.fn(), start: vi.fn() },
    aiJobs: { listByProject: vi.fn() },
    getExecutions: vi.fn(),
  },
}));

const pm: Me = { id: 1, username: 'pm', displayName: null, role: 'USER', projects: [{ projectId: 'p1', role: 'PM' }] };
const member: Me = { ...pm, projects: [{ projectId: 'p1', role: 'MEMBER' }] };

const cluster: FailureCluster = {
  signature: 'aaaaaaaaaaaa', head: 'expect(locator).toBeVisible() failed', locator: null, specPath: 'demo.spec.ts',
  cause: 'SCRIPT_ERROR', causeSource: 'RULE', summary: "'문의하기' 링크를 찾지 못했습니다", count: 1,
  cases: ['문의하기 링크가 보인다'], sampleError: '', pastFixes: 1, recalled: [],
};

const loop = (over: Partial<AiJob>): AiJob => ({
  id: 9, projectId: 'p1', jobType: 'LEARNING_LOOP', status: 'RUNNING', aiModelProvider: 'CLAUDE',
  instruction: '', targetSpecPath: '', failedExecutionId: 5, iterationsUsed: 1,
  summary: '1바퀴 분류: 스크립트 오류 · 과거 수정 1건 참고\n수정안 #10 재검증 통과 → 승인 대기',
  createdAt: '', updatedAt: '', ...over,
});

beforeEach(() => {
  me = pm;
  vi.mocked(api.failures.clusters).mockResolvedValue([cluster]);
  vi.mocked(api.aiLoop.status).mockResolvedValue({ available: true });
  vi.mocked(api.aiJobs.listByProject).mockResolvedValue([]);
  vi.mocked(api.getExecutions).mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AI 루프 패널', () => {
  it('원인과 과거 수정 수를 보이고, PM 은 AI 루프로 고치기를 누를 수 있다', async () => {
    vi.mocked(api.aiLoop.start).mockResolvedValue(loop({}));
    render(<AiLoopPanel projectId="p1" executionId={5} />);

    expect(await screen.findByText('스크립트 오류')).toBeTruthy();
    expect(screen.getByText('과거 수정 1건 참고')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /AI 루프로 고치기/ }));
    await waitFor(() => expect(api.aiLoop.start).toHaveBeenCalledWith('p1', 5));
    expect(await screen.findByText(/승인 대기/)).toBeTruthy();
  });

  it('팀원에게는 버튼이 없다', async () => {
    me = member;
    render(<AiLoopPanel projectId="p1" executionId={5} />);
    expect(await screen.findByText('과거 수정 1건 참고')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /AI 루프로 고치기/ })).toBeNull();
  });

  it('ai-service 가 꺼져 있으면 버튼 대신 안내', async () => {
    vi.mocked(api.aiLoop.status).mockResolvedValue({ available: false });
    render(<AiLoopPanel projectId="p1" executionId={5} />);
    expect(await screen.findByText(/AI 루프 서비스가 꺼져 있어요/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /AI 루프로 고치기/ })).toBeNull();
  });

  it('이 실행의 루프가 돌고 있으면 기록을 보이고 다시 시작하지 않는다', async () => {
    vi.mocked(api.aiJobs.listByProject).mockResolvedValue([loop({}), loop({ id: 8, failedExecutionId: 4, summary: '다른 실행' })]);
    render(<AiLoopPanel projectId="p1" executionId={5} />);
    expect(await screen.findByText(/재검증 통과 → 승인 대기/)).toBeTruthy();
    expect(screen.queryByText('다른 실행')).toBeNull();
    const button = (await screen.findByRole('button', { name: /AI 루프로 고치기/ })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('실패 묶음이 없으면 아무것도 그리지 않는다', async () => {
    vi.mocked(api.failures.clusters).mockResolvedValue([]);
    const { container } = render(<AiLoopPanel projectId="p1" executionId={5} />);
    await waitFor(() => expect(api.failures.clusters).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('지금 단계를 보인다: 고치는 중(스피너) → 승인 대기(사람 차례) → 다시 실행 중', async () => {
    const child = (over: Partial<AiJob>): AiJob => loop({ id: 10, jobType: 'CODE_FIX', parentJobId: 9, summary: '', ...over });
    vi.mocked(api.aiJobs.listByProject).mockResolvedValue([child({ status: 'RUNNING' }), loop({})]);
    render(<AiLoopPanel projectId="p1" executionId={5} />);
    expect((await screen.findByRole('status')).textContent).toContain('AI가 격리 사본에서 고치는 중');
    cleanup();

    vi.mocked(api.aiJobs.listByProject).mockResolvedValue([child({ status: 'NEEDS_REVIEW' }), loop({})]);
    render(<AiLoopPanel projectId="p1" executionId={5} />);
    const waiting = await screen.findByRole('status');
    expect(waiting.textContent).toContain('승인을 기다리는 중');
    expect(waiting.querySelector('.animate-spin')).toBeNull();
    cleanup();

    vi.mocked(api.aiJobs.listByProject).mockResolvedValue([
      child({ status: 'APPLIED', postApplyVerificationStatus: 'PENDING' }), loop({})]);
    render(<AiLoopPanel projectId="p1" executionId={5} />);
    expect((await screen.findByRole('status')).textContent).toContain('다시 실행해 확인하는 중');
  });
});
