import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { AiPanel } from './AiPanel';
import type { ChatMessage, ChatSession, ChatStreamEvent } from '@/types';

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
});
