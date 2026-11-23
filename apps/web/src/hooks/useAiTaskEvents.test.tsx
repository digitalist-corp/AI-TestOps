import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { SILENCE_LIMIT_MS, notifyAiJobChanged, useAiTaskEvents } from './useAiTaskEvents';

vi.mock('@/api/client', () => ({ getStoredAuth: () => ({ token: 'tok' }) }));

function sseResponse(text: string) {
  return new Response(text, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useAiTaskEvents', () => {
  it('연결이 끊기면 다시 붙고, 붙을 때마다 ready 를 받는다', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('서버 재시작'))
      .mockResolvedValueOnce(sseResponse('event: ready\ndata: {}\n\nevent: job\ndata: {"id":3,"projectId":"p1","status":"PROPOSED"}\n\n'))
      .mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const seen: unknown[] = [];

    renderHook(() => useAiTaskEvents((e) => seen.push(e)));

    await waitFor(() => expect(seen).toEqual([
      { type: 'ready' },
      { type: 'job', id: 3, projectId: 'p1', status: 'PROPOSED' },
    ]), { timeout: 3000 });
    expect(fetchMock.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer tok');
  });

  it('SSE 가 오지 않는 연결(배포 주소의 빠른 터널)에서도 주기적으로 ready 를 흘려 화면이 다시 읽는다', async () => {
    vi.useFakeTimers();
    try {
      // 터널이 SSE 를 전달하지 않는다: 응답 본문이 영원히 오지 않는다.
      vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start() {} }), { status: 200 })));
      const seen: unknown[] = [];

      renderHook(() => useAiTaskEvents((e) => seen.push(e)));
      await vi.advanceTimersByTimeAsync(10_000);

      expect(seen.filter((e) => (e as { type: string }).type === 'ready').length).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('SSE 가 붙어 있으면 따로 ready 를 흘리지 않는다', async () => {
    vi.useFakeTimers();
    try {
      // ready 를 받은 뒤 연결이 열린 채 이어진다.
      const live = () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('event: ready\ndata: {}\n\n'));
            },
          }),
          { status: 200 }
        );
      vi.stubGlobal('fetch', vi.fn(async () => live()));
      const seen: unknown[] = [];

      renderHook(() => useAiTaskEvents((e) => seen.push(e)));
      await vi.advanceTimersByTimeAsync(20_000);

      expect(seen).toEqual([{ type: 'ready' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('이전 연결이 늦게 끝나도 새 연결의 SSE 상태를 건드리지 않는다', async () => {
    vi.useFakeTimers();
    try {
      const live = () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('event: ready\ndata: {}\n\n'));
            },
          }),
          { status: 200 }
        );
      const fetchMock = vi
        .fn()
        // 첫 연결: 끊어도(abort) 3초 뒤에야 끝난다.
        .mockImplementationOnce(() => new Promise((_, reject) => setTimeout(() => reject(new TypeError('늦은 끝')), 3000)))
        .mockImplementation(async () => live());
      vi.stubGlobal('fetch', fetchMock);

      const first = renderHook(() => useAiTaskEvents(() => {}));
      first.unmount();
      const seen: unknown[] = [];
      renderHook(() => useAiTaskEvents((e) => seen.push(e)));
      await vi.advanceTimersByTimeAsync(20_000);

      expect(seen).toEqual([{ type: 'ready' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('로그인이 풀려(401) 멈추면 보완 조회도 멈춘다', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
      const seen: unknown[] = [];

      renderHook(() => useAiTaskEvents((e) => seen.push(e)));
      await vi.advanceTimersByTimeAsync(20_000);

      expect(seen).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('같은 탭에서 성공한 결정은 서버 알림을 기다리지 않고 바로 구독자에게 간다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const seen: unknown[] = [];
    renderHook(() => useAiTaskEvents((e) => seen.push(e)));

    notifyAiJobChanged({ id: 5, projectId: 'p1', status: 'APPLIED' });

    expect(seen).toEqual([{ type: 'job', id: 5, projectId: 'p1', status: 'APPLIED' }]);
  });

  it('연결이 열린 채 아무것도 오지 않으면(프록시 뒤에서 서버가 죽은 경우) 끊고 다시 붙는다', async () => {
    vi.useFakeTimers();
    try {
      // 첫 연결: 머리만 오고 본문은 영원히 오지 않는다.
      const silent = () => new Response(new ReadableStream({ start() {} }), { status: 200 });
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(async () => silent())
        .mockImplementation(async () => sseResponse('event: ready\ndata: {}\n\n'));
      vi.stubGlobal('fetch', fetchMock);
      const seen: unknown[] = [];

      renderHook(() => useAiTaskEvents((e) => seen.push(e)));
      await vi.advanceTimersByTimeAsync(SILENCE_LIMIT_MS + 1000 + 100);

      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(seen).toContainEqual({ type: 'ready' });
    } finally {
      vi.useRealTimers();
    }
  });
});
