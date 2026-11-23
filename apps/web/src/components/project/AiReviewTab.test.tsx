import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { api } from '@/api/client';
import type { AiJob } from '@/types';
import { AiReviewTab } from './AiReviewTab';
import { FixProposals } from './FixProposalCard';

vi.mock('@/lib/aiEnabled', () => ({ useAiEnabled: () => ({ active: true }) }));
vi.mock('@/lib/access', () => ({ useAccess: () => ({ canManage: () => true }) }));
vi.mock('@/api/client', () => ({
  getStoredAuth: () => null,
  api: { aiJobs: { listByProject: vi.fn(), approve: vi.fn(), reject: vi.fn(), proceed: vi.fn(), dismiss: vi.fn() } },
}));

const job = (status: AiJob['status']): AiJob => ({
  id: 1,
  projectId: 'p1',
  jobType: 'CODE_FIX',
  status,
  aiModelProvider: 'CLAUDE',
  instruction: '대기 시간을 늘려 보세요',
  targetSpecPath: 'tests/a.spec.ts',
  failedExecutionId: 7,
  autoCreated: true,
  iterationsUsed: 0,
  createdAt: '2026-11-07T00:00:00Z',
  updatedAt: '2026-11-07T00:00:00Z',
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('AiReviewTab 승인', () => {
  it('승인이 성공하면 SSE 없이도 같은 탭의 실행 상세 카드가 바로 수정 완료로 바뀐다', async () => {
    // 배포 주소처럼 SSE 가 오지 않는다.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    vi.stubGlobal('confirm', () => true);
    const list = vi.mocked(api.aiJobs.listByProject);
    list.mockResolvedValue([job('NEEDS_REVIEW')]);
    vi.mocked(api.aiJobs.approve).mockImplementationOnce(async () => {
      list.mockResolvedValue([job('APPLIED')]);
      return job('APPLIED');
    });
    render(
      <>
        <AiReviewTab projectId="p1" />
        <FixProposals projectId="p1" executionId={7} />
      </>
    );
    expect(await screen.findByText(/AI 검토 탭에서 확인하고/)).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: /승인 및 적용/ }));

    // 5초 보완 조회보다 훨씬 짧게 기다린다.
    expect(await screen.findByText(/수정 완료/, undefined, { timeout: 1000 })).toBeTruthy();
  });
});
