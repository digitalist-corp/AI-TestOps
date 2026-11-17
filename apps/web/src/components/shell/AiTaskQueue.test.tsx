import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/api/client';
import type { AiJob } from '@/types';
import type { AiTaskEvent } from '@/hooks/useAiTaskEvents';
import { AiTaskQueue } from './AiTaskQueue';

let emit: (e: AiTaskEvent) => void = () => {};
vi.mock('@/hooks/useAiTaskEvents', () => ({
  useAiTaskEvents: (listener: (e: AiTaskEvent) => void) => {
    emit = listener;
  },
}));
vi.mock('@/lib/aiEnabled', () => ({ useAiEnabled: () => ({ active: true }) }));
vi.mock('@/api/client', () => ({
  api: { aiJobs: { listByProject: vi.fn(), needsReview: vi.fn(), proceed: vi.fn(), dismiss: vi.fn() } },
}));

const job = (id: number, status: AiJob['status'], instruction: string): AiJob => ({
  id,
  projectId: 'p1',
  jobType: 'CODE_FIX',
  status,
  aiModelProvider: 'CLAUDE',
  instruction,
  targetSpecPath: 'tests/a.spec.ts',
  iterationsUsed: 0,
  createdAt: '2026-11-07T00:00:00Z',
  updatedAt: '2026-11-07T00:00:00Z',
});

afterEach(cleanup);

describe('AiTaskQueue', () => {
  it('대화 없이 생긴 작업이 새로고침 없이 큐에 나타난다', async () => {
    const list = vi.mocked(api.aiJobs.listByProject);
    list.mockResolvedValueOnce([job(1, 'NEEDS_REVIEW', '로그인 셀렉터 수정')]);
    render(
      <MemoryRouter>
        <AiTaskQueue projectId="p1" />
      </MemoryRouter>
    );
    expect(await screen.findByText('로그인 셀렉터 수정')).toBeTruthy();
    expect(screen.getByRole('link', { name: '검토하러 가기' }).getAttribute('href')).toBe('/projects/p1/ai-review');

    list.mockResolvedValueOnce([job(2, 'PROPOSED', '대기 시간을 늘려 보세요'), job(1, 'NEEDS_REVIEW', '로그인 셀렉터 수정')]);
    await act(async () => emit({ type: 'job', id: 2, projectId: 'p1', status: 'PROPOSED' }));

    expect(await screen.findByText('대기 시간을 늘려 보세요')).toBeTruthy();
    expect(screen.getByText('이렇게 고칠까요?')).toBeTruthy();
  });

  it('다른 프로젝트의 작업 이벤트는 무시한다', async () => {
    const list = vi.mocked(api.aiJobs.listByProject);
    list.mockReset();
    list.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <AiTaskQueue projectId="p1" />
      </MemoryRouter>
    );
    expect(await screen.findByText('지금 처리할 AI 작업이 없습니다')).toBeTruthy();
    await act(async () => emit({ type: 'job', id: 9, projectId: 'p2', status: 'PROPOSED' }));
    expect(list).toHaveBeenCalledTimes(1);
  });
});
