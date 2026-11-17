import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/api/client';
import { clearScreenshotCache, useScreenshot } from './useScreenshot';

vi.mock('@/api/client', () => ({ api: { fetchSiteMapScreenshot: vi.fn() } }));

beforeEach(() => {
  // jsdom 에는 URL.createObjectURL 이 없다
  URL.createObjectURL = vi.fn(() => 'blob:mock');
});

afterEach(() => {
  clearScreenshotCache();
  vi.clearAllMocks();
});

describe('useScreenshot', () => {
  it('fetchesEachScreenshotOnce', async () => {
    vi.mocked(api.fetchSiteMapScreenshot).mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
    const a = renderHook(() => useScreenshot('p1', '/login', true));
    const b = renderHook(() => useScreenshot('p1', '/login', true));
    await waitFor(() => expect(a.result.current).toMatch(/^blob:/));
    await waitFor(() => expect(b.result.current).toBe(a.result.current));
    expect(api.fetchSiteMapScreenshot).toHaveBeenCalledTimes(1);
  });

  it('hidesThumbnailWhenFetchFails', async () => {
    vi.mocked(api.fetchSiteMapScreenshot).mockRejectedValue(new Error('404'));
    const { result } = renderHook(() => useScreenshot('p1', '/home', true));
    await waitFor(() => expect(api.fetchSiteMapScreenshot).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('스크린샷이 없는 화면은 요청하지 않는다', () => {
    renderHook(() => useScreenshot('p1', '/none', false));
    expect(api.fetchSiteMapScreenshot).not.toHaveBeenCalled();
  });
});
