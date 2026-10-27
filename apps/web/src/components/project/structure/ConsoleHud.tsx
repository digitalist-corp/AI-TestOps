import { useEffect, useState, type RefObject } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import { Crosshair, Maximize, Minus, Plus } from 'lucide-react';

export { DecodeText, LiveClock } from '@/components/console/ConsoleText';


/** 마우스가 가리키는 그래프 좌표와 확대 배율. */
export function CursorReadout({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const { screenToFlowPosition } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setPos(screenToFlowPosition({ x: e.clientX, y: e.clientY })));
    };
    const onLeave = () => setPos(null);
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, [containerRef, screenToFlowPosition]);
  const fmt = (v: number) => (v < 0 ? '-' : '+') + String(Math.abs(Math.round(v))).padStart(4, '0');
  return (
    <div className="sg-hud sg-mono flex items-center gap-3 px-2.5 py-1.5 text-[10px] tabular-nums text-[var(--c-muted)]">
      <Crosshair className="h-3 w-3 text-[var(--c-cyan)]" />
      <span>X {pos ? fmt(pos.x) : '-----'}</span>
      <span>Y {pos ? fmt(pos.y) : '-----'}</span>
      <span className="text-[var(--c-cyan)]">Z {zoom.toFixed(2)}×</span>
    </div>
  );
}

export function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const button = 'flex h-7 w-7 cursor-pointer items-center justify-center text-[var(--c-muted)] transition-colors hover:bg-[var(--c-cyan)] hover:text-[#021018]';
  return (
    <div className="sg-hud flex flex-col divide-y divide-[var(--c-line-2)]" role="group" aria-label="확대 · 축소">
      <button type="button" className={button} onClick={() => zoomIn({ duration: 250 })} aria-label="확대" title="확대">
        <Plus className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={button} onClick={() => zoomOut({ duration: 250 })} aria-label="축소" title="축소">
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={button}
        onClick={() => fitView({ padding: 0.18, maxZoom: 1, duration: 500 })}
        aria-label="전체 보기"
        title="전체 보기 (F)"
      >
        <Maximize className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ViewportFrame() {
  return (
    <>
      <span className="sg-viewport-bracket" data-at="tl" />
      <span className="sg-viewport-bracket" data-at="tr" />
      <span className="sg-viewport-bracket" data-at="bl" />
      <span className="sg-viewport-bracket" data-at="br" />
      <div className="sg-scan" />
    </>
  );
}
