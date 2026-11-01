import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { CheckCircle2, CircleDashed, Eye, Lock, Plus, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { CoverageNode, CoverageNodeState, SiteMapNode } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { ISSUE_KIND_META, NODE_STATE_META, elementRatioText } from '@/lib/coverage';
import { cn } from '@/lib/utils';
import { SCREEN_H, SCREEN_W, type ScreenStatus } from './layoutGraph';

/** 흐름 재생 중 이 화면의 모습 */
export interface ScreenPlayback {
  /** 흐름에서 몇 번째 단계인지 (1부터) */
  order: number;
  /** 이미 켜졌는지 */
  lit: boolean;
  tone: 'pass' | 'fail' | 'pending';
  /** 흐름이 이 화면에서 막혔다면 그 이유. 말풍선으로 띄운다 */
  bubble: string | null;
}

export interface ScreenNodeData extends Record<string, unknown> {
  node: SiteMapNode;
  /** 예전 3단계 상태(failed · passed · neutral). data-status 로만 남긴다 */
  status: ScreenStatus;
  /** 확인 지도 상태 */
  state: CoverageNodeState;
  coverage: CoverageNode;
  entry: boolean;
  /** 경로에서 이 화면이 나오는 순서 (1부터, 여러 번일 수 있다) */
  orders: number[];
  /** 필터 · 검색에 걸리지 않거나, 다른 흐름을 재생 중이라 흐리게 그린다 */
  dimmed: boolean;
  /** 마우스를 올린 화면 또는 그 이웃 */
  hot: boolean;
  focused: boolean;
  flash: boolean;
  /** 방금 지도에 나타났다 (페이드인) */
  appeared: boolean;
  /** 방금 상태가 바뀌었다 (반짝임) */
  changed: boolean;
  play: ScreenPlayback | null;
  onAdd: (routeKey: string) => void;
  onOpen: (routeKey: string) => void;
}

export type ScreenFlowNode = Node<ScreenNodeData, 'screen'>;

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

/** 눈금 한 칸의 색 */
export const TICK_CLASS: Record<ScreenStatus, string> = {
  passed: 'bg-success',
  failed: 'bg-destructive',
  neutral: 'bg-border',
};

/** 상태마다 아이콘 · 색. 색만으로 구분하지 않도록 아이콘 모양도 다르다. */
export const STATE_ICON: Record<CoverageNodeState, { icon: LucideIcon; tone: string }> = {
  TESTED: { icon: CheckCircle2, tone: 'text-success' },
  OBSERVED: { icon: Eye, tone: 'text-info' },
  UNSEEN: { icon: CircleDashed, tone: 'text-muted-foreground' },
  BLOCKED: { icon: TriangleAlert, tone: 'text-destructive' },
};

/** 상자 모양: 통과는 초록 채움, 확인됨은 파랑 테두리, 안 봄은 회색 점선(흐리게), 막힘은 빨강 */
const STATE_BOX: Record<CoverageNodeState, string> = {
  TESTED: 'border-success bg-success/10',
  OBSERVED: 'border-info bg-card shadow-[inset_0_0_0_1px_var(--color-info)]',
  UNSEEN: 'border-dashed border-border-strong bg-card',
  BLOCKED: 'border-destructive bg-destructive/5',
};

/** 요소 비율 막대: 통과 · 실패 · 확인됨 · 안 봄 순서로 칸을 나눈다. 화면 상자와 상세 패널이 함께 쓴다. */
export function CoverageBar({ counts, className }: { counts: CoverageNode['counts']; className?: string }) {
  const parts = [
    { key: 'passed', n: counts.passed, c: 'bg-success', label: '테스트 통과' },
    { key: 'failed', n: counts.failed, c: 'bg-destructive', label: '실패' },
    { key: 'observed', n: counts.observed, c: 'bg-info', label: '화면에서 확인됨' },
    { key: 'unseen', n: counts.unseen, c: 'bg-border', label: '아직 안 봄' },
  ].filter((p) => p.n > 0);
  const title = parts.map((p) => `${p.label} ${p.n}`).join(' · ');
  return (
    <div className={cn('flex h-1.5 overflow-hidden rounded-full bg-border/60', className)} title={title || '요소 없음'} aria-hidden="true">
      {parts.map((p) => (
        <i key={p.key} className={p.c} style={{ width: `${(p.n / Math.max(counts.total, 1)) * 100}%` }} />
      ))}
    </div>
  );
}

const PLAY_RING: Record<ScreenPlayback['tone'], string> = {
  pass: 'ring-[3px] ring-success',
  fail: 'ring-[3px] ring-success',
  pending: 'ring-[3px] ring-primary',
};

function ScreenNodeView({ data }: NodeProps<ScreenFlowNode>) {
  const { node, status, state, coverage, orders, play } = data;
  const meta = NODE_STATE_META[state];
  const Icon = STATE_ICON[state].icon;
  // 화면 이름: 제목 → 화면 파일 이름 → 주소
  const name = node.title ?? node.sourceFile?.split('/').pop() ?? node.routeKey;
  const firstIssue = coverage.issues[0];
  const stopped = play?.lit && play.bubble != null;
  const fade = data.dimmed ? 'opacity-25' : play && !play.lit ? 'opacity-50' : state === 'UNSEEN' || node.excluded || node.stale ? 'opacity-70' : '';

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-lg border p-3 shadow-sm transition-[border-color,box-shadow,opacity] duration-300',
        STATE_BOX[state],
        'hover:shadow-md',
        data.hot && 'shadow-md',
        orders.length > 0 && !data.focused && 'ring-2 ring-primary/70',
        data.focused && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        data.flash && !data.focused && 'ring-2 ring-primary/50',
        play?.lit && (stopped ? 'ring-[3px] ring-destructive' : PLAY_RING[play.tone]),
        fade,
        data.appeared && 'coverage-appear'
      )}
      style={{ width: SCREEN_W, height: SCREEN_H }}
      data-status={status}
      data-state={state}
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

      {/* 막힌 화면: 살짝 깜빡이는 빨간 링 */}
      {state === 'BLOCKED' && !data.dimmed && (
        <span aria-hidden="true" className="coverage-pulse pointer-events-none absolute -inset-1.5 rounded-xl border-2 border-destructive/60" />
      )}
      {/* 방금 상태가 바뀐 화면: 잠깐 반짝임 */}
      {data.changed && (
        <span aria-hidden="true" className="coverage-flash pointer-events-none absolute -inset-1 rounded-xl ring-4 ring-primary/40" />
      )}

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

      {play && (
        <span
          className={cn(
            'absolute -top-3 right-10 flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold shadow-sm transition-colors',
            !play.lit
              ? 'border border-border bg-card text-muted-foreground'
              : stopped
                ? 'bg-destructive text-destructive-foreground'
                : play.tone === 'pending'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-success text-success-foreground'
          )}
          title={`흐름의 ${play.order}번째 화면`}
        >
          {play.order}
        </span>
      )}

      {/* 머리줄: 상태 아이콘 · 화면 이름 · 경로에 추가 */}
      <div className="flex items-center gap-2">
        <span role="img" aria-label={meta.label} title={`${meta.label} — ${meta.hint}`} className={cn('shrink-0', STATE_ICON[state].tone)}>
          <Icon className="h-4 w-4" strokeWidth={2.25} />
        </span>
        {/* 마우스 클릭은 onNodeClick 이 받는다. 키보드(Enter · Space)로 누른 클릭만 여기서 연다. */}
        <button
          type="button"
          className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm font-semibold text-foreground"
          title={name === node.routeKey ? name : `${name} (${node.routeKey})`}
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

      {/* 상태 한 줄: 막혔으면 그 이유 */}
      <p className={cn('mt-1 truncate pl-6 text-xs font-medium', STATE_ICON[state].tone)} title={firstIssue?.message ?? meta.hint}>
        {meta.label}
        {firstIssue && state === 'BLOCKED' && <span className="font-normal"> · {ISSUE_KIND_META[firstIssue.kind].title}</span>}
      </p>

      {/* 바닥줄: 요소 비율 · 표시 */}
      <div className="mt-auto pl-6">
        <div className="mb-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate tabular-nums" title="이 화면에서 찾은 버튼 · 링크 · 입력칸 중 테스트로 확인한 수">
            {elementRatioText(coverage.counts)}
          </span>
          {node.authRequired && (
            <span title="로그인해야 열리는 화면" className="shrink-0 text-warning">
              <Lock className="h-3.5 w-3.5" />
            </span>
          )}
          <span className="ml-auto flex shrink-0 gap-1 overflow-hidden">
            {data.entry && <Badge variant="info" className="px-1.5 py-0 text-[11px]" title="지도를 그리기 시작한 첫 화면">시작</Badge>}
            {node.excluded && (
              <Badge variant="warning" className="px-1.5 py-0 text-[11px]" title="테스트 생성에서 제외됨">
                제외됨
              </Badge>
            )}
            {node.stale && (
              <Badge variant="warning" className="px-1.5 py-0 text-[11px]" title={node.origin === 'SITE' ? '마지막 탐색에서 열리지 않았어요' : '코드에서 사라졌어요'}>
                사라짐
              </Badge>
            )}
          </span>
        </div>
        <CoverageBar counts={coverage.counts} />
      </div>

      {/* 흐름이 이 화면에서 막혔으면 빨간 말풍선으로 이유를 보여 준다 */}
      {stopped && (
        <div
          role="status"
          className="coverage-appear absolute left-1/2 top-full z-10 mt-3 w-72 -translate-x-1/2 rounded-lg bg-destructive px-3 py-2 text-xs leading-relaxed text-destructive-foreground shadow-lg"
        >
          <span aria-hidden="true" className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-destructive" />
          <p className="relative flex items-start gap-1.5">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <b className="font-semibold">여기서 막혔어요.</b> {play?.bubble}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

export const ScreenNode = memo(ScreenNodeView);
