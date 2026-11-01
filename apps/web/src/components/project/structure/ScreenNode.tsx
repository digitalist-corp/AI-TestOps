import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Lock, Plus } from 'lucide-react';
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

/** 상태 점 색. 점 하나로 실패 · 통과 · 확인 전을 구분한다. */
const STATUS_DOT: Record<ScreenStatus, string> = {
  failed: 'bg-destructive',
  passed: 'bg-success',
  neutral: 'bg-border-strong',
};

function ScreenNodeView({ data }: NodeProps<ScreenFlowNode>) {
  const { node, status, orders } = data;
  const tag = STATUS_TAG[status];
  // 경로에 담겼거나 상세를 연 화면은 파란 테두리를 지키고, 마우스를 올려도 회색으로 바뀌지 않는다.
  const emphasized = orders.length > 0 || data.focused;
  // 화면 이름: 제목 → 화면 파일 이름 → 경로. 경로 자체가 이름이면 아래 경로 줄은 생략한다.
  const name = node.title ?? node.sourceFile?.split('/').pop() ?? node.routeKey;

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

      {/* 머리줄: 상태 점 · 화면 이름 · 경로에 추가 */}
      <div className="flex items-center gap-2">
        <span
          role="img"
          aria-label={tag.label}
          title={tag.title}
          className={cn('h-2.5 w-2.5 shrink-0 rounded-full', STATUS_DOT[status])}
        />
        {/* 마우스 클릭은 onNodeClick 이 받는다. 키보드(Enter · Space)로 누른 클릭만 여기서 연다. */}
        <button
          type="button"
          className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm font-semibold text-foreground"
          title={name}
          onClick={(e) => {
            if (e.detail === 0) data.onOpen(node.routeKey);
          }}
        >
          {name}
        </button>
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

      {name !== node.routeKey && (
        <p className="mt-1 truncate pl-[18px] font-mono text-xs text-muted-foreground" title={node.routeKey}>
          {node.routeKey}
        </p>
      )}

      {/* 바닥줄: 요소 수 · 표시 */}
      <div className="mt-auto flex min-w-0 items-center gap-2 pl-[18px] text-xs text-muted-foreground">
        <span className="shrink-0 tabular-nums" title="이 화면에서 찾은 버튼 · 링크 · 입력칸 수">
          요소 {node.elementCount}개
        </span>
        {node.authRequired && (
          <span title="로그인해야 열리는 화면" className="shrink-0 text-warning">
            <Lock className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="ml-auto flex min-w-0 gap-1 overflow-hidden">
          {data.entry && <Badge variant="info" className="px-1.5 py-0 text-[11px]">시작 화면</Badge>}
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
  );
}

export const ScreenNode = memo(ScreenNodeView);
