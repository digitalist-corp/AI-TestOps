import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { api } from '@/api/client';
import type { AiJob } from '@/types';
import type { AiTaskEvent } from '@/hooks/useAiTaskEvents';
import { FixProposals } from './FixProposalCard';

let emit: (e: AiTaskEvent) => void = () => {};
vi.mock('@/hooks/useAiTaskEvents', () => ({
  useAiTaskEvents: (listener: (e: AiTaskEvent) => void) => {
    emit = listener;
  },
}));
vi.mock('@/lib/aiEnabled', () => ({ useAiEnabled: () => ({ active: true }) }));
vi.mock('@/lib/access', () => ({ useAccess: () => ({ canManage: () => true }) }));
vi.mock('@/api/client', () => ({
  api: { aiJobs: { listByProject: vi.fn(), proceed: vi.fn(), dismiss: vi.fn() } },
}));

const job = (status: AiJob['status'], extra: Partial<AiJob> = {}): AiJob => ({
  id: 1,
  projectId: 'p1',
  jobType: 'CODE_FIX',
  status,
  aiModelProvider: 'CLAUDE',
  instruction: '대기 시간을 늘려 보세요',
  targetSpecPath: 'tests/a.spec.ts',
  failedExecutionId: 7,
  // 서버의 자동 제안(FixProposalService)은 항상 autoCreated
  autoCreated: true,
  iterationsUsed: 0,
  createdAt: '2026-11-07T00:00:00Z',
  updatedAt: '2026-11-07T00:00:00Z',
  ...extra,
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

async function proceedOnce() {
  vi.mocked(api.aiJobs.listByProject).mockResolvedValueOnce([job('PROPOSED')]);
  vi.mocked(api.aiJobs.proceed).mockResolvedValueOnce(job('PENDING'));
  render(<FixProposals projectId="p1" executionId={7} />);
  fireEvent.click(await screen.findByRole('button', { name: '진행' }));
  expect(await screen.findByText(/AI가 고치는 중/)).toBeTruthy();
  expect(screen.queryByText(/수정 완료/)).toBeNull();
  expect(screen.queryByText('이렇게 고칠까요?')).toBeNull();
}

describe('FixProposals (실행 상세)', () => {
  it('진행한 제안은 사라지지 않고, 서버에서 반영되면 새로고침 없이 수정 완료로 바뀐다', async () => {
    await proceedOnce();

    vi.mocked(api.aiJobs.listByProject).mockResolvedValueOnce([job('APPLIED')]);
    await act(async () => emit({ type: 'ready' }));

    expect(await screen.findByText(/수정 완료/)).toBeTruthy();
    expect(screen.queryByText(/AI가 고치는 중/)).toBeNull();
  });

  it('AI 수정이 끝나 승인을 기다리면 완료가 아니라 승인 대기로 보인다', async () => {
    await proceedOnce();

    vi.mocked(api.aiJobs.listByProject).mockResolvedValueOnce([job('NEEDS_REVIEW')]);
    await act(async () => emit({ type: 'job', id: 1, projectId: 'p1', status: 'NEEDS_REVIEW' }));

    expect(await screen.findByText(/AI 검토 탭에서/)).toBeTruthy();
    expect(screen.queryByText(/수정 완료/)).toBeNull();
  });

  it('실패하면 실패와 이유를 같은 자리에 보인다', async () => {
    await proceedOnce();

    vi.mocked(api.aiJobs.listByProject).mockResolvedValueOnce([job('FAILED', { errorMessage: '반복 상한 도달' })]);
    await act(async () => emit({ type: 'ready' }));

    expect(await screen.findByText(/수정하지 못했어요/)).toBeTruthy();
    expect(screen.getByText('반복 상한 도달')).toBeTruthy();
    expect(screen.queryByText(/수정 완료/)).toBeNull();
  });

  it('다른 화면에서 승인된 뒤 다시 들어와도 원래 자동 제안을 찾아 수정 완료로 보인다', async () => {
    vi.mocked(api.aiJobs.listByProject).mockResolvedValueOnce([
      job('APPLIED', { autoCreated: true }),
      // 사람이 직접 만든 수정(자동 제안 아님)과 학습 루프가 띄운 수정은 제안 카드가 아니다
      job('APPLIED', { id: 2, autoCreated: false, instruction: '직접 요청한 수정' }),
      job('APPLIED', { id: 3, autoCreated: true, parentJobId: 9, instruction: '루프 수정' }),
    ]);
    render(<FixProposals projectId="p1" executionId={7} />);

    expect(await screen.findByText(/수정 완료/)).toBeTruthy();
    expect(screen.queryByText('직접 요청한 수정')).toBeNull();
    expect(screen.queryByText('루프 수정')).toBeNull();
  });

  it('반영 뒤 되돌려졌으면 수정 완료 대신 되돌림으로 보인다', async () => {
    vi.mocked(api.aiJobs.listByProject).mockResolvedValueOnce([
      job('APPLIED', { autoCreated: true, revertedAt: '2026-11-07T01:00:00Z' }),
    ]);
    render(<FixProposals projectId="p1" executionId={7} />);

    expect(await screen.findByText(/되돌림 결과를 확인/)).toBeTruthy();
    expect(screen.queryByText(/수정 완료/)).toBeNull();
  });

  it('진행 요청이 거절되면 제안과 버튼을 그대로 두고 이유를 보인다', async () => {
    vi.mocked(api.aiJobs.listByProject).mockResolvedValueOnce([job('PROPOSED')]);
    vi.mocked(api.aiJobs.proceed).mockRejectedValueOnce(new Error('AI 키가 등록되지 않았습니다'));
    render(<FixProposals projectId="p1" executionId={7} />);
    fireEvent.click(await screen.findByRole('button', { name: '진행' }));

    expect(await screen.findByText('AI 키가 등록되지 않았습니다')).toBeTruthy();
    expect(screen.getByText('이렇게 고칠까요?')).toBeTruthy();
    expect(screen.getByRole('button', { name: '진행' })).toBeTruthy();
  });
});
