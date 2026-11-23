import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { api } from '@/api/client';
import type { AppFixProposal, AppFixView } from '@/types';
import { AppFixProposalPanel, POLL_MS } from './AppFixProposal';

vi.mock('@/api/client', () => ({
  api: { defects: { fixProposal: vi.fn(), requestFixProposal: vi.fn() } },
}));

const KEY = { specPath: 'tests/cart.spec.ts', grep: '합계' };

const proposal = (over: Partial<AppFixProposal>): AppFixProposal => ({
  id: 5, status: 'DIFF_READY', category: 'APP_CODE', executionId: 41,
  sourceRepository: 'acme/shop', sourceBranch: null, sourceSha: '0123456789abcdef0123456789abcdef01234567', appRoot: 'apps/shop',
  verification: 'DIFF_APPLIES', evidence: '오류:\nReceived string: "합계 2"', summary: '합계에서 1을 뺀다',
  causes: ['apps/shop/app/cart/page.tsx:2 — items.length - 1'], checks: [],
  files: [{ path: 'apps/shop/app/cart/page.tsx', diff: '--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-  const count = items.length - 1;\n+  const count = items.length;\n' }],
  limitation: null, errorMessage: null, requestedBy: 7, createdAt: '2026-11-23T00:00:00Z', updatedAt: '2026-11-23T00:00:00Z',
  ...over,
});

const view = (p: AppFixProposal | null, stale = false): AppFixView => ({ category: 'APP_CODE', latestFailedExecutionId: 41, stale, proposal: p });

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});

const open = async () => {
  render(<AppFixProposalPanel projectId="p1" defectKey={KEY} />);
  fireEvent.click(screen.getByRole('button', { name: 'AI 수정 제안 보기' }));
};

describe('AI 수정 제안 (결함 상세)', () => {
  it('없으면 마지막 실패 실행으로 요청하고, 분석 중에는 완료로 보이지 않다가 결과가 오면 근거 → 기준 → 검증 → 파일 순으로 보인다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.defects.fixProposal).mockResolvedValueOnce(view(null)).mockResolvedValueOnce(view(proposal({})));
    vi.mocked(api.defects.requestFixProposal).mockResolvedValueOnce(view(proposal({ status: 'ANALYZING', verification: null, files: [], summary: null, causes: [] })));
    await open();

    expect(await screen.findByText(/분석 중/)).toBeTruthy();
    expect(api.defects.requestFixProposal).toHaveBeenCalledWith('p1', KEY, 41);
    expect(screen.queryByText(/diff 적용 확인/)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });

    const cause = await screen.findByText(/page.tsx:2 — items/);
    const repo = screen.getByText(/acme\/shop/);
    const unconfirmed = screen.getByText(/배포 버전 미확인/);
    const badge = screen.getByText('diff 적용 확인 · 재현 테스트 미실행');
    const file = screen.getByText('apps/shop/app/cart/page.tsx');
    expect(screen.getByText(/0123456/)).toBeTruthy();
    const order = [cause, repo, unconfirmed, badge, file];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // 파일별 diff 는 접혀 있다가 펼친다
    const details = file.closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(file);
    expect(details.open).toBe(true);
    expect(screen.getByText(/^\+\s+const count = items.length;$/)).toBeTruthy();
  });

  it('분석 상태를 일시적으로 읽지 못해도 다음 조회에서 결과를 표시한다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.defects.fixProposal)
      .mockResolvedValueOnce(view(proposal({ status: 'ANALYZING', files: [] })))
      .mockRejectedValueOnce(new Error('일시적인 조회 실패'))
      .mockResolvedValueOnce(view(proposal({})));
    await open();
    expect(await screen.findByText(/분석 중/)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    });

    expect(screen.getByText('diff 적용 확인 · 재현 테스트 미실행')).toBeTruthy();
  });

  it('이미 있으면 다시 요청하지 않고 보여 준다', async () => {
    vi.mocked(api.defects.fixProposal).mockResolvedValueOnce(view(proposal({})));
    await open();

    expect(await screen.findByText('diff 적용 확인 · 재현 테스트 미실행')).toBeTruthy();
    expect(api.defects.requestFixProposal).not.toHaveBeenCalled();
  });

  it('소스가 없으면 진단만 보여 주고 적용 확인 표시는 없다', async () => {
    vi.mocked(api.defects.fixProposal).mockResolvedValueOnce(view(proposal({
      status: 'DIAGNOSIS_ONLY', verification: null, files: [], sourceRepository: null, sourceSha: null, appRoot: null,
      limitation: '웹주소만 연결돼 있어 소스 없이 실행 증거로만 진단했어요.', checks: ['장바구니 합계 계산 확인'],
    })));
    await open();

    expect(await screen.findByText('진단만 제공')).toBeTruthy();
    expect(screen.getByText(/웹주소만 연결돼/)).toBeTruthy();
    expect(screen.getByText(/장바구니 합계 계산 확인/)).toBeTruthy();
    expect(screen.queryByText(/diff 적용 확인/)).toBeNull();
  });

  it('분석이 실패하면 원인을 보여 주고 같은 요청 경로로 다시 요청한다', async () => {
    vi.mocked(api.defects.fixProposal).mockResolvedValueOnce(view(proposal({ status: 'FAILED', errorMessage: '모델 응답 시간 초과', files: [] })));
    vi.mocked(api.defects.requestFixProposal).mockResolvedValueOnce(view(proposal({ status: 'ANALYZING', files: [] })));
    await open();

    expect(await screen.findByText(/모델 응답 시간 초과/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다시 요청' }));
    expect(await screen.findByText(/분석 중/)).toBeTruthy();
    expect(api.defects.requestFixProposal).toHaveBeenCalledWith('p1', KEY, 41);
  });

  it('이전 실행 · 소스 기준의 수정안은 이전 수정안으로 표시하고 새 분석을 요청할 수 있다', async () => {
    vi.mocked(api.defects.fixProposal).mockResolvedValueOnce(view(proposal({ executionId: 30 }), true));
    vi.mocked(api.defects.requestFixProposal).mockResolvedValueOnce(view(proposal({ status: 'ANALYZING', files: [] })));
    await open();

    expect(await screen.findByText('이전 수정안')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '새 분석 요청' }));
    expect(await screen.findByText(/분석 중/)).toBeTruthy();
  });

  it('새 분석을 막은 경우 이전 · 실패한 결과는 보이되 다시 요청 버튼 대신 이유를 보인다', async () => {
    vi.mocked(api.defects.fixProposal).mockResolvedValueOnce(view(proposal({ executionId: 30 }), true));
    render(<AppFixProposalPanel projectId="p1" defectKey={KEY} requestBlockedReason="AI를 꺼 두어 새 분석은 요청하지 않아요." />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 수정 제안 보기' }));

    expect(await screen.findByText('이전 수정안')).toBeTruthy();
    expect(screen.getByText('diff 적용 확인 · 재현 테스트 미실행')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '새 분석 요청' })).toBeNull();
    cleanup();

    vi.mocked(api.defects.fixProposal).mockResolvedValueOnce(view(proposal({ status: 'FAILED', errorMessage: '모델 응답 시간 초과', files: [] })));
    render(<AppFixProposalPanel projectId="p1" defectKey={KEY} requestBlockedReason="AI를 꺼 두어 새 분석은 요청하지 않아요." />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 수정 제안 보기' }));

    expect(await screen.findByText(/모델 응답 시간 초과/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '다시 요청' })).toBeNull();
    expect(api.defects.requestFixProposal).not.toHaveBeenCalled();
  });

  it('AI 없이 끝난 진단(키가 없었음)은 다시 분석을 요청할 수 있고, AI 를 끈 사용자에게는 버튼이 없다', async () => {
    const noAi = proposal({
      status: 'DIAGNOSIS_ONLY', verification: null, files: [], summary: null, causes: [],
      limitation: 'AI 설정(키)이 없어 원인 분석 없이 실행 증거만 보여 줘요.',
    });
    vi.mocked(api.defects.fixProposal).mockResolvedValueOnce(view(noAi));
    vi.mocked(api.defects.requestFixProposal).mockResolvedValueOnce(view(proposal({ status: 'ANALYZING', files: [] })));
    await open();

    fireEvent.click(await screen.findByRole('button', { name: 'AI로 다시 분석' }));
    expect(await screen.findByText(/분석 중/)).toBeTruthy();
    expect(api.defects.requestFixProposal).toHaveBeenCalledWith('p1', KEY, 41);
    cleanup();

    vi.mocked(api.defects.fixProposal).mockResolvedValueOnce(view(noAi));
    render(<AppFixProposalPanel projectId="p1" defectKey={KEY} requestBlockedReason="AI를 꺼 두어 새 분석은 요청하지 않아요." />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 수정 제안 보기' }));
    expect(await screen.findByText('진단만 제공')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'AI로 다시 분석' })).toBeNull();
  });

  it('요청이 거절되면 이유를 보이고 버튼을 다시 누를 수 있다', async () => {
    vi.mocked(api.defects.fixProposal).mockResolvedValueOnce(view(null));
    vi.mocked(api.defects.requestFixProposal).mockRejectedValueOnce(new Error('이 프로젝트의 멤버가 아닙니다.'));
    await open();

    expect(await screen.findByText('이 프로젝트의 멤버가 아닙니다.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'AI 수정 제안 보기' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
