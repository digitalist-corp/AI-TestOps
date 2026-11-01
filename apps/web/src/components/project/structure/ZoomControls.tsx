import { useReactFlow } from '@xyflow/react';
import { Expand, Maximize, Minimize2, Minus, Plus, RotateCcw } from 'lucide-react';

/**
 * 그래프 확대 · 축소 · 전체 보기 · 전체 화면. F 키로도 전체 보기를 할 수 있다(StructureGraph).
 * 화면을 끌어 옮겼을 때만 자동 배치로 되돌리는 버튼이 하나 더 붙는다.
 */
export function ZoomControls({ fullscreen, onFullscreen, moved, onResetLayout }: {
  fullscreen: boolean;
  onFullscreen: () => void;
  moved: boolean;
  onResetLayout: () => void;
}) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const button =
    'flex h-8 w-8 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';
  return (
    <div
      className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sm"
      role="group"
      aria-label="그래프 보기 도구"
    >
      <button type="button" className={button} onClick={() => zoomIn({ duration: 250 })} aria-label="확대" title="확대">
        <Plus className="h-4 w-4" />
      </button>
      <button type="button" className={button} onClick={() => zoomOut({ duration: 250 })} aria-label="축소" title="축소">
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={button}
        onClick={() => fitView({ padding: 0.18, maxZoom: 1, duration: 500 })}
        aria-label="전체 보기"
        title="전체 보기 (F)"
      >
        <Maximize className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={button}
        onClick={onFullscreen}
        aria-label={fullscreen ? '전체 화면 끝내기' : '전체 화면'}
        title={fullscreen ? '전체 화면 끝내기 (Esc)' : '전체 화면'}
      >
        {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
      </button>
      {moved && (
        <button
          type="button"
          className={button}
          onClick={onResetLayout}
          aria-label="자동 배치로 되돌리기"
          title="옮긴 화면을 자동 배치로 되돌립니다"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
