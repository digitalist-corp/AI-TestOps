import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { RunningAnalysis } from '@/types';

const POLL_INTERVAL_MS = 3000;

/** 지금 돌고 있는 구조 분석을 프로젝트 id 로 찾을 수 있게 내준다. 프로젝트 카드와 상단의 진행 배지가 쓴다. */
export function useRunningAnalyses(): Record<string, RunningAnalysis> {
  const [running, setRunning] = useState<Record<string, RunningAnalysis>>({});

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .getRunningAnalyses()
        .then((list) => {
          if (!cancelled) setRunning(Object.fromEntries(list.map((item) => [item.projectId, item])));
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return running;
}
