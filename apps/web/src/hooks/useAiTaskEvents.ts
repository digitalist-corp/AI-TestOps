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
/**
 * SSE 가 안 붙어 있는 동안 이 간격으로 ready 를 흘려 화면이 다시 읽게 한다.
 * 배포 주소의 Cloudflare 빠른 터널(trycloudflare)은 SSE 를 전달하지 않아, 이것이 없으면 새로고침 전까지 화면이 멈춘다.
 * ponytail: 끊긴 동안은 보는 화면마다 5초 주기로 목록을 다시 읽는다. 이름 있는 터널로 옮기면 거의 돌지 않는다.
 */
const FALLBACK_POLL_MS = 5000;
const listeners = new Set<Listener>();
let connection: AbortController | null = null;

const emit = (event: AiTaskEvent) => listeners.forEach((listener) => listener(event));

/**
 * 같은 탭에서 성공한 승인 · 거부 · 진행 · 닫기를 서버 알림(SSE)이나 보완 조회를 기다리지 않고 바로 알린다.
 * 받는 쪽은 SSE 의 job 이벤트와 똑같이 다시 읽는다. 다른 탭 · 다른 사람의 변경은 SSE · 보완 조회가 맡는다.
 */
export function notifyAiJobChanged(job: { id: number; projectId: string; status: AiJobStatus }) {
  emit({ type: 'job', id: job.id, projectId: job.projectId, status: job.status });
}

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
  // 이 연결만의 상태. 늦게 끝난 이전 연결이 새 연결을 건드리지 않게 모듈이 아니라 여기 둔다.
  let live = false;
  const poll = setInterval(() => {
    if (!live) emit({ type: 'ready' });
  }, FALLBACK_POLL_MS);
  signal.addEventListener('abort', () => clearInterval(poll));
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
      if (res.status === 401) {
        clearInterval(poll);
        return;
      }
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
              if (event.type === 'ready') {
                retryMs = 1000;
                live = true;
              }
              emit(event);
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
      live = false;
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
