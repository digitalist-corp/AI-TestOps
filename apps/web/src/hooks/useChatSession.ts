import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { api } from '@/api/client';
import { reduceChatMessages } from '@/lib/chatReducer';
import type {
  ChatMessage,
  ChatSession,
  PermissionDecision,
  UserLevel,
} from '@/types';

export interface UseChatSessionOptions {
  projectId?: string;
  userLevel: UserLevel;
}

export interface UseChatSessionResult {
  sessions: ChatSession[];
  currentSessionId: number | null;
  currentSession: ChatSession | null;
  messages: ChatMessage[];
  streaming: boolean;
  loadingSession: boolean;
  error: string | null;
  selectSession: (sessionId: number) => Promise<void>;
  startNewSession: () => void;
  deleteSession: (sessionId: number) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  cancel: () => Promise<void>;
  respondPermission: (requestId: string, decision: PermissionDecision) => Promise<void>;
}

/**
 * AI 채팅 에이전트 세션 · 메시지 · 실시간 스트리밍 훅.
 *
 * - 프로젝트가 바뀌면 해당 프로젝트의 가장 최근 세션을 자동으로 연다.
 * - 세션이 없으면 빈 대화 상태로 두었다가 첫 메시지를 보낼 때 세션을 만든다.
 * - 스트림이 도중에 끊기면 getSession 으로 서버에 저장된 메시지를 다시 읽어 복구한다.
 */
export function useChatSession({
  projectId,
  userLevel,
}: UseChatSessionOptions): UseChatSessionResult {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [messages, dispatch] = useReducer(reduceChatMessages, []);
  const [streaming, setStreaming] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionsRef = useRef<ChatSession[]>(sessions);
  sessionsRef.current = sessions;

  const currentSessionIdRef = useRef<number | null>(currentSessionId);
  currentSessionIdRef.current = currentSessionId;

  const projectIdRef = useRef<string | undefined>(projectId);
  projectIdRef.current = projectId;

  const userLevelRef = useRef<UserLevel>(userLevel);
  userLevelRef.current = userLevel;

  const streamingRef = useRef(false);
  const cancelledByUserRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const abortCurrentStream = useCallback(() => {
    if (abortRef.current) {
      cancelledByUserRef.current = true;
      abortRef.current.abort();
      abortRef.current = null;
    }
    streamingRef.current = false;
    setStreaming(false);
  }, []);

  // 프로젝트가 바뀌면 그 프로젝트의 최근 세션을 연다.
  useEffect(() => {
    abortCurrentStream();
    let ignore = false;

    const loadRecentForProject = async () => {
      setLoadingSession(true);
      setError(null);
      try {
        const list = await api.chat.listSessions(projectId);
        if (ignore) return;
        setSessions(list);

        if (list.length > 0) {
          const latest = list[0];
          setCurrentSessionId(latest.id);
          currentSessionIdRef.current = latest.id;
          const detail = await api.chat.getSession(latest.id);
          if (ignore) return;
          dispatch({ type: 'set_messages', messages: detail.messages });
        } else {
          setCurrentSessionId(null);
          currentSessionIdRef.current = null;
          dispatch({ type: 'set_messages', messages: [] });
        }
      } catch {
        if (ignore) return;
        setSessions([]);
        setCurrentSessionId(null);
        currentSessionIdRef.current = null;
        dispatch({ type: 'set_messages', messages: [] });
      } finally {
        if (!ignore) setLoadingSession(false);
      }
    };

    void loadRecentForProject();
    return () => {
      ignore = true;
    };
  }, [projectId, abortCurrentStream]);

  // 언마운트 시 진행 중인 스트림을 정리한다.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const selectSession = useCallback(
    async (sessionId: number) => {
      if (sessionId === currentSessionIdRef.current && !streamingRef.current) return;
      abortCurrentStream();
      setCurrentSessionId(sessionId);
      currentSessionIdRef.current = sessionId;
      setLoadingSession(true);
      setError(null);
      try {
        const detail = await api.chat.getSession(sessionId);
        setSessions((prev) =>
          prev.map((s) => (s.id === detail.session.id ? detail.session : s))
        );
        dispatch({ type: 'set_messages', messages: detail.messages });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingSession(false);
      }
    },
    [abortCurrentStream]
  );

  const startNewSession = useCallback(() => {
    abortCurrentStream();
    setCurrentSessionId(null);
    currentSessionIdRef.current = null;
    setError(null);
    dispatch({ type: 'set_messages', messages: [] });
  }, [abortCurrentStream]);

  const deleteSession = useCallback(
    async (sessionId: number) => {
      if (sessionId === currentSessionIdRef.current && streamingRef.current) {
        abortCurrentStream();
      }
      setError(null);
      try {
        await api.chat.deleteSession(sessionId);
        const remaining = sessionsRef.current.filter((s) => s.id !== sessionId);
        setSessions(remaining);

        if (currentSessionIdRef.current === sessionId) {
          if (remaining.length > 0) {
            const nextSession = remaining[0];
            setCurrentSessionId(nextSession.id);
            currentSessionIdRef.current = nextSession.id;
            const detail = await api.chat.getSession(nextSession.id);
            dispatch({ type: 'set_messages', messages: detail.messages });
          } else {
            setCurrentSessionId(null);
            currentSessionIdRef.current = null;
            dispatch({ type: 'set_messages', messages: [] });
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [abortCurrentStream]
  );

  const sendMessage = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || streamingRef.current) return;

    setError(null);
    setStreaming(true);
    streamingRef.current = true;
    cancelledByUserRef.current = false;

    let sessionId = currentSessionIdRef.current;

    try {
      if (sessionId === null) {
        const created = await api.chat.createSession(projectIdRef.current);
        sessionId = created.id;
        const titledSession: ChatSession = {
          ...created,
          title: created.title || trimmed.slice(0, 40),
        };
        setCurrentSessionId(sessionId);
        currentSessionIdRef.current = sessionId;
        setSessions((prev) => [titledSession, ...prev.filter((s) => s.id !== sessionId)]);
      } else {
        const activeId = sessionId;
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeId
              ? {
                  ...s,
                  title: s.title || trimmed.slice(0, 40),
                  updatedAt: new Date().toISOString(),
                }
              : s
          )
        );
      }

      dispatch({ type: 'start_turn', userText: trimmed });

      const controller = new AbortController();
      abortRef.current = controller;
      let receivedMessageEnd = false;

      await api.chat.streamMessage(
        sessionId,
        { content: trimmed, userLevel: userLevelRef.current },
        (event) => {
          if (event.type === 'message_end') {
            receivedMessageEnd = true;
          }
          dispatch({ type: 'stream_event', event });
        },
        controller.signal
      );

      // message_end 없이 스트림이 닫혔다면 서버에 저장된 상태를 다시 읽어 맞춘다.
      if (!receivedMessageEnd && !cancelledByUserRef.current) {
        try {
          const detail = await api.chat.getSession(sessionId);
          setSessions((prev) =>
            prev.map((s) => (s.id === detail.session.id ? detail.session : s))
          );
          if (detail.messages.length > 0) {
            dispatch({ type: 'set_messages', messages: detail.messages });
          }
        } catch {
          // 복구 조회가 실패해도 화면에 누적된 스트림 내용은 유지한다.
        }
      }
    } catch (err) {
      if (cancelledByUserRef.current) {
        dispatch({ type: 'cancel_turn' });
      } else if (sessionId !== null) {
        // 스트림이 도중에 끊기면 getSession 으로 다시 읽어 저장된 결과를 보여준다.
        const errMsg = err instanceof Error ? err.message : String(err);
        try {
          const detail = await api.chat.getSession(sessionId);
          setSessions((prev) =>
            prev.map((s) => (s.id === detail.session.id ? detail.session : s))
          );
          if (detail.messages.length > 0) {
            dispatch({ type: 'set_messages', messages: detail.messages });
          } else {
            dispatch({ type: 'fail_turn', errorMessage: errMsg });
          }
        } catch {
          dispatch({ type: 'fail_turn', errorMessage: errMsg });
        }
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      abortRef.current = null;
      streamingRef.current = false;
      setStreaming(false);
    }
  }, []);

  const cancel = useCallback(async () => {
    const activeSessionId = currentSessionIdRef.current;
    cancelledByUserRef.current = true;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    dispatch({ type: 'cancel_turn' });
    streamingRef.current = false;
    setStreaming(false);

    if (activeSessionId !== null) {
      try {
        await api.chat.cancel(activeSessionId);
      } catch {
        // 이미 끝난 스트림의 취소 실패는 무시한다.
      }
    }
  }, []);

  const respondPermission = useCallback(
    async (requestId: string, decision: PermissionDecision) => {
      const activeSessionId = currentSessionIdRef.current;
      if (activeSessionId === null) return;
      dispatch({ type: 'resolve_permission', requestId, decision });
      try {
        await api.chat.respondPermission(activeSessionId, requestId, decision);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    []
  );

  const currentSession =
    sessions.find((s) => s.id === currentSessionId) ?? null;

  return {
    sessions,
    currentSessionId,
    currentSession,
    messages,
    streaming,
    loadingSession,
    error,
    selectSession,
    startNewSession,
    deleteSession,
    sendMessage,
    cancel,
    respondPermission,
  };
}
