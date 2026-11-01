import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type RecorderApi } from '@/api/client';
import { hasScreen, pollIntervalMs, recorderErrorMessage } from '@/lib/recorder';
import type {
  RecordedStep,
  RecorderAction,
  RecorderInspected,
  RecorderStartRequest,
  RecorderState,
} from '@/types';

/** 동작이 실패했다는 안내(state.error)를 화면에 남겨 두는 시간 */
export const SOFT_ERROR_MS = 6000;

/** 동작이 진행 중인 종류. 스크롤은 화면을 어둡게 하지 않는다. */
export type RecorderBusy = 'action' | 'scroll' | null;

/**
 * 녹화 세션 하나의 수명을 맡는다: 시작 → 준비될 때까지 확인 → 동작 보내기 → 화면 받기 → 끝내기.
 * 화면(RecorderTab)은 여기서 받은 상태만 그리고, 서버 호출 순서와 겹침 방지는 모두 여기서 처리한다.
 *
 * 서버가 알려 주는 "끝남"은 두 가지로 나눠 다룬다.
 *  - CLOSED(RECORDER_CLOSED): 유휴 종료 등. 기록한 단계는 서버에 남아 있어 코드 보기 · 저장 · 단계 편집이 된다.
 *  - lost(404): 서버가 세션을 잊었다(끝난 지 오래됨 · 서버 재시작). 이제는 아무것도 못 한다.
 */
export function useRecorderSession(projectId: string, rec: RecorderApi) {
  const [state, setState] = useState<RecorderState | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<RecorderBusy>(null);
  const [savingSteps, setSavingSteps] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [inspected, setInspected] = useState<RecorderInspected | null>(null);
  const [lost, setLost] = useState(false);

  // 동기로 읽어야 하는 값들. state 는 다음 렌더에야 바뀌어서 겹침 방지에는 ref 를 쓴다.
  const sessionIdRef = useRef<string | null>(null);
  const projectIdRef = useRef(projectId);
  const lockRef = useRef(false);
  const inspectSeqRef = useRef(0);
  const urlRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  const lastStartRef = useRef<RecorderStartRequest>({});
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  projectIdRef.current = projectId;

  const sessionId = state?.sessionId ?? null;
  const status = state?.status ?? null;
  const screenshotVersion = state?.screenshotVersion ?? 0;
  const canShowScreen = status != null && hasScreen(status);

  /** 오류 안내를 바꾼다. autoHideMs 를 주면 그 시간 뒤에 (그 사이 바뀌지 않았다면) 지운다. */
  const showError = useCallback((message: string, autoHideMs?: number) => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = null;
    setError(message);
    if (message && autoHideMs) {
      errorTimerRef.current = setTimeout(() => {
        errorTimerRef.current = null;
        setError((prev) => (prev === message ? '' : prev));
      }, autoHideMs);
    }
  }, []);

  /** 서버가 세션을 잊었다(404): 화면을 "끝남"으로 바꾸고 더 이상 서버를 부르지 않게 한다. */
  const markLost = useCallback(() => {
    setLost(true);
    setState((prev) =>
      prev ? { ...prev, status: 'CLOSED', error: recorderErrorMessage({ code: 'RECORDER_SESSION_NOT_FOUND' }, '') } : prev
    );
  }, []);

  /**
   * 서버가 "끝났다"(409 RECORDER_CLOSED)고 했을 때: 서버에 남은 마지막 상태(단계 + 끝난 이유)를 받아 CLOSED 로 바꾼다.
   * 받지 못해도 지금 가진 단계를 그대로 둔 채 CLOSED 로 바꾼다.
   */
  const syncClosed = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const next = await rec.get(projectIdRef.current, sid);
      if (sessionIdRef.current !== sid) return;
      const finished = next.status === 'CLOSED' || next.status === 'ERROR';
      setState(finished ? next : { ...next, status: 'CLOSED' });
    } catch (err) {
      if (sessionIdRef.current !== sid) return;
      if (err instanceof ApiError && err.status === 404) markLost();
      else setState((prev) => (prev ? { ...prev, status: 'CLOSED' } : prev));
    }
  }, [rec, markLost]);

  const fail = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          markLost();
          return;
        }
        if (err.code === 'RECORDER_CLOSED') {
          void syncClosed();
          return;
        }
      }
      showError(recorderErrorMessage(err, fallback));
    },
    [markLost, syncClosed, showError]
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
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [rec]);

  // 서버에 상태를 다시 물어본다. 준비 중 · 동작 중에는 1초마다, 평소(READY)에는 10초마다(유휴 종료를 알아채려고).
  // 우리가 직접 보낸 동작 · 단계 저장이 진행 중일 때는 그 응답이 더 최신이라 묻지 않는다.
  useEffect(() => {
    if (!sessionId || !status || busy || savingSteps) return;
    const interval = pollIntervalMs(status);
    if (!interval) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const next = await rec.get(projectIdRef.current, sessionId);
        if (cancelled || sessionIdRef.current !== sessionId) return;
        // 평소에는 "끝났는지"만 본다. 그 밖의 상태는 우리가 보낸 동작의 응답이 더 최신이다.
        if (status === 'READY' && next.status === 'READY') return;
        setState(next);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) markLost();
        else if (status !== 'READY') showError(recorderErrorMessage(err, '녹화 상태를 확인하지 못했어요.'));
      }
    }, interval);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [rec, sessionId, status, busy, savingSteps, markLost, showError]);

  // 화면이 바뀌었다고(screenshotVersion) 알려 올 때마다 스크린샷을 다시 받는다.
  // 새 그림이 올 때까지는 이전 그림을 그대로 보여 줘서 깜빡이지 않게 한다.
  // 끝난 세션(CLOSED)에서는 받을 수 없으므로 마지막 그림을 그대로 둔다.
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
      showError('');
      setLost(false);
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
        showError(recorderErrorMessage(err, '녹화를 시작하지 못했어요.'));
      } finally {
        if (aliveRef.current) setStarting(false);
      }
    },
    [rec, showError]
  );

  /** 지금 세션을 끝내고 처음 화면으로 돌아간다. 서버가 이미 닫았어도 조용히 넘어간다. */
  const close = useCallback(async () => {
    const sid = sessionIdRef.current;
    sessionIdRef.current = null;
    inspectSeqRef.current += 1;
    setState(null);
    setScreenshot(null);
    setInspected(null);
    setLost(false);
    showError('');
    setBusy(null);
    if (sid) {
      try {
        await rec.close(projectIdRef.current, sid);
      } catch {
        // 이미 끝났거나 못 닫아도 서버가 10분 뒤 스스로 멈춘다
      }
    }
  }, [rec, setScreenshot, showError]);

  /** 오류 · 끝남 상태에서 같은 설정으로 새 세션을 연다. */
  const retry = useCallback(async () => {
    await close();
    await start(lastStartRef.current);
  }, [close, start]);

  /**
   * 동작 하나를 보낸다. 다른 동작이 진행 중이면 무시한다(중복 클릭 막기).
   * 서버에 보냈고 단계가 기록되는 등 성공했으면 true. 무시했거나 실패했으면 false.
   *
   * 서버는 동작이 실패해도(입력란이 아닌 곳에 입력 등) HTTP 200 으로 돌려주고 state.error 에 이유를 담는다.
   * 이때는 단계가 붙지 않으므로 그 이유를 화면에 잠깐 보여 준다.
   */
  const send = useCallback(
    async (action: RecorderAction): Promise<boolean> => {
      const sid = sessionIdRef.current;
      if (!sid || lockRef.current) return false;
      lockRef.current = true;
      inspectSeqRef.current += 1; // 이전에 보낸 마우스 오버 조회 결과는 버린다
      setBusy(action.type === 'scroll' ? 'scroll' : 'action');
      showError('');
      setInspected(null);
      try {
        const next = await rec.act(projectIdRef.current, sid, action);
        if (sessionIdRef.current !== sid) return false;
        setState(next);
        if (next.error && (next.status === 'READY' || next.status === 'BUSY')) {
          showError(next.error, SOFT_ERROR_MS);
          return false;
        }
        return true;
      } catch (err) {
        fail(err, '동작을 처리하지 못했어요.');
        return false;
      } finally {
        lockRef.current = false;
        if (aliveRef.current) setBusy(null);
      }
    },
    [rec, fail, showError]
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
        // 마우스 오버 조회는 실패해도 조용히 넘어간다 (끝남 · 사라짐은 다음 동작이나 상태 확인에서 알려 준다)
      }
    },
    [rec]
  );

  /** 마우스가 그림을 벗어났을 때: 진행 중 조회를 무효로 하고 테두리를 지운다. */
  const clearInspected = useCallback(() => {
    inspectSeqRef.current += 1;
    setInspected(null);
  }, []);

  /** 단계 목록(삭제 · 순서 · 설명 · 값 수정)을 서버에 반영한다. 끝난(CLOSED) 세션에서도 서버가 받아 준다. */
  const saveSteps = useCallback(
    async (steps: RecordedStep[]): Promise<boolean> => {
      const sid = sessionIdRef.current;
      if (!sid || lockRef.current) return false;
      lockRef.current = true;
      setSavingSteps(true);
      showError('');
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
    [rec, fail, showError]
  );

  return {
    state,
    starting,
    error,
    busy,
    savingSteps,
    screenshotUrl,
    inspected,
    lost,
    clearError: () => showError(''),
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
