import { useReactFlow } from '@xyflow/react';
import { Maximize, Minus, Plus } from 'lucide-react';

/** 그래프 확대 · 축소 · 전체 보기. F 키로도 전체 보기를 할 수 있다(StructureGraph). */
export function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const button =
    'flex h-8 w-8 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';
  return (
    <div
      className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sm"
      role="group"
      aria-label="확대 · 축소"
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
    </div>
  );
}
