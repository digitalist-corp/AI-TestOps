import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { FileCode2, Globe, Lock, Plus } from 'lucide-react';
import type { SiteMapNode } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { SCREEN_H, SCREEN_W, type ScreenStatus } from './layoutGraph';

export interface ScreenNodeData extends Record<string, unknown> {
  node: SiteMapNode;
  status: ScreenStatus;
  entry: boolean;
  /** 경로에서 이 화면이 나오는 순서 (1부터, 여러 번일 수 있다) */
  orders: number[];
  /** 필터 · 검색에 걸리지 않아 흐리게 그린다 */
  dimmed: boolean;
  /** 마우스를 올린 화면 또는 그 이웃 */
  hot: boolean;
  focused: boolean;
  flash: boolean;
  onAdd: (routeKey: string) => void;
  onOpen: (routeKey: string) => void;
}

export type ScreenFlowNode = Node<ScreenNodeData, 'screen'>;

const STATUS_TAG: Record<ScreenStatus, { label: string; title: string; variant: 'destructive' | 'success' | 'neutral' }> = {
  failed: { label: '실패', title: '실패한 요소 있음', variant: 'destructive' },
  passed: { label: '통과', title: '모든 요소 확인됨', variant: 'success' },
  neutral: { label: '미확인', title: '확인 전', variant: 'neutral' },
};

const MAX_TICKS = 28;

/** 요소 하나에 눈금 하나. 많으면 비율대로 줄이되, 실패가 있으면 적어도 한 칸은 빨갛게 남긴다. */
export function verificationTicks(node: Pick<SiteMapNode, 'elementCount' | 'passedCount' | 'failedCount'>): ScreenStatus[] {
  const total = node.elementCount;
  if (total === 0) return [];
  const n = Math.min(total, MAX_TICKS);
  let failed = Math.round((node.failedCount / total) * n);
  if (node.failedCount > 0) failed = Math.max(failed, 1);
  const passed = Math.min(Math.round((node.passedCount / total) * n), n - failed);
  return [
    ...Array<ScreenStatus>(passed).fill('passed'),
    ...Array<ScreenStatus>(failed).fill('failed'),
    ...Array<ScreenStatus>(n - passed - failed).fill('neutral'),
  ];
}

/** 눈금 한 칸의 색. 화면 상자와 상세 패널이 함께 쓴다. */
export const TICK_CLASS: Record<ScreenStatus, string> = {
  passed: 'bg-success',
  failed: 'bg-destructive',
  neutral: 'bg-border',
};

function ScreenNodeView({ data }: NodeProps<ScreenFlowNode>) {
  const { node, status, orders } = data;
  const tag = STATUS_TAG[status];
  const ticks = verificationTicks(node);
  // 경로에 담겼거나 상세를 연 화면은 파란 테두리를 지키고, 마우스를 올려도 회색으로 바뀌지 않는다.
  const emphasized = orders.length > 0 || data.focused;

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-lg border bg-card p-3 shadow-sm transition-[border-color,box-shadow,opacity]',
        status === 'failed' ? 'border-destructive/50' : 'border-border',
        'hover:shadow-md',
        emphasized ? 'border-primary' : 'hover:border-border-strong',
        data.hot && !emphasized && 'border-border-strong shadow-md',
        data.focused && 'ring-2 ring-primary',
        data.flash && !data.focused && 'ring-2 ring-primary/50',
        data.dimmed ? 'opacity-30' : (node.excluded || node.stale) && 'opacity-60'
      )}
      style={{ width: SCREEN_W, height: SCREEN_H }}
      data-status={status}
      data-in-path={orders.length > 0}
      data-focused={data.focused}
      data-hot={data.hot}
      data-dimmed={data.dimmed}
      data-faded={!data.dimmed && (node.excluded || node.stale)}
      data-testid="structure-screen-node"
      data-route={node.routeKey}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="!h-2 !w-2 !min-w-0 !border-0 !bg-transparent" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="!h-2 !w-2 !min-w-0 !border-0 !bg-transparent" />

      {orders.length > 0 && (
        <div className="absolute -top-3 left-3 flex gap-1">
          {orders.slice(0, 5).map((order) => (
            <span key={order} className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold leading-none text-primary-foreground shadow-sm">
              {order}단계
            </span>
          ))}
          {orders.length > 5 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold leading-none text-primary-foreground shadow-sm">
              +{orders.length - 5}
            </span>
          )}
        </div>
      )}

      {/* 머리줄: 찾은 방법 · 시작 화면 · 상태 · 경로에 추가 */}
      <div className="flex items-center gap-1.5">
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground"
          title={node.origin === 'SITE' ? '사이트 탐색으로 찾은 화면' : '코드 분석으로 찾은 화면'}
        >
          {node.origin === 'SITE' ? <Globe className="h-4 w-4" /> : <FileCode2 className="h-4 w-4" />}
        </span>
        {data.entry && <Badge variant="info">시작 화면</Badge>}
        <Badge variant={tag.variant} className="ml-auto" title={tag.title}>
          {tag.label}
        </Badge>
        <button
          type="button"
          className="nodrag flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground"
          title="경로에 추가"
          aria-label={`${node.routeKey} 를 경로에 추가`}
          onClick={(e) => {
            e.stopPropagation();
            data.onAdd(node.routeKey);
          }}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      </div>

      {/* 본문: 경로 · 제목 */}
      <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
        {/* 마우스 클릭은 onNodeClick 이 받는다. 키보드(Enter · Space)로 누른 클릭만 여기서 연다. */}
        <button
          type="button"
          className="min-w-0 flex-1 cursor-pointer truncate text-left font-mono text-sm font-semibold text-foreground"
          title={node.routeKey}
          onClick={(e) => {
            if (e.detail === 0) data.onOpen(node.routeKey);
          }}
        >
          {node.routeKey}
        </button>
        {node.authRequired && (
          <span title="로그인해야 열리는 화면" className="shrink-0 text-warning">
            <Lock className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <p className="mt-0.5 truncate text-xs text-muted-foreground" title={node.title ?? node.sourceFile ?? node.url ?? ''}>
        {node.title ?? node.sourceFile?.split('/').pop() ?? node.url ?? '제목 없음'}
      </p>

      {/* 바닥줄: 확인 눈금 · 수치 · 표시 */}
      <div className="mt-auto space-y-1.5">
        {ticks.length > 0 ? (
          <div className="flex h-2 gap-0.5" title={`요소 ${node.elementCount}개`}>
            {ticks.map((t, i) => (
              <i key={i} className={cn('flex-1 rounded-sm', TICK_CLASS[t])} />
            ))}
          </div>
        ) : (
          <div className="flex h-2 items-center text-[11px] text-muted-foreground">확인할 요소가 없습니다</div>
        )}
        <div className="flex min-w-0 items-center gap-2.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          <span title="확인된 요소">
            통과 <b className="font-semibold text-success">{node.passedCount}</b>
          </span>
          <span title="실패한 요소">
            실패 <b className={cn('font-semibold', node.failedCount > 0 ? 'text-destructive' : 'text-muted-foreground')}>{node.failedCount}</b>
          </span>
          <span title="확인 전 요소">
            미확인 <b className="font-semibold text-muted-foreground">{node.unverifiedCount}</b>
          </span>
          <span className="ml-auto flex min-w-0 gap-1 overflow-hidden">
            {node.excluded && (
              <Badge variant="warning" className="px-1.5 py-0 text-[11px]" title="테스트 생성에서 제외됨">
                제외됨
              </Badge>
            )}
            {node.stale && (
              <Badge
                variant="warning"
                className="px-1.5 py-0 text-[11px]"
                title={node.origin === 'SITE' ? '탐색에서 사라짐' : '코드에 없음'}
              >
                {node.origin === 'SITE' ? '사라짐' : '코드에 없음'}
              </Badge>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

export const ScreenNode = memo(ScreenNodeView);
