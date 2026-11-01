import { memo, type CSSProperties } from 'react';
import { EdgeLabelRenderer, Position, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { Unlink } from 'lucide-react';
import type { CoverageEdgeState } from '@/types';
import { EDGE_STATE_META } from '@/lib/coverage';

/**
 * - transition: 분석에서 찾은 화면 전환
 * - layout: 공용 메뉴 영역에서 메뉴 링크 화면으로
 * - virtual-menu: 경로에서 이웃한 두 화면이 공용 메뉴로만 이어짐
 * - virtual-broken: 경로에서 이웃한 두 화면 사이에 찾은 길이 없음 (끊긴 구간)
 * - flow: 테스트 흐름을 재생할 때 단계 사이에 그려지는 선
 */
export type PathEdgeKind = 'transition' | 'layout' | 'virtual-menu' | 'virtual-broken' | 'flow';

export interface PathEdgeData extends Record<string, unknown> {
  kind: PathEdgeKind;
  /** 경로에서 이 선을 지나는 단계 (1 → 2 이면 1) */
  steps: number[];
  labels: string[];
  count: number;
  hot: boolean;
  dimmed: boolean;
  /** 확인 지도에서 이 전환의 상태 (transition 일 때) */
  coverage?: CoverageEdgeState;
  /** 흐름 재생 선의 색 (flow 일 때). fail 은 막힌 단계로 들어가는 선 */
  flowTone?: 'pass' | 'fail' | 'pending';
}

export type PathFlowEdge = Edge<PathEdgeData, 'path'>;

/**
 * 앞으로 가는 선은 일반 곡선, 왼쪽으로 되돌아가는 선은 상자 아래로 크게 돌아가는 곡선으로 그린다.
 * 좌→우 배치에서 되돌아가는 선을 그냥 이으면 상자를 가로질러 알아보기 어렵다.
 */
export function edgePath(sx: number, sy: number, tx: number, ty: number): [string, number, number] {
  if (tx > sx + 40) {
    const [path, lx, ly] = getBezierPath({
      sourceX: sx,
      sourceY: sy,
      sourcePosition: Position.Right,
      targetX: tx,
      targetY: ty,
      targetPosition: Position.Left,
    });
    return [path, lx, ly];
  }
  const bottom = Math.max(sy, ty) + Math.max(110, Math.abs(ty - sy) / 2 + 80);
  const mid = (sx + tx) / 2;
  const reach = 140;
  return [`M ${sx},${sy} C ${sx + reach},${sy} ${sx + reach},${bottom} ${mid},${bottom} S ${tx - reach},${ty} ${tx},${ty}`, mid, bottom];
}

/** 선 색. 앱 테마의 색 변수를 그대로 써서 라이트 · 다크를 따른다. */
const STROKE = {
  base: 'var(--color-border-strong)',
  hot: 'var(--color-secondary-foreground)',
  path: 'var(--color-primary)',
  menu: 'var(--color-info)',
  broken: 'var(--color-warning)',
  tested: 'var(--color-success)',
  failed: 'var(--color-destructive)',
  unknown: 'var(--color-border)',
};

/** 선 모양. 색만으로 구분하지 않도록 공용 메뉴는 점선, 끊긴 구간은 긴 점선으로 그린다. */
const EDGE_STYLE: Record<'base' | 'hot' | 'path' | 'menu' | 'broken' | 'layout' | 'layoutHot', CSSProperties> = {
  base: { stroke: STROKE.base, strokeWidth: 1.5 },
  hot: { stroke: STROKE.hot, strokeWidth: 2 },
  path: { stroke: STROKE.path, strokeWidth: 2.5 },
  menu: { stroke: STROKE.menu, strokeWidth: 2, strokeDasharray: '2 5', strokeLinecap: 'round' },
  broken: { stroke: STROKE.broken, strokeWidth: 2, strokeDasharray: '6 5' },
  layout: { stroke: STROKE.menu, strokeWidth: 1.5, strokeDasharray: '2 5', strokeLinecap: 'round', strokeOpacity: 0.5 },
  layoutHot: { stroke: STROKE.menu, strokeWidth: 1.5, strokeDasharray: '2 5', strokeLinecap: 'round' },
};

/**
 * 확인 지도 상태별 전환선: 테스트로 지나감은 초록 실선, 화면에서 이동 확인은 회색 실선,
 * 막힘은 빨강 점선(+ 끊김 표시), 아직 모름은 연한 점선.
 */
const COVERAGE_STYLE: Record<CoverageEdgeState, { style: CSSProperties; marker: string }> = {
  TESTED: { style: { stroke: STROKE.tested, strokeWidth: 2.25 }, marker: 'url(#edge-arrow-tested)' },
  OBSERVED: { style: { stroke: STROKE.base, strokeWidth: 1.5 }, marker: 'url(#edge-arrow)' },
  FAILED: { style: { stroke: STROKE.failed, strokeWidth: 2, strokeDasharray: '6 5' }, marker: 'url(#edge-arrow-failed)' },
  UNKNOWN: { style: { stroke: STROKE.unknown, strokeWidth: 1.25, strokeDasharray: '3 5' }, marker: 'url(#edge-arrow-unknown)' },
};

const FLOW_STROKE: Record<'pass' | 'fail' | 'pending', { stroke: string; marker: string }> = {
  pass: { stroke: STROKE.tested, marker: 'url(#edge-arrow-tested)' },
  fail: { stroke: STROKE.failed, marker: 'url(#edge-arrow-failed)' },
  pending: { stroke: STROKE.path, marker: 'url(#edge-arrow-path)' },
};

/** 전환선 한 줄. 마우스를 올리면 굵어지고, 회색 계열 선은 진한 색으로 바뀐다. */
function transitionStyle(state: CoverageEdgeState, hot: boolean): { style: CSSProperties; marker: string } {
  const base = COVERAGE_STYLE[state];
  if (!hot) return base;
  if (state === 'TESTED' || state === 'FAILED') {
    return { style: { ...base.style, strokeWidth: Number(base.style.strokeWidth) + 0.75 }, marker: base.marker };
  }
  return { style: EDGE_STYLE.hot, marker: 'url(#edge-arrow-hot)' };
}

function PathEdgeView({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<PathFlowEdge>) {
  if (!data) return null;
  const [path, labelX, labelY] = edgePath(sourceX, sourceY, targetX, targetY);
  const active = data.steps.length > 0;
  const showLabel = data.hot && data.labels.length > 0 && data.kind === 'transition';
  const coverage = data.coverage ?? 'OBSERVED';
  const line = transitionStyle(coverage, data.hot);
  // 막힌 전환에는 가운데에 끊김 표시를 단다. 경로 단계 표시가 있으면 그쪽을 먼저 보인다.
  const showBreak = data.kind === 'transition' && coverage === 'FAILED' && !active && !data.dimmed;

  if (data.kind === 'flow') {
    const tone = FLOW_STROKE[data.flowTone ?? 'pass'];
    // pathLength=1 이라 coverage-draw 가 선을 처음부터 끝까지 그려 나간다. 다시 그리려면 엣지를 새로 만든다.
    return (
      <path
        d={path}
        fill="none"
        pathLength={1}
        className="coverage-draw"
        style={{ stroke: tone.stroke, strokeWidth: 3.5, strokeLinecap: 'round' }}
        markerEnd={tone.marker}
      />
    );
  }
  const tagTone =
    data.kind === 'virtual-broken'
      ? 'border-warning/50 text-warning'
      : data.kind === 'virtual-menu'
        ? 'border-info/50 text-info'
        : 'border-primary/50 text-primary';

  return (
    <>
      {data.kind === 'transition' && !active && (
        <path
          d={path}
          fill="none"
          style={{ ...line.style, opacity: data.dimmed ? 0.2 : 1 }}
          markerEnd={line.marker}
        >
          <title>{EDGE_STATE_META[coverage].label} — {EDGE_STATE_META[coverage].hint}</title>
        </path>
      )}
      {data.kind === 'layout' && (
        <path
          d={path}
          fill="none"
          style={{ ...(data.hot ? EDGE_STYLE.layoutHot : EDGE_STYLE.layout), ...(data.dimmed ? { strokeOpacity: 0.15 } : {}) }}
        />
      )}

      {active && data.kind === 'transition' && <path d={path} fill="none" style={EDGE_STYLE.path} markerEnd="url(#edge-arrow-path)" />}
      {data.kind === 'virtual-broken' && <path d={path} fill="none" style={EDGE_STYLE.broken} markerEnd="url(#edge-arrow-warn)" />}
      {data.kind === 'virtual-menu' && <path d={path} fill="none" style={EDGE_STYLE.menu} markerEnd="url(#edge-arrow-menu)" />}

      {showBreak && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute flex h-6 w-6 items-center justify-center rounded-full border-2 border-destructive bg-card text-destructive shadow-sm"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            title={`${EDGE_STATE_META.FAILED.label} — ${EDGE_STATE_META.FAILED.hint}`}
            aria-label={EDGE_STATE_META.FAILED.label}
            role="img"
          >
            <Unlink className="h-3 w-3" strokeWidth={2.5} />
          </div>
        </EdgeLabelRenderer>
      )}

      {(active || data.kind === 'virtual-broken' || data.kind === 'virtual-menu' || showLabel) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute flex flex-col items-center gap-1"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.steps.map((step) => (
              <span
                key={step}
                className={`flex items-center gap-1.5 rounded-md border bg-card px-1.5 py-0.5 text-[11px] font-semibold shadow-sm ${tagTone}`}
              >
                {step}→{step + 1}
                {data.kind === 'virtual-broken' && <span className="font-normal">직접 전환 없음</span>}
                {data.kind === 'virtual-menu' && <span className="font-normal">공용 메뉴로 이동</span>}
              </span>
            ))}
            {showLabel && !active && (
              <span className="max-w-48 truncate rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] text-foreground shadow-sm">
                “{data.labels.slice(0, 2).join('” · “')}”{data.count > 1 && ` ×${data.count}`}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const PathEdge = memo(PathEdgeView);

/** 선 끝 화살표. 그래프마다 한 번만 넣는다. */
export function PathEdgeDefs() {
  const marker = (id: string, color: string) => (
    <marker id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 1 1 L 8 5 L 1 9" fill="none" strokeWidth="1.6" style={{ stroke: color }} />
    </marker>
  );
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        {marker('edge-arrow', STROKE.base)}
        {marker('edge-arrow-hot', STROKE.hot)}
        {marker('edge-arrow-path', STROKE.path)}
        {marker('edge-arrow-warn', STROKE.broken)}
        {marker('edge-arrow-menu', STROKE.menu)}
        {marker('edge-arrow-tested', STROKE.tested)}
        {marker('edge-arrow-failed', STROKE.failed)}
        {marker('edge-arrow-unknown', STROKE.unknown)}
      </defs>
    </svg>
  );
}
