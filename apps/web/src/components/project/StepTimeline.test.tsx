import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '@/api/client';
import type { CaseSteps } from '@/types';
import { StepTimeline } from './StepTimeline';

vi.mock('@/api/client', () => ({ api: { getSteps: vi.fn() } }));

const failed: CaseSteps = {
  specPath: 'tests/login.spec.ts',
  title: 'login.spec.ts > 로그인 > 관리자 로그인',
  status: 'FAILED',
  failedStep: 2,
  steps: [
    { text: "'/login' 페이지로 이동", category: 'pw:api', status: 'PASSED', error: null, offsetMs: 300 },
    { text: "'아이디' 입력란에 'admin' 입력", category: 'pw:api', status: 'PASSED', error: null, offsetMs: 1200 },
    { text: "'로그인' 버튼 클릭", category: 'pw:api', status: 'FAILED', error: 'TimeoutError: 30000ms', offsetMs: 6500 },
  ],
  attachments: [
    { name: 'screenshot', contentType: 'image/png', path: 'test-results/x/test-failed-1.png' },
    { name: 'video', contentType: 'video/webm', path: 'test-results/x/video.webm' },
  ],
};
const passed: CaseSteps = {
  specPath: 'tests/login.spec.ts',
  title: 'login.spec.ts > 로그아웃',
  status: 'PASSED',
  failedStep: null,
  steps: [{ text: "'/' 페이지로 이동", category: 'pw:api', status: 'PASSED', error: null, offsetMs: 100 }],
  attachments: [],
};

const media = (path: string) => `/a?path=${path}`;

beforeEach(() => {
  vi.mocked(api.getSteps).mockResolvedValue({ recorded: true, cases: [passed, failed] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('단계별 실행 기록', () => {
  it('실패 케이스를 먼저 펼쳐 실패 단계와 그때의 화면 · 영상(실패 2초 전부터)을 보여 준다', async () => {
    render(<StepTimeline projectId="p1" executionId={7} mediaUrl={media} />);

    const steps = await screen.findByRole('list', { name: '로그인 > 관리자 로그인 단계' });
    expect(steps.textContent).toContain("'로그인' 버튼 클릭");
    expect(steps.textContent).toContain('TimeoutError: 30000ms');
    expect(screen.getByText('3단계 중 3번째에서 실패')).toBeTruthy();
    expect(screen.getByAltText('실패 시점 화면').getAttribute('src')).toBe('/a?path=test-results/x/test-failed-1.png');
    expect(screen.getByLabelText('실패 직전부터 영상').getAttribute('src')).toBe('/a?path=test-results/x/video.webm#t=4.5');
    // 성공 케이스는 접혀 있고 누르면 펼친다
    expect(screen.queryByRole('list', { name: '로그아웃 단계' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /로그아웃/ }));
    expect(screen.getByRole('list', { name: '로그아웃 단계' })).toBeTruthy();
  });

  it('결함에서 들어오면 그 케이스의 실패 단계로 스크롤한다', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(
      <StepTimeline projectId="p1" executionId={7} mediaUrl={media} focus={{ specPath: 'login.spec.ts', title: '관리자 로그인' }} />,
    );
    await screen.findByRole('list', { name: '로그인 > 관리자 로그인 단계' });
    await waitFor(() => expect(scroll).toHaveBeenCalled()); // 스크롤은 그린 뒤 효과에서 — 바쁠 때 늦게 돈다
    expect(api.getSteps).toHaveBeenCalledWith('p1', 7);
  });

  it('단계 기록 전 실행이면 안내만 한다', async () => {
    vi.mocked(api.getSteps).mockResolvedValue({ recorded: false, cases: [] });
    render(<StepTimeline projectId="p1" executionId={7} mediaUrl={media} />);
    expect(await screen.findByText('이 실행에는 단계 기록이 없어요. 새로 실행하면 단계가 남아요.')).toBeTruthy();
  });
});
