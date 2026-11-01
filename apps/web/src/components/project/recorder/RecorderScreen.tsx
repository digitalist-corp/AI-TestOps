import { useEffect, useRef, useState } from 'react';
import { Globe, Loader2, RotateCcw } from 'lucide-react';
import type { RecorderAction, RecorderInspected, RecorderState } from '@/types';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import {
  boxContains,
  boxToPercent,
  looksLikePasswordField,
  normalizeGotoInput,
  normalizeWheelDelta,
  pointToPercent,
  toViewportPoint,
  type RecorderMode,
  type ViewportPoint,
} from '@/lib/recorder';
import type { RecorderBusy } from '@/hooks/useRecorderSession';

/** 마우스가 이만큼 멈춰 있으면 그 요소를 조회한다 (움직이는 동안은 부르지 않는다) */
const HOVER_DEBOUNCE_MS = 300;
/** 휠을 모아서 한 번에 보내는 간격 */
const WHEEL_FLUSH_MS = 150;

const SECRET_ENV_NOTE = '환경변수 LOGIN_PASSWORD 로 저장됩니다. 값은 테스트 코드에 남지 않아요.';

/**
 * 원격 브라우저 화면: 주소 표시줄 + 스크린샷.
 * 스크린샷은 줄어들어 보일 수 있어서, 누른 위치를 viewport 좌표로 환산해 서버에 보낸다.
 */
export function RecorderScreen({
  state,
  screenshotUrl,
  busy,
  locked,
  mode,
  inspected,
  onSend,
  onInspect,
  onClearInspected,
  onRestart,
}: {
  state: RecorderState;
  screenshotUrl: string | null;
  busy: RecorderBusy;
  /** 동작 · 단계 저장이 진행 중이라 새 동작을 받지 않는 상태 */
  locked: boolean;
  mode: RecorderMode;
  inspected: RecorderInspected | null;
  onSend: (action: RecorderAction) => Promise<boolean>;
  onInspect: (x: number, y: number) => void;
  onClearInspected: () => void;
  onRestart: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelAcc = useRef(0);

  const closed = state.status === 'CLOSED';
  const interactive = state.status === 'READY' && !locked;
  const showSpinner = busy === 'action' || state.status === 'BUSY';

  // 휠 · 타이머 콜백이 항상 최신 값을 보도록 ref 로 비춰 둔다.
  const latest = useRef({ locked, closed, onSend, viewportHeight: state.viewport.height });
  latest.current = { locked, closed, onSend, viewportHeight: state.viewport.height };

  // ── 입력 팝오버 ──
  const [fillAt, setFillAt] = useState<ViewportPoint | null>(null);
  const [fillValue, setFillValue] = useState('');

  // 모드를 바꾸면 열려 있던 입력창은 닫는다.
  useEffect(() => {
    setFillAt(null);
  }, [mode]);

  // 입력창이 열려 있는 동안 마우스 아래 요소 정보(inspected)가 그 칸에 대한 것일 때만 쓴다.
  const fillTarget = fillAt && inspected && boxContains(inspected.box, fillAt) ? inspected : null;
  const passwordLike = looksLikePasswordField(fillTarget);

  const submitFill = () => {
    if (!fillAt || !interactive) return;
    const { x, y } = fillAt;
    const value = fillValue;
    setFillAt(null);
    void onSend({ type: 'fill', x, y, value });
  };

  // ── 주소 표시줄 ──
  const [address, setAddress] = useState(state.url ?? '');
  const [editingAddress, setEditingAddress] = useState(false);
  useEffect(() => {
    if (!editingAddress) setAddress(state.url ?? '');
  }, [state.url, editingAddress]);

  const submitAddress = (e: React.FormEvent) => {
    e.preventDefault();
    const target = normalizeGotoInput(address);
    if (!target || !interactive) return;
    setFillAt(null);
    void onSend({ type: 'goto', url: target });
  };

  // ── 좌표 ──
  const pointFromEvent = (e: React.MouseEvent): ViewportPoint | null => {
    const el = wrapRef.current;
    if (!el) return null;
    return toViewportPoint({ x: e.clientX, y: e.clientY }, el.getBoundingClientRect(), state.viewport);
  };

  const clearHoverTimer = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!interactive) return; // 동작 중에는 중복 클릭을 막는다
    const point = pointFromEvent(e);
    if (!point) return;
    clearHoverTimer();
    if (mode === 'fill') {
      setFillValue('');
      setFillAt(point);
      return;
    }
    setFillAt(null);
    const action: RecorderAction =
      mode === 'click'
        ? { type: 'click', ...point }
        : mode === 'assertVisible'
          ? { type: 'assertVisible', ...point }
          : { type: 'assertText', ...point };
    void onSend(action);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (fillAt || !interactive) return; // 입력창이 열려 있으면 그 칸의 테두리를 그대로 둔다
    const point = pointFromEvent(e);
    clearHoverTimer();
    if (!point) {
      onClearInspected();
      return;
    }
    hoverTimer.current = setTimeout(() => onInspect(point.x, point.y), HOVER_DEBOUNCE_MS);
  };

  const handleMouseLeave = () => {
    clearHoverTimer();
    if (!fillAt) onClearInspected();
  };

  // 휠: 사이트를 스크롤한다. 페이지가 같이 스크롤되지 않도록 passive 가 아닌 리스너로 막는다.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const flush = () => {
      wheelTimer.current = null;
      const { locked: isLocked, closed: isClosed, onSend: send } = latest.current;
      if (isClosed) {
        wheelAcc.current = 0;
        return;
      }
      if (isLocked) {
        // 다른 동작이 끝나길 기다렸다가 모은 만큼 한 번에 보낸다.
        wheelTimer.current = setTimeout(flush, WHEEL_FLUSH_MS);
        return;
      }
      const deltaY = wheelAcc.current;
      wheelAcc.current = 0;
      if (deltaY !== 0) void send({ type: 'scroll', deltaY });
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = normalizeWheelDelta(e.deltaY, e.deltaMode, latest.current.viewportHeight);
      if (delta === 0 || latest.current.closed) return;
      setFillAt(null);
      wheelAcc.current += delta;
      if (!wheelTimer.current) wheelTimer.current = setTimeout(flush, WHEEL_FLUSH_MS);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = null;
    };
  }, []);

  // 화면을 떠날 때 남은 마우스 오버 타이머를 치운다.
  useEffect(() => clearHoverTimer, []);

  const aspectRatio = `${state.viewport.width} / ${state.viewport.height}`;
  const box = inspected ? boxToPercent(inspected.box, state.viewport) : null;
  const tooltipAbove = inspected ? inspected.box.y > state.viewport.height * 0.1 : true;

  // 입력창은 점 근처에 띄우되, 화면 가장자리에서는 안쪽으로 접는다.
  const popoverPlace = fillAt
    ? {
        ...pointToPercent(fillAt, state.viewport),
        transform: `translate(${fillAt.x > state.viewport.width * 0.6 ? '-100%' : '0'}, ${
          fillAt.y > state.viewport.height * 0.65 ? 'calc(-100% - 8px)' : '8px'
        })`,
      }
    : null;

  return (
    <div className="space-y-2">
      <form onSubmit={submitAddress} className="flex items-center gap-2">
        <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-sm border border-border bg-card px-3 hover:border-border-strong">
          <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={() => setEditingAddress(true)}
            onBlur={() => setEditingAddress(false)}
            disabled={closed}
            aria-label="주소"
            placeholder="이동할 주소 또는 경로 (예: /login)"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none disabled:text-muted-foreground"
          />
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={!interactive || !normalizeGotoInput(address)}>
          이동
        </Button>
      </form>

      <div
        ref={wrapRef}
        role="group"
        aria-label="원격 브라우저 화면. 누른 위치가 그대로 사이트에 전달돼요"
        aria-busy={showSpinner}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ aspectRatio }}
        className={cn(
          'relative w-full select-none overflow-hidden rounded-lg border border-border bg-muted',
          showSpinner ? 'cursor-progress' : mode === 'fill' ? 'cursor-text' : 'cursor-crosshair',
          !interactive && !showSpinner && 'cursor-default'
        )}
      >
        {screenshotUrl ? (
          <img
            src={screenshotUrl}
            alt="원격 브라우저 화면"
            draggable={false}
            className={cn('block h-full w-full', showSpinner && 'opacity-60')}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 화면을 불러오는 중...
          </div>
        )}

        {/* 마우스 아래 요소 테두리 + 셀렉터 안내 */}
        {box && inspected && !showSpinner && (
          <>
            <div
              className={cn(
                'pointer-events-none absolute rounded-[2px] border-2',
                inspected.fragile ? 'border-warning bg-warning/10' : 'border-primary bg-primary/10'
              )}
              style={box}
            />
            <div
              className="pointer-events-none absolute z-10 max-w-[70%] rounded-sm border border-border bg-card px-2 py-1 text-xs shadow-sm"
              style={{
                left: box.left,
                top: tooltipAbove ? box.top : `calc(${box.top} + ${box.height})`,
                transform: tooltipAbove ? 'translateY(calc(-100% - 4px))' : 'translateY(4px)',
              }}
            >
              <p className="truncate font-mono text-[11px] text-foreground">
                {inspected.selector ?? `<${inspected.tag}>`}
              </p>
              {inspected.fragile && (
                <p className="text-[11px] text-warning">순번에 기대는 셀렉터라 화면이 바뀌면 깨질 수 있어요</p>
              )}
            </div>
          </>
        )}

        {/* 입력 팝오버 */}
        {fillAt && popoverPlace && (
          <div
            className="absolute z-20 w-72 space-y-2 rounded-lg border border-border bg-card p-3 shadow-lg"
            style={popoverPlace}
            onClick={(e) => e.stopPropagation()}
            onMouseMove={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-medium text-foreground">
              {fillTarget?.name ? `'${fillTarget.name}' 칸에 넣을 값` : '이 칸에 넣을 값'}
            </p>
            <input
              autoFocus
              type={passwordLike ? 'password' : 'text'}
              value={fillValue}
              onChange={(e) => setFillValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return; // 한글 조합 중의 Enter 는 글자 확정이다
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitFill();
                } else if (e.key === 'Escape') {
                  setFillAt(null);
                }
              }}
              aria-label="입력할 값"
              autoComplete={passwordLike ? 'new-password' : 'off'}
              className="h-9 w-full rounded-sm border border-border bg-card px-2.5 text-sm text-foreground hover:border-border-strong"
            />
            <p className={cn('text-[11px]', passwordLike ? 'font-medium text-primary' : 'text-muted-foreground')}>
              {passwordLike ? SECRET_ENV_NOTE : `비밀번호 칸이면 ${SECRET_ENV_NOTE}`}
            </p>
            <div className="flex justify-end gap-1.5">
              <Button type="button" variant="outline" size="xs" onClick={() => setFillAt(null)}>
                취소
              </Button>
              <Button type="button" size="xs" onClick={submitFill}>
                입력
              </Button>
            </div>
          </div>
        )}

        {/* 동작 중: 반투명 + 스피너. 스크롤은 화면을 가리지 않고 모서리에만 표시한다. */}
        {showSpinner && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/40" aria-hidden>
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}
        {busy === 'scroll' && (
          <div className="pointer-events-none absolute right-2 top-2 rounded-full bg-card/90 p-1.5 shadow-sm" aria-hidden>
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </div>
        )}

        {closed && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-card/85 p-6 text-center">
            <p className="text-sm text-foreground">{state.error || '녹화가 끝났어요.'}</p>
            <Button type="button" size="sm" onClick={onRestart}>
              <RotateCcw className="h-3.5 w-3.5" /> 새로 시작
            </Button>
          </div>
        )}
      </div>

      <p className="truncate text-xs text-muted-foreground">
        {state.title ? `${state.title} · ` : ''}
        {state.viewport.width}×{state.viewport.height}
      </p>
    </div>
  );
}
