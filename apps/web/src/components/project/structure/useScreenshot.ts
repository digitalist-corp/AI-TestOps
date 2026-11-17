import { useEffect, useState } from 'react';
import { api } from '@/api/client';

// ponytail: 화면 캡처 object URL 을 페이지가 살아 있는 동안 계속 들고 있다. 화면 수가 수백 개가 되면 LRU 로 바꾼다.
const cache = new Map<string, Promise<string | null>>();

/** 테스트용: 캐시를 비운다 */
export function clearScreenshotCache() {
  cache.clear();
}

/**
 * 화면 캡처를 object URL 로 돌려준다. 인증 헤더가 필요해 img src 에 주소를 바로 걸 수 없어서 받아 둔다.
 * 같은 화면은 한 번만 받고, 실패하면 null(썸네일 없이 그린다).
 */
export function useScreenshot(projectId: string, routeKey: string, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const key = `${projectId}\n${routeKey}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = api
        .fetchSiteMapScreenshot(projectId, routeKey)
        .then((blob) => URL.createObjectURL(blob))
        .catch(() => null);
      cache.set(key, pending);
    }
    let alive = true;
    pending.then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [projectId, routeKey, enabled]);

  return enabled ? url : null;
}
