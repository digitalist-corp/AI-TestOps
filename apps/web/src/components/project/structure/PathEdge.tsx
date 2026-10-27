import { memo } from 'react';
import { EdgeLabelRenderer, Position, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';

/**
 * - transition: 분석에서 찾은 화면 전환
 * - layout: 공용 메뉴 영역에서 메뉴 링크 화면으로
 * - virtual-menu: 경로에서 이웃한 두 화면이 공용 메뉴로만 이어짐
 * - virtual-broken: 경로에서 이웃한 두 화면 사이에 찾은 길이 없음 (끊긴 구간)
 */
export type PathEdgeKind = 'transition' | 'layout' | 'virtual-menu' | 'virtual-broken';

export interface PathEdgeData extends Record<string, unknown> {
  kind: PathEdgeKind;
  /** 경로에서 이 선을 지나는 단계 (1 → 2 이면 1) */
  steps: number[];
  labels: string[];
  count: number;
  hot: boolean;
  dimmed: boolean;
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

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 선을 따라 흐르는 데이터 패킷 */
function Packets({ path, color, count, dur }: { path: string; color: string; count: number; dur: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <rect key={i} x={-5} y={-1.25} width={10} height={2.5} rx={1} style={{ fill: color, filter: `drop-shadow(0 0 4px ${color})` }}>
          <animateMotion dur={`${dur}s`} begin={`${(dur / count) * i}s`} repeatCount="indefinite" rotate="auto" path={path} />
        </rect>
      ))}
    </>
  );
}

function PathEdgeView({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<PathFlowEdge>) {
  if (!data) return null;
  const [path, labelX, labelY] = edgePath(sourceX, sourceY, targetX, targetY);
  const active = data.steps.length > 0;
  const showLabel = data.hot && data.labels.length > 0 && data.kind === 'transition';
  const tagTone =
    data.kind === 'virtual-broken'
      ? 'border-[var(--c-amber)] text-[var(--c-amber)]'
      : data.kind === 'virtual-menu'
        ? 'border-[var(--c-blue)] text-[var(--c-blue)]'
        : 'border-[var(--c-cyan)] text-[var(--c-cyan)]';

  return (
    <>
      {(data.kind === 'transition' || data.kind === 'layout') && (
        <path
          d={path}
          className="sg-edge-base"
          data-kind={data.kind}
          data-hot={data.hot}
          data-dimmed={data.dimmed && !active}
          markerEnd={data.kind === 'transition' ? (data.hot ? 'url(#sg-arrow-hot)' : 'url(#sg-arrow)') : undefined}
        />
      )}

      {data.hot && !active && data.kind === 'transition' && <Packets path={path} color="var(--c-cyan)" count={1} dur={1.6} />}

      {active && data.kind === 'transition' && (
        <>
          <path d={path} className="sg-edge-glow" style={{ stroke: 'var(--c-cyan)' }} />
          <path d={path} className="sg-edge-active" markerEnd="url(#sg-arrow-path)" />
          <Packets path={path} color="#e8fbff" count={3} dur={2.4} />
        </>
      )}

      {data.kind === 'virtual-broken' && (
        <>
          <path d={path} className="sg-edge-glow" style={{ stroke: 'var(--c-amber)' }} />
          <path d={path} className="sg-edge-broken" markerEnd="url(#sg-arrow-warn)" />
        </>
      )}
      {data.kind === 'virtual-menu' && (
        <>
          <path d={path} className="sg-edge-glow" style={{ stroke: 'var(--c-blue)' }} />
          <path d={path} className="sg-edge-menu" markerEnd="url(#sg-arrow-menu)" />
          <Packets path={path} color="var(--c-blue)" count={2} dur={2.8} />
        </>
      )}

      {(active || data.kind === 'virtual-broken' || data.kind === 'virtual-menu' || showLabel) && (
        <EdgeLabelRenderer>
          <div
            className="sg-edge-label nodrag nopan pointer-events-none absolute flex flex-col items-center gap-1"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.steps.map((step) => (
              <span
                key={step}
                className={`flex items-center gap-1.5 rounded-[2px] border bg-[var(--c-bg)]/90 px-1.5 py-px text-[9px] font-bold tracking-wider shadow-[0_0_14px_-2px_currentColor] ${tagTone}`}
              >
                {pad2(step)}→{pad2(step + 1)}
                {data.kind === 'virtual-broken' && <span className="font-normal">// NO LINK</span>}
                {data.kind === 'virtual-menu' && <span className="font-normal">// VIA MENU</span>}
              </span>
            ))}
            {showLabel && !active && (
              <span className="max-w-48 truncate rounded-[2px] border border-[var(--c-line-2)] bg-[var(--c-panel)]/95 px-1.5 py-px text-[10px] text-[var(--c-text)]">
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
        {marker('sg-arrow', '#3d5168')}
        {marker('sg-arrow-hot', 'var(--c-cyan)')}
        {marker('sg-arrow-path', 'var(--c-cyan)')}
        {marker('sg-arrow-warn', 'var(--c-amber)')}
        {marker('sg-arrow-menu', 'var(--c-blue)')}
      </defs>
    </svg>
  );
}
