import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { SILENCE_LIMIT_MS, useAiTaskEvents } from './useAiTaskEvents';

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
