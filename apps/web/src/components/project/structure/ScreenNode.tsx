import { memo, type CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { FileCode2, Globe, Lock, Plus } from 'lucide-react';
import type { SiteMapNode } from '@/types';
import { SCREEN_H, SCREEN_W, type ScreenStatus } from './layoutGraph';

export interface ScreenNodeData extends Record<string, unknown> {
  node: SiteMapNode;
  /** 화면 식별 코드 (SCR-01 …) */
  code: string;
  status: ScreenStatus;
  rank: number;
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

const STATUS_TAG: Record<ScreenStatus, { label: string; title: string; color: string }> = {
  failed: { label: 'FAIL', title: '실패한 요소 있음', color: 'var(--sg-fail)' },
  passed: { label: 'PASS', title: '모든 요소 확인됨', color: 'var(--sg-pass)' },
  neutral: { label: 'UNVERIFIED', title: '확인 전', color: 'var(--c-muted)' },
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

const TICK_COLOR: Record<ScreenStatus, string> = {
  passed: 'var(--sg-pass)',
  failed: 'var(--sg-fail)',
  neutral: '#2a3a4c',
};

const pad2 = (n: number) => String(n).padStart(2, '0');

function ScreenNodeView({ data }: NodeProps<ScreenFlowNode>) {
  const { node, status, orders } = data;
  const tag = STATUS_TAG[status];
  const ticks = verificationTicks(node);
  const delay = Math.min(data.rank * 90, 900);
  const style = { width: SCREEN_W, height: SCREEN_H, '--sg-delay': `${delay}ms` } as CSSProperties;

  return (
    <div
      className="sg-node flex flex-col pb-2.5 pl-3.5 pr-3 pt-2.5"
      style={style}
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

      {(data.focused || data.hot) && <span className="sg-brackets" data-kind="lock" />}
      {data.flash && <span key={String(data.flash)} className="sg-brackets" data-kind="flash" />}

      {orders.length > 0 && (
        <div className="absolute -top-[11px] left-3 flex gap-1">
          {orders.slice(0, 5).map((order) => (
            <span key={order} className="sg-step rounded-[2px] px-1.5 py-px text-[10px] font-bold tracking-wider">
              STEP {pad2(order)}
            </span>
          ))}
          {orders.length > 5 && <span className="sg-step rounded-[2px] px-1.5 py-px text-[10px] font-bold">+{orders.length - 5}</span>}
        </div>
      )}

      {/* 머리줄: 종류 · 코드 · 상태 */}
      <div className="flex items-center gap-1.5">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] bg-[var(--c-bg-2)] text-[var(--c-muted)] ring-1 ring-[var(--c-line-2)]">
          {node.origin === 'SITE' ? <Globe className="h-2.5 w-2.5" /> : <FileCode2 className="h-2.5 w-2.5" />}
        </span>
        <span className="sg-label !text-[9px]">{node.origin === 'SITE' ? 'SITE' : 'SCREEN'}</span>
        <span className="sg-mono text-[9px] text-[var(--c-dim)]">{data.code}</span>
        {data.entry && <span className="sg-mono rounded-[2px] bg-[var(--c-cyan)]/12 px-1 text-[9px] font-bold text-[var(--c-cyan)]">ENTRY</span>}
        <span className="sg-mono ml-auto flex items-center gap-1 text-[9px] font-bold tracking-wider" style={{ color: tag.color }} title={tag.title}>
          <span className={`h-1.5 w-1.5 rounded-full ${status === 'failed' ? 'sg-live' : ''}`} style={{ background: tag.color, boxShadow: `0 0 6px ${tag.color}` }} />
          {tag.label}
        </span>
        <button
          type="button"
          className="sg-add nodrag ml-1 flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[2px]"
          title="경로에 추가"
          aria-label={`${node.routeKey} 를 경로에 추가`}
          onClick={(e) => {
            e.stopPropagation();
            data.onAdd(node.routeKey);
          }}
        >
          <Plus className="h-3 w-3" strokeWidth={3} />
        </button>
      </div>

      {/* 본문: 경로 · 제목 */}
      <div className="mt-2 flex min-w-0 items-center gap-1.5">
        {/* 마우스 클릭은 onNodeClick 이 받는다. 키보드(Enter · Space)로 누른 클릭만 여기서 연다. */}
        <button
          type="button"
          className="sg-mono min-w-0 flex-1 cursor-pointer truncate text-left text-[13px] font-semibold text-[var(--c-text)]"
          title={node.routeKey}
          onClick={(e) => {
            if (e.detail === 0) data.onOpen(node.routeKey);
          }}
        >
          {node.routeKey}
        </button>
        {node.authRequired && (
          <span title="로그인해야 열리는 화면" className="shrink-0 text-[var(--c-amber)]">
            <Lock className="h-3 w-3" />
          </span>
        )}
      </div>
      <p className="mt-0.5 truncate text-[11px] text-[var(--c-muted)]" title={node.title ?? node.sourceFile ?? node.url ?? ''}>
        {node.title ?? node.sourceFile?.split('/').pop() ?? node.url ?? '제목 없음'}
      </p>

      {/* 바닥줄: 확인 눈금 · 수치 · 표시 */}
      <div className="mt-auto space-y-1.5">
        {ticks.length > 0 ? (
          <div className="sg-ticks" title={`요소 ${node.elementCount}개`}>
            {ticks.map((t, i) => (
              <i key={i} style={{ background: TICK_COLOR[t], animationDelay: `${delay + 300 + i * 18}ms` }} />
            ))}
          </div>
        ) : (
          <div className="sg-label flex h-[9px] items-center !text-[9px]">NO ELEMENTS</div>
        )}
        <div className="sg-mono flex items-center gap-2.5 text-[10px] tabular-nums">
          <span className="text-[var(--c-dim)]" title="확인된 요소">
            PASS <b className="text-[var(--sg-pass)]">{pad2(node.passedCount)}</b>
          </span>
          <span className="text-[var(--c-dim)]" title="실패한 요소">
            FAIL <b className={node.failedCount > 0 ? 'text-[var(--sg-fail)]' : 'text-[var(--c-muted)]'}>{pad2(node.failedCount)}</b>
          </span>
          <span className="text-[var(--c-dim)]" title="확인 전 요소">
            UNV <b className="text-[var(--c-muted)]">{pad2(node.unverifiedCount)}</b>
          </span>
          <span className="ml-auto flex gap-1">
            {node.excluded && (
              <span className="rounded-[2px] border border-[var(--c-amber)]/50 px-1 text-[9px] text-[var(--c-amber)]" title="제외됨">
                EXCL
              </span>
            )}
            {node.stale && (
              <span
                className="rounded-[2px] border border-[var(--c-amber)]/50 px-1 text-[9px] text-[var(--c-amber)]"
                title={node.origin === 'SITE' ? '탐색에서 사라짐' : '코드에 없음'}
              >
                MISSING
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

export const ScreenNode = memo(ScreenNodeView);
