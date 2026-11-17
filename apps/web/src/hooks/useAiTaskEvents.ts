import { useEffect, useRef } from 'react';
import { getStoredAuth } from '@/api/client';
import { readSseStream } from '@/lib/sseParser';
import type { AiJobStatus } from '@/types';

/** ready: 연결됨(놓친 것이 있을 수 있으니 다시 읽을 때). job: 작업 하나가 생기거나 바뀜. */
export type AiTaskEvent =
  | { type: 'ready' }
  | { type: 'job'; id: number; projectId: string; status: AiJobStatus };

type Listener = (event: AiTaskEvent) => void;

const MAX_RETRY_MS = 15000;
/** 서버는 20초마다 ping 을 보낸다. 이만큼 아무것도 안 오면 연결이 죽은 것으로 본다. */
export const SILENCE_LIMIT_MS = 45000;
const listeners = new Set<Listener>();
let connection: AbortController | null = null;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * 서버가 재시작하거나 연결이 끊기면 1초부터 15초까지 늘려 가며 다시 붙는다.
 * 개발 서버(Vite) 프록시 뒤에서는 API 가 죽어도 브라우저 쪽 연결이 열린 채 남는다. 그래서 끊김을 기다리지 않고
 * ping 이 SILENCE_LIMIT_MS 동안 안 오면 직접 끊는다.
 */
async function keepConnected(signal: AbortSignal) {
  let retryMs = 1000;
  while (!signal.aborted) {
    const attempt = new AbortController();
    const stop = () => attempt.abort();
    signal.addEventListener('abort', stop);
    let silence: ReturnType<typeof setTimeout> | undefined;
    const heardFromServer = () => {
      clearTimeout(silence);
      silence = setTimeout(stop, SILENCE_LIMIT_MS);
    };
    try {
      const headers = new Headers({ Accept: 'text/event-stream' });
      const token = getStoredAuth()?.token;
      if (token) headers.set('Authorization', `Bearer ${token}`);
      heardFromServer();
      const res = await fetch('/api/ai-tasks/stream', { headers, signal: attempt.signal });
      // 로그인이 풀렸으면 멈춘다. 로그인 화면 이동은 다른 API 호출이 맡는다.
      if (res.status === 401) return;
      if (res.ok && res.body) {
        const watched = res.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              heardFromServer();
              controller.enqueue(chunk);
            },
          }),
          // 끊을 때 기다리던 read 까지 바로 풀리게 한다.
          { signal: attempt.signal }
        );
        await readSseStream(
          watched,
          (raw) => {
            if (raw.event !== 'ready' && raw.event !== 'job') return;
            try {
              const event = { type: raw.event, ...JSON.parse(raw.data) } as AiTaskEvent;
              if (event.type === 'ready') retryMs = 1000;
              listeners.forEach((listener) => listener(event));
            } catch {
              // 깨진 이벤트는 건너뛴다.
            }
          },
          attempt.signal
        );
      }
    } catch {
      // 끊김 · 서버 재시작 · 무응답. 아래에서 기다렸다가 다시 붙는다.
    } finally {
      clearTimeout(silence);
      signal.removeEventListener('abort', stop);
    }
    await wait(retryMs, signal);
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
  }
}

/**
 * AI 작업 변경을 실시간으로 받는다. (D-02)
 * 여러 화면이 써도 서버 연결은 하나만 둔다. 마지막 사용처가 사라지면 끊는다.
 */
export function useAiTaskEvents(listener: Listener) {
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });

  useEffect(() => {
    const forward: Listener = (event) => latest.current(event);
    listeners.add(forward);
    if (!connection) {
      connection = new AbortController();
      void keepConnected(connection.signal);
    }
    return () => {
      listeners.delete(forward);
      if (listeners.size === 0 && connection) {
        connection.abort();
        connection = null;
      }
    };
  }, []);
}
