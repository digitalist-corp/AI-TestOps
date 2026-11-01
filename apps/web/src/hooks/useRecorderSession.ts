import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type RecorderApi } from '@/api/client';
import { hasScreen, needsPolling } from '@/lib/recorder';
import type {
  RecordedStep,
  RecorderAction,
  RecorderInspected,
  RecorderStartRequest,
  RecorderState,
} from '@/types';

const POLL_INTERVAL_MS = 1000;
const SESSION_GONE = '녹화가 끝났어요. 오래 쓰지 않으면 자동으로 닫혀요. 새로 시작해 주세요.';

/** 동작이 진행 중인 종류. 스크롤은 화면을 어둡게 하지 않는다. */
export type RecorderBusy = 'action' | 'scroll' | null;

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * 녹화 세션 하나의 수명을 맡는다: 시작 → 준비될 때까지 확인 → 동작 보내기 → 화면 받기 → 끝내기.
 * 화면(RecorderTab)은 여기서 받은 상태만 그리고, 서버 호출 순서와 겹침 방지는 모두 여기서 처리한다.
 */
export function useRecorderSession(projectId: string, rec: RecorderApi) {
  const [state, setState] = useState<RecorderState | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<RecorderBusy>(null);
  const [savingSteps, setSavingSteps] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [inspected, setInspected] = useState<RecorderInspected | null>(null);

  // 동기로 읽어야 하는 값들. state 는 다음 렌더에야 바뀌어서 겹침 방지에는 ref 를 쓴다.
  const sessionIdRef = useRef<string | null>(null);
  const projectIdRef = useRef(projectId);
  const lockRef = useRef(false);
  const inspectSeqRef = useRef(0);
  const urlRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  const lastStartRef = useRef<RecorderStartRequest>({});
  projectIdRef.current = projectId;

  const sessionId = state?.sessionId ?? null;
  const status = state?.status ?? null;
  const screenshotVersion = state?.screenshotVersion ?? 0;
  const canShowScreen = status != null && hasScreen(status);

  /** 세션이 서버에서 사라졌을 때(404) 화면을 "끝남" 상태로 바꾼다. */
  const markGone = useCallback(() => {
    setState((prev) => (prev ? { ...prev, status: 'CLOSED', error: SESSION_GONE } : prev));
  }, []);

  const fail = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof ApiError && err.status === 404) {
        markGone();
        return;
      }
      setError(messageOf(err, fallback));
    },
    [markGone]
  );

  const setScreenshot = useCallback((url: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    setScreenshotUrl(url);
  }, []);

  // 화면을 떠날 때(탭 이동 · 새로고침 · 창 닫기) 세션을 끝낸다.
  useEffect(() => {
    aliveRef.current = true;
    const closeNow = () => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      sessionIdRef.current = null;
      rec.closeOnLeave(projectIdRef.current, sid);
    };
    window.addEventListener('beforeunload', closeNow);
    return () => {
      aliveRef.current = false;
      window.removeEventListener('beforeunload', closeNow);
      closeNow();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [rec]);

  // 준비 중(STARTING)이거나 서버가 동작 중(BUSY)으로 알려 주면 잠깐씩 다시 물어본다.
  // 우리가 직접 보낸 동작이 진행 중일 때는 그 응답이 곧 오므로 묻지 않는다.
  useEffect(() => {
    if (!sessionId || !status || !needsPolling(status) || busy) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const next = await rec.get(projectIdRef.current, sessionId);
        if (!cancelled && sessionIdRef.current === sessionId) setState(next);
      } catch (err) {
        if (!cancelled) fail(err, '녹화 상태를 확인하지 못했어요.');
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [rec, sessionId, status, busy, fail]);

  // 화면이 바뀌었다고(screenshotVersion) 알려 올 때마다 스크린샷을 다시 받는다.
  // 새 그림이 올 때까지는 이전 그림을 그대로 보여 줘서 깜빡이지 않게 한다.
  useEffect(() => {
    if (!sessionId || !canShowScreen) return;
    let cancelled = false;
    rec
      .screenshot(projectIdRef.current, sessionId)
      .then((blob) => {
        if (!cancelled) setScreenshot(URL.createObjectURL(blob));
      })
      .catch((err) => {
        if (!cancelled) fail(err, '화면을 불러오지 못했어요.');
      });
    return () => {
      cancelled = true;
    };
  }, [rec, sessionId, canShowScreen, screenshotVersion, fail, setScreenshot]);

  const start = useCallback(
    async (request: RecorderStartRequest) => {
      lastStartRef.current = request;
      setStarting(true);
      setError('');
      try {
        const next = await rec.start(projectIdRef.current, request);
        if (!aliveRef.current) {
          // 시작을 기다리는 사이 화면을 떠났다면 방금 만든 세션은 바로 끝낸다.
          rec.closeOnLeave(projectIdRef.current, next.sessionId);
          return;
        }
        sessionIdRef.current = next.sessionId;
        setState(next);
      } catch (err) {
        setError(messageOf(err, '녹화를 시작하지 못했어요.'));
      } finally {
        if (aliveRef.current) setStarting(false);
      }
    },
    [rec]
  );

  /** 지금 세션을 끝내고 처음 화면으로 돌아간다. 서버가 이미 닫았어도 조용히 넘어간다. */
  const close = useCallback(async () => {
    const sid = sessionIdRef.current;
    sessionIdRef.current = null;
    inspectSeqRef.current += 1;
    setState(null);
    setScreenshot(null);
    setInspected(null);
    setError('');
    setBusy(null);
    if (sid) {
      try {
        await rec.close(projectIdRef.current, sid);
      } catch {
        // 이미 끝났거나 못 닫아도 서버가 10분 뒤 스스로 멈춘다
      }
    }
  }, [rec, setScreenshot]);

  /** 오류 · 끝남 상태에서 같은 설정으로 새 세션을 연다. */
  const retry = useCallback(async () => {
    await close();
    await start(lastStartRef.current);
  }, [close, start]);

  /**
   * 동작 하나를 보낸다. 다른 동작이 진행 중이면 무시한다(중복 클릭 막기).
   * 보냈으면 true, 무시했거나 실패했으면 false.
   */
  const send = useCallback(
    async (action: RecorderAction): Promise<boolean> => {
      const sid = sessionIdRef.current;
      if (!sid || lockRef.current) return false;
      lockRef.current = true;
      inspectSeqRef.current += 1; // 이전에 보낸 마우스 오버 조회 결과는 버린다
      setBusy(action.type === 'scroll' ? 'scroll' : 'action');
      setError('');
      setInspected(null);
      try {
        const next = await rec.act(projectIdRef.current, sid, action);
        if (sessionIdRef.current === sid) setState(next);
        return true;
      } catch (err) {
        fail(err, '동작을 처리하지 못했어요.');
        return false;
      } finally {
        lockRef.current = false;
        if (aliveRef.current) setBusy(null);
      }
    },
    [rec, fail]
  );

  /**
   * 그 위치 요소를 조회한다(기록하지 않음). 동작이 진행 중이면 건너뛰고,
   * 응답이 오기 전에 새 동작이 시작됐다면 결과를 버린다.
   */
  const inspect = useCallback(
    async (x: number, y: number) => {
      const sid = sessionIdRef.current;
      if (!sid || lockRef.current) return;
      const seq = ++inspectSeqRef.current;
      try {
        const next = await rec.act(projectIdRef.current, sid, { type: 'inspect', x, y });
        if (seq === inspectSeqRef.current && !lockRef.current && aliveRef.current) {
          setInspected(next.inspected ?? null);
        }
      } catch {
        // 마우스 오버 조회는 실패해도 조용히 넘어간다
      }
    },
    [rec]
  );

  /** 마우스가 그림을 벗어났을 때: 진행 중 조회를 무효로 하고 테두리를 지운다. */
  const clearInspected = useCallback(() => {
    inspectSeqRef.current += 1;
    setInspected(null);
  }, []);

  /** 단계 목록(삭제 · 순서 · 설명 수정)을 서버에 반영한다. */
  const saveSteps = useCallback(
    async (steps: RecordedStep[]): Promise<boolean> => {
      const sid = sessionIdRef.current;
      if (!sid || lockRef.current) return false;
      lockRef.current = true;
      setSavingSteps(true);
      setError('');
      try {
        const next = await rec.putSteps(projectIdRef.current, sid, steps);
        if (sessionIdRef.current === sid) setState(next);
        return true;
      } catch (err) {
        fail(err, '단계를 저장하지 못했어요.');
        return false;
      } finally {
        lockRef.current = false;
        if (aliveRef.current) setSavingSteps(false);
      }
    },
    [rec, fail]
  );

  return {
    state,
    starting,
    error,
    busy,
    savingSteps,
    screenshotUrl,
    inspected,
    clearError: () => setError(''),
    start,
    retry,
    close,
    send,
    inspect,
    clearInspected,
    saveSteps,
    /** 동작 · 단계 저장이 진행 중인지 (겹쳐 보내지 못하게 화면을 막을 때) */
    isLocked: busy != null || savingSteps,
  };
}
