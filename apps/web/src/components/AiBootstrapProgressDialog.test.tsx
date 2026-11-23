import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AiBootstrapResponse } from '@/types';
import { ApiError } from '@/api/client';
import { AiBootstrapProgressDialog } from './AiBootstrapProgressDialog';
import { briefingMessages } from './a2ui/briefingFixture';

const api = vi.hoisted(() => ({
  aiBootstrap: vi.fn(),
  getAiBootstrap: vi.fn(),
  sendAiBootstrapBriefingAction: vi.fn(),
  fetchAiBootstrapScreenshot: vi.fn(),
  submitAiBootstrapCredentials: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  api,
}));

function status(overrides: Partial<AiBootstrapResponse>): AiBootstrapResponse {
  return {
    bootstrapId: 'bt-1',
    phase: 'PASSED',
    healAttempt: 0,
    maxHealAttempts: 2,
    executionId: 1,
    generatedFiles: ['tests/first.spec.ts'],
    specPath: 'tests/first.spec.ts',
    estimatedDurationMs: 10_000,
    siteAnalysis: null,
    warnings: [],
    error: null,
    failureLog: null,
    startedAt: '2026-11-23T00:00:00Z',
    finishedAt: '2026-11-23T00:01:00Z',
    briefingStatus: null,
    briefing: [],
    ...overrides,
  };
}

function renderDialog() {
  render(
    <AiBootstrapProgressDialog open projectId="p1" instruction="" onClose={() => {}} onOpenProject={() => {}} />
  );
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

describe('AiBootstrapProgressDialog — 첫 실행 브리핑', () => {
  it('오류로 끝나면 원문 오류 아래에 준비된 브리핑을 보여 준다', async () => {
    const error = '상주 Docker Runner가 중지되어 있습니다.';
    api.aiBootstrap.mockResolvedValue(status({ phase: 'GENERATING', finishedAt: null }));
    api.getAiBootstrap.mockResolvedValue(
      status({ phase: 'ERROR', error, briefingStatus: 'READY', briefing: briefingMessages() })
    );
    renderDialog();

    const briefing = await screen.findByText('AI가 이 사이트를 살펴봤어요', {}, { timeout: 3000 });
    const rawError = screen.getByText(error);
    expect(rawError.compareDocumentPosition(briefing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(api.getAiBootstrap).toHaveBeenCalledWith('p1', 'bt-1');
  });

  it('끝났어도 브리핑을 정리하는 중이면 계속 읽고, 다 되면 브리핑을 보여 준다', async () => {
    api.aiBootstrap.mockResolvedValue(status({ briefingStatus: 'PENDING' }));
    api.getAiBootstrap.mockResolvedValue(status({ briefingStatus: 'READY', briefing: briefingMessages() }));
    renderDialog();

    expect(await screen.findByText('AI가 결과를 쉬운 말로 정리하는 중이에요…')).toBeTruthy();
    // 기존 PASSED 문구는 그대로
    expect(screen.getByText('AI가 만든 테스트가 실제로 통과했습니다')).toBeTruthy();

    expect(await screen.findByText('AI가 이 사이트를 살펴봤어요', {}, { timeout: 3000 })).toBeTruthy();
    expect(api.getAiBootstrap).toHaveBeenCalledWith('p1', 'bt-1');
    expect(screen.queryByText('AI가 결과를 쉬운 말로 정리하는 중이에요…')).toBeNull();
  });

  it('계획에 넣기를 누르면 action 메시지를 보내고, 응답한 브리핑으로 다시 그린다', async () => {
    api.aiBootstrap.mockResolvedValue(status({ briefingStatus: 'READY', briefing: briefingMessages() }));
    api.sendAiBootstrapBriefingAction.mockResolvedValue(
      status({ briefingStatus: 'READY', briefing: briefingMessages({ done: true }) })
    );
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: '계획에 넣기' }));

    expect(await screen.findByText('2건을 계획에 넣었어요. 계획 탭에서 볼 수 있어요.')).toBeTruthy();
    expect(api.sendAiBootstrapBriefingAction).toHaveBeenCalledWith(
      'p1',
      'bt-1',
      expect.objectContaining({
        version: '1.0',
        action: expect.objectContaining({ name: 'add_to_plan', context: { selected: ['test-0', 'suggest-0'] } }),
      })
    );
  });

  it('요청 중에는 버튼을 막고, 권한이 없으면 브리핑 아래에 쉬운 말로 알려 준다', async () => {
    api.aiBootstrap.mockResolvedValue(status({ briefingStatus: 'READY', briefing: briefingMessages() }));
    let reject: (err: unknown) => void = () => {};
    api.sendAiBootstrapBriefingAction.mockReturnValue(new Promise((_, r) => (reject = r)));
    renderDialog();

    const button = (await screen.findByRole('button', { name: '계획에 넣기' })) as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => expect(button.matches(':disabled')).toBe(true));
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).matches(':disabled')).toBe(true);

    reject(new ApiError('Forbidden', 403));

    expect(await screen.findByText('계획에 추가할 권한이 없어요.')).toBeTruthy();
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '계획에 넣기' }) as HTMLButtonElement).matches(':disabled')).toBe(false)
    );
  });

  it('브리핑을 기다리다 조회가 실패해도 통과 결과는 그대로 둔다', async () => {
    api.aiBootstrap.mockResolvedValue(status({ briefingStatus: 'PENDING' }));
    api.getAiBootstrap.mockRejectedValue(new Error('network'));
    renderDialog();

    await waitFor(() => expect(api.getAiBootstrap).toHaveBeenCalled(), { timeout: 3000 });
    await waitFor(() => expect(screen.queryByText('AI가 결과를 쉬운 말로 정리하는 중이에요…')).toBeNull());
    expect(screen.getByText('AI가 만든 테스트가 실제로 통과했습니다')).toBeTruthy();
    expect(screen.queryByText('network')).toBeNull();
  });
});
