import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { AiPanel } from './AiPanel';
import type { ChatMessage, ChatSession, ChatStreamEvent, ChatUiAnswer } from '@/types';
import { chatQuestionMessages } from '@/components/a2ui/chatQuestionFixture';

afterEach(cleanup);

vi.mock('@/api/client', () => ({
  getStoredAuth: () => ({ token: 'tok', username: 'admin', role: 'ADMIN' }),
  api: {
    chat: {
      listSessions: vi.fn(),
      getSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      respondPermission: vi.fn(),
      cancel: vi.fn(),
      streamMessage: vi.fn(),
    },
    aiJobs: {
      listByProject: vi.fn().mockResolvedValue([]),
      needsReview: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({
        id: 77,
        projectId: 'p1',
        jobType: 'CODE_FIX',
        status: 'NEEDS_REVIEW',
        aiModelProvider: 'CLAUDE',
        instruction: 'fix',
        targetSpecPath: 'tests/login.spec.ts',
        iterationsUsed: 1,
        createdAt: '2026-11-01T00:00:00Z',
        updatedAt: '2026-11-01T00:00:00Z',
      }),
    },
  },
}));

vi.mock('@/hooks/useAiTaskEvents', () => ({ useAiTaskEvents: () => {} }));

const mockedChat = vi.mocked(api.chat);

const sampleSession: ChatSession = {
  id: 1,
  projectId: 'proj-1',
  title: '로그인 실패 원인 분석',
  createdAt: '2026-11-01T08:00:00Z',
  updatedAt: '2026-11-01T08:05:00Z',
};

describe('AiPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('패널을 열면 작업 큐가 먼저 보이고 대화는 옆 탭에 있다 (D-04)', async () => {
    mockedChat.listSessions.mockResolvedValue([]);
    render(
      <MemoryRouter>
        <AiPanel onClose={() => {}} contextLabel="proj-1 · 실행" projectId="proj-1" />
      </MemoryRouter>
    );
    expect(screen.getByRole('tab', { name: '작업' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText('지금 처리할 AI 작업이 없습니다')).toBeTruthy();
  });

  it('프로젝트의 최근 세션을 자동으로 불러와 도구 카드 · 표 · 실행 링크 · 토큰 사용량을 표시한다', async () => {
    const messages: ChatMessage[] = [
      {
        id: 10,
        role: 'user',
        createdAt: '2026-11-01T08:00:00Z',
        blocks: [{ type: 'text', text: '최근 실행과 DB를 확인해줘' }],
      },
      {
        id: 11,
        role: 'assistant',
        createdAt: '2026-11-01T08:00:05Z',
        stopReason: 'END',
        usage: { inputTokens: 1200, outputTokens: 340 },
        blocks: [
          { type: 'text', text: 'DB를 먼저 조회했습니다.' },
          {
            type: 'tool',
            callId: 'c-sql',
            name: 'sql_query',
            tier: 'READ',
            input: { sql: 'SELECT id, status FROM ai_ro.executions' },
            status: 'ok',
            summary: '200행',
            durationMs: 45,
            display: {
              kind: 'table',
              data: {
                columns: ['id', 'status'],
                rows: [[42, 'FAILED']],
                truncated: true,
                sql: 'SELECT id, status FROM ai_ro.executions',
              },
            },
          },
          {
            type: 'tool',
            callId: 'c-run',
            name: 'run_tests',
            tier: 'RUN',
            input: { specPath: 'tests/login.spec.ts' },
            status: 'ok',
            summary: '실행 #99',
            display: {
              kind: 'execution',
              data: {
                executionId: 99,
                status: 'RUNNING',
                projectId: 'proj-1',
              },
            },
          },
        ],
      },
    ];

    mockedChat.listSessions.mockResolvedValue([sampleSession]);
    mockedChat.getSession.mockResolvedValue({ session: sampleSession, messages });

    render(
      <MemoryRouter>
        <AiPanel onClose={() => {}} contextLabel="proj-1 · 실행" projectId="proj-1" />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('tab', { name: '대화' }));

    expect(await screen.findByText('로그인 실패 원인 분석')).toBeTruthy();
    expect(screen.getByText('DB 조회')).toBeTruthy();
    expect(screen.getByText('테스트 실행')).toBeTruthy();
    expect(screen.getByText(/입력 1,200 · 출력 340 토큰/)).toBeTruthy();

    // 실행 카드는 바로 보이고 실행 탭 링크를 가진다
    const runLink = screen.getByRole('link', { name: '실행 탭에서 보기' });
    expect(runLink.getAttribute('href')).toBe('/projects/proj-1/runs');

    // DB 조회 카드를 펼치면 SQL 코드 블록과 표, 200행 제한 안내가 나온다
    fireEvent.click(screen.getByText('DB 조회'));
    expect(screen.getByText('SELECT id, status FROM ai_ro.executions')).toBeTruthy();
    expect(screen.getByText('200행까지만 표시')).toBeTruthy();
  });

  it('허락 카드(permission_request)에서 버튼을 누르면 respondPermission 을 호출하고 결정을 표시한다', async () => {
    mockedChat.listSessions.mockResolvedValue([]);
    mockedChat.createSession.mockResolvedValue({
      id: 2,
      projectId: 'proj-1',
      title: '테스트 돌려줘',
      createdAt: '2026-11-01T09:00:00Z',
      updatedAt: '2026-11-01T09:00:00Z',
    });
    mockedChat.respondPermission.mockResolvedValue(undefined);

    let emitEvent: ((ev: ChatStreamEvent) => void) | null = null;
    mockedChat.streamMessage.mockImplementation(async (_sid, _payload, onEvent) => {
      emitEvent = onEvent;
      onEvent({ type: 'message_start', data: { userMessageId: 20, messageId: 21 } });
      onEvent({
        type: 'tool_start',
        data: { callId: 'c1', name: 'run_tests', tier: 'RUN', input: { specPath: 'tests/a.spec.ts' } },
      });
      onEvent({
        type: 'permission_request',
        data: {
          requestId: 'perm-1',
          callId: 'c1',
          name: 'run_tests',
          input: { specPath: 'tests/a.spec.ts' },
          reason: 'tests/a.spec.ts 를 실행합니다.',
        },
      });
      // 스트림이 끝나지 않고 사용자 응답을 기다리는 상태를 유지
      await new Promise(() => {});
    });

    render(
      <MemoryRouter>
        <AiPanel onClose={() => {}} contextLabel="proj-1 · 시나리오" projectId="proj-1" />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('tab', { name: '대화' }));

    await waitFor(() => expect(mockedChat.listSessions).toHaveBeenCalledWith('proj-1'));

    const input = screen.getByPlaceholderText('무엇이든 물어보세요 (Shift+Enter 로 줄바꿈)');
    fireEvent.change(input, { target: { value: '테스트 돌려줘' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByText('tests/a.spec.ts 를 실행합니다.')).toBeTruthy();
    expect(screen.getByRole('button', { name: '허용' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '이 대화에서 항상 허용' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '거부' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '이 대화에서 항상 허용' }));

    await waitFor(() => {
      expect(mockedChat.respondPermission).toHaveBeenCalledWith(2, 'perm-1', 'ALLOW_SESSION');
    });
    expect(screen.getByText('이 대화에서 항상 허용함')).toBeTruthy();

    // 진행 중에는 중단 버튼이 보이고, 누르면 cancel 을 호출한다
    const cancelBtn = screen.getByRole('button', { name: '중단' });
    fireEvent.click(cancelBtn);
    await waitFor(() => {
      expect(mockedChat.cancel).toHaveBeenCalledWith(2);
    });
    expect(emitEvent).not.toBeNull();
  });

  it('스트림이 도중에 끊기면 getSession 으로 저장된 대화를 다시 읽어 복구한다', async () => {
    mockedChat.listSessions.mockResolvedValue([sampleSession]);
    mockedChat.getSession
      .mockResolvedValueOnce({ session: sampleSession, messages: [] })
      .mockResolvedValueOnce({
        session: sampleSession,
        messages: [
          {
            id: 30,
            role: 'user',
            createdAt: '2026-11-01T09:00:00Z',
            blocks: [{ type: 'text', text: '질문' }],
          },
          {
            id: 31,
            role: 'assistant',
            createdAt: '2026-11-01T09:00:02Z',
            stopReason: 'END',
            blocks: [{ type: 'text', text: '서버에 저장된 복구 답변입니다.' }],
          },
        ],
      });

    mockedChat.streamMessage.mockRejectedValueOnce(new Error('network lost'));

    render(
      <MemoryRouter>
        <AiPanel onClose={() => {}} contextLabel="proj-1 · 실행" projectId="proj-1" />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('tab', { name: '대화' }));

    await screen.findByText('로그인 실패 원인 분석');

    const input = screen.getByPlaceholderText('무엇이든 물어보세요 (Shift+Enter 로 줄바꿈)');
    await act(async () => {
      fireEvent.change(input, { target: { value: '질문' } });
      fireEvent.submit(input.closest('form')!);
    });

    expect(await screen.findByText('서버에 저장된 복구 답변입니다.')).toBeTruthy();
  });

  describe('질문 화면 (ask_user · a2ui)', () => {
    const QUESTION = '다시 돌릴 테스트를 골라 주세요';

    function questionMessage(
      id: number,
      surfaceId: string,
      { answer, extraComponents }: { answer?: ChatUiAnswer; extraComponents?: Record<string, unknown>[] } = {}
    ): ChatMessage {
      return {
        id,
        role: 'assistant',
        createdAt: '2026-11-01T09:00:02Z',
        stopReason: 'END',
        blocks: [
          { type: 'text', text: '어떤 테스트를 다시 돌릴까요?' },
          {
            type: 'tool',
            callId: 'call_1',
            name: 'ask_user',
            tier: 'READ',
            input: {},
            status: 'ok',
            summary: QUESTION,
            display: {
              kind: 'a2ui',
              data: { surfaceId, question: QUESTION, messages: chatQuestionMessages({ surfaceId, extraComponents }), answer },
            },
          },
        ],
      };
    }

    const userMessage = (id: number, text: string): ChatMessage => ({
      id,
      role: 'user',
      createdAt: '2026-11-01T09:00:00Z',
      blocks: [{ type: 'text', text }],
    });

    async function openChat(messages: ChatMessage[]) {
      mockedChat.listSessions.mockResolvedValue([sampleSession]);
      mockedChat.getSession.mockResolvedValue({ session: sampleSession, messages });
      render(
        <MemoryRouter>
          <AiPanel onClose={() => {}} contextLabel="proj-1 · 실행" projectId="proj-1" />
        </MemoryRouter>
      );
      fireEvent.click(screen.getByRole('tab', { name: '대화' }));
      await screen.findByText('로그인 실패 원인 분석');
    }

    const isLocked = (el: HTMLElement) => el.matches(':disabled');

    it('최근 질문에 답하면 uiAction 과 라벨 요약 content 로 보내고, 말풍선에 요약을 보이며 질문을 잠근다', async () => {
      mockedChat.streamMessage.mockImplementation(async (_sid, _payload, onEvent) => {
        onEvent({ type: 'message_start', data: { userMessageId: 22, messageId: 23 } });
        await new Promise(() => {});
      });
      await openChat([userMessage(20, '실패한 거 다시 돌려줘'), questionMessage(21, 'chat-21-call_1')]);

      const card = await screen.findByRole('region', { name: `질문: ${QUESTION}` });
      fireEvent.click(within(card).getByRole('checkbox', { name: /장바구니/ }));
      fireEvent.click(within(card).getByRole('radio', { name: '사파리' }));
      fireEvent.click(within(card).getByRole('button', { name: '다시 실행' }));

      await waitFor(() => expect(mockedChat.streamMessage).toHaveBeenCalledTimes(1));
      const summary = '다시 실행: 로그인 후 이름이 보인다, 장바구니에 담을 수 있다 · 사파리 · 메모: (비어 있음)';
      expect(mockedChat.streamMessage.mock.calls[0][0]).toBe(1);
      expect(mockedChat.streamMessage.mock.calls[0][1]).toEqual({
        content: summary,
        userLevel: 'JUNIOR',
        uiAction: {
          messageId: 21,
          surfaceId: 'chat-21-call_1',
          name: 'submit',
          context: { selected: ['login', 'cart'], browser: 'webkit', memo: '' },
        },
      });

      // 사용자 말풍선 + "보낸 답" + 잠금 (고른 값은 그대로 보인다)
      expect(await screen.findAllByText(summary)).toHaveLength(2);
      const locked = screen.getByRole('region', { name: `질문: ${QUESTION}` });
      expect(within(locked).getByText(/보낸 답:/)).toBeTruthy();
      const cart = within(locked).getByRole('checkbox', { name: /장바구니/ }) as HTMLInputElement;
      expect(cart.checked).toBe(true);
      expect(isLocked(cart)).toBe(true);
      expect((within(locked).getByRole('radio', { name: '사파리' }) as HTMLInputElement).checked).toBe(true);
    });

    it('답한 질문은 보낸 값으로 잠겨 "보낸 답" 을 보이고, 지나간 질문은 "지나간 질문이에요" 로 잠근다', async () => {
      await openChat([
        userMessage(20, '첫 질문'),
        questionMessage(21, 'chat-21-call_1', {
          answer: {
            name: 'submit',
            context: { selected: ['cart'], browser: 'webkit', memo: '' },
            summary: '다시 실행: 장바구니에 담을 수 있다',
            answeredAt: '2026-11-01T09:01:00Z',
          },
        }),
        userMessage(22, '다시 실행: 장바구니에 담을 수 있다'),
        questionMessage(23, 'chat-23-call_1'),
        userMessage(24, '그냥 다른 얘기'),
        {
          id: 25,
          role: 'assistant',
          createdAt: '2026-11-01T09:03:00Z',
          stopReason: 'END',
          blocks: [{ type: 'text', text: '네, 알겠습니다.' }],
        },
      ]);

      const [answered, past] = await screen.findAllByRole('region', { name: `질문: ${QUESTION}` });
      expect(within(answered).getByText('다시 실행: 장바구니에 담을 수 있다')).toBeTruthy();
      const answeredCart = within(answered).getByRole('checkbox', { name: /장바구니/ }) as HTMLInputElement;
      const answeredLogin = within(answered).getByRole('checkbox', { name: /로그인/ }) as HTMLInputElement;
      expect(answeredCart.checked).toBe(true);
      expect(answeredLogin.checked).toBe(false);
      expect(isLocked(answeredCart)).toBe(true);

      expect(within(past).getByText('지나간 질문이에요')).toBeTruthy();
      expect(isLocked(within(past).getByRole('button', { name: '다시 실행' }))).toBe(true);
      expect(mockedChat.streamMessage).not.toHaveBeenCalled();
    });

    it('서버가 400 으로 거절하면 말풍선과 잠금을 되돌리고 질문 카드에 이유를 보인다', async () => {
      mockedChat.streamMessage.mockRejectedValueOnce(
        Object.assign(new Error('이미 답한 질문이에요.'), { status: 400 })
      );
      await openChat([userMessage(20, '실패한 거 다시 돌려줘'), questionMessage(21, 'chat-21-call_1')]);

      const card = await screen.findByRole('region', { name: `질문: ${QUESTION}` });
      fireEvent.click(within(card).getByRole('button', { name: '그만두기' }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('이미 답한 질문이에요.');
      expect(screen.queryByText('그만두기', { selector: '.whitespace-pre-wrap' })).toBeNull();
      const again = screen.getByRole('region', { name: `질문: ${QUESTION}` });
      expect(within(again).queryByText(/보낸 답:/)).toBeNull();
      expect(isLocked(within(again).getByRole('button', { name: '다시 실행' }))).toBe(false);
      // 서버에 저장된 대화로 덮어쓰지 않는다 (처음 불러온 1번뿐)
      expect(mockedChat.getSession).toHaveBeenCalledTimes(1);
    });

    it('렌더러가 질문 화면을 거부하면 카드 자리에 안내 한 줄만 보이고 대화는 그대로다', async () => {
      await openChat([
        userMessage(20, '실패한 거 다시 돌려줘'),
        questionMessage(21, 'chat-21-call_1', {
          extraComponents: [{ id: 'weird', component: 'Video', url: 'x' }],
        }),
      ]);

      expect(await screen.findByText('질문 화면을 보여 주지 못했어요.')).toBeTruthy();
      expect(screen.queryByRole('region', { name: `질문: ${QUESTION}` })).toBeNull();
      expect(screen.getByText('어떤 테스트를 다시 돌릴까요?')).toBeTruthy();
      expect(screen.getByPlaceholderText('무엇이든 물어보세요 (Shift+Enter 로 줄바꿈)')).toBeTruthy();
    });
  });
});
