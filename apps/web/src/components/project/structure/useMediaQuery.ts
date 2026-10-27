import { useCallback, useSyncExternalStore } from 'react';

/** 구조 탭은 이 너비부터 그래프 보기를 기본으로 연다. */
export const GRAPH_MEDIA_QUERY = '(min-width: 1024px)';

export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}
