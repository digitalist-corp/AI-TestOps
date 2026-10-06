import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import type { AiChatMessage, AiModelProvider, UserLevel } from '@/types';

/** 서버가 보관하는 히스토리 상한과 동일하게 맞춘다. */
const MAX_HISTORY = 20;

export interface UseAiChatOptions {
  executionId?: number;
  /** 지금 보고 있는 프로젝트 — 서버가 이 프로젝트의 최근 실패 로그를 함께 읽는다 */
  projectId?: string;
  userLevel: UserLevel;
  provider?: AiModelProvider;
  /** 지정하면 대화 내용을 localStorage에 보존한다. */
  storageKey?: string;
}

export interface UseAiChatResult {
  messages: AiChatMessage[];
  loading: boolean;
  send: (question: string) => Promise<void>;
  clear: () => void;
}

function isChatMessage(value: unknown): value is AiChatMessage {
  if (!value || typeof value !== 'object') return false;
  const msg = value as Record<string, unknown>;
  return (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string';
}

function readStoredMessages(storageKey?: string): AiChatMessage[] {
  if (!storageKey) return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 손상된 항목은 걸러내고 정상 메시지만 복원한다.
    return parsed.filter(isChatMessage);
  } catch {
    return [];
  }
}

export function useAiChat(opts: UseAiChatOptions): UseAiChatResult {
  const { storageKey } = opts;
  const [messages, setMessages] = useState<AiChatMessage[]>(() => readStoredMessages(storageKey));
  const [loading, setLoading] = useState(false);

  // send가 항상 최신 executionId/userLevel/provider를 쓰도록 ref로 유지한다.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // 히스토리를 동기적으로 읽어야 하므로 state와 별개로 ref에도 최신 목록을 들고 있는다.
  const messagesRef = useRef<AiChatMessage[]>(messages);

  const applyMessages = useCallback((updater: (prev: AiChatMessage[]) => AiChatMessage[]) => {
    const next = updater(messagesRef.current);
    messagesRef.current = next;
    setMessages(next);
  }, []);

  // storageKey가 바뀌면 해당 키의 대화로 다시 하이드레이트한다.
  const hydratedKeyRef = useRef(storageKey);
  useEffect(() => {
    if (hydratedKeyRef.current === storageKey) return;
    hydratedKeyRef.current = storageKey;
    applyMessages(() => readStoredMessages(storageKey));
  }, [storageKey, applyMessages]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      // 저장 실패(용량 초과/프라이빗 모드 등)는 기능에 영향이 없으므로 무시한다.
    }
  }, [storageKey, messages]);

  const send = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q) return;

      const { executionId, projectId, userLevel, provider } = optsRef.current;

      // 이번 질문 직전까지의 대화를 히스토리로 보낸다(오래된 순, 최대 20개).
      // 작업 카드는 화면에만 쓰고 서버 히스토리에는 보내지 않는다 — 서버가 이미 자기 기록을 갖고 있다.
      const history = messagesRef.current
        .filter((m) => !m.error)
        .slice(-MAX_HISTORY)
        .map(({ role, content }) => ({ role, content }));
      applyMessages((prev) => [...prev, { role: 'user', content: q }]);

      setLoading(true);
      try {
        const res = await api.ai.chat({ executionId, projectId, question: q, userLevel, provider, history });
        applyMessages((prev) => [
          ...prev,
          { role: 'assistant', content: res.answer, actions: res.actions ?? [] },
        ]);
      } catch (err) {
        applyMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `답변 생성 중 오류: ${err instanceof Error ? err.message : String(err)}`,
            error: true,
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [applyMessages]
  );

  const clear = useCallback(() => applyMessages(() => []), [applyMessages]);

  return { messages, loading, send, clear };
}
