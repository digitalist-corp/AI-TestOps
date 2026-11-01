import { Fragment } from 'react';
import { ChevronRight, ChevronsRight, ListChecks, Play, TriangleAlert } from 'lucide-react';
import type { CoverageFlow, CoverageStepState, SiteMapNode } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { FLOW_SOURCE_META, FLOW_STATUS_META, STEP_STATE_META, screenName, timeAgo, type IssueItem } from '@/lib/coverage';
import { cn } from '@/lib/utils';
import { IssueList, type IssueActionHandler } from './IssueList';

export type SidePanelTab = 'flows' | 'issues';

export const FLOW_PANEL_WIDTH = 312;

const STEP_CHIP: Record<CoverageStepState, string> = {
  PASSED: 'border-success/40 bg-success/10 text-success',
  FAILED: 'border-destructive/50 bg-destructive/10 text-destructive',
  NOT_REACHED: 'border-dashed border-border-strong bg-card text-muted-foreground',
  PENDING: 'border-border bg-card text-muted-foreground',
};

/** 흐름의 단계 칩 줄: 로그인 ✓ → 상품목록 ✓ → 결제 ✗ → 완료 ○ */
export function FlowSteps({ flow, nodeByRoute }: { flow: CoverageFlow; nodeByRoute: Map<string, SiteMapNode> }) {
  if (flow.steps.length === 0) {
    return <p className="text-xs text-muted-foreground">지나가는 화면을 아직 몰라요.</p>;
  }
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5" aria-label="단계">
      {flow.steps.map((step, i) => {
        const meta = STEP_STATE_META[step.state];
        const name = screenName(nodeByRoute.get(step.routeKey), step.routeKey);
        return (
          <Fragment key={i}>
            {i > 0 && (
              <li aria-hidden="true" className="text-xs text-muted-foreground">
                →
              </li>
            )}
            <li
              className={cn('inline-flex max-w-36 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', STEP_CHIP[step.state])}
              title={`${name} — ${meta.label}${step.message ? ` · ${step.message}` : ''}`}
            >
              <span className="truncate">{name}</span>
              <span aria-label={meta.label} className="font-bold">
                {meta.mark}
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

function FlowCard({ flow, nodeByRoute, playing, onPlay }: {
  flow: CoverageFlow;
  nodeByRoute: Map<string, SiteMapNode>;
  playing: boolean;
  onPlay: (flow: CoverageFlow) => void;
}) {
  const status = FLOW_STATUS_META[flow.lastStatus];
  const source = FLOW_SOURCE_META[flow.source];
  return (
    <li>
      <button
        type="button"
        onClick={() => onPlay(flow)}
        aria-pressed={playing}
        title={`지도에서 이 흐름 재생 (${flow.specPath})`}
        className={cn(
          'w-full cursor-pointer rounded-lg border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/60 hover:bg-accent/30',
          playing ? 'border-primary ring-2 ring-primary/30' : 'border-border'
        )}
        data-testid="structure-flow-card"
      >
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">{flow.title}</span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="neutral" className="px-1.5 py-0 text-[11px]" title={source.hint}>
                {source.label}
              </Badge>
              <Badge variant={status.tone} className="px-1.5 py-0 text-[11px]">
                {status.label}
              </Badge>
              {flow.lastRunAt && <span className="text-[11px] text-muted-foreground">{timeAgo(flow.lastRunAt)}</span>}
            </span>
          </span>
          <span
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors',
              playing ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground'
            )}
            aria-hidden="true"
          >
            <Play className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="mt-2.5">
          <FlowSteps flow={flow} nodeByRoute={nodeByRoute} />
        </div>
      </button>
    </li>
  );
}

/**
 * 그래프 오른쪽 패널: "테스트 흐름"과 "막힌 곳" 두 갈래. 접으면 얇은 띠만 남는다.
 * 흐름을 누르면 지도에서 그 경로를 재생하고, 막힌 곳 카드를 누르면 그 화면으로 이동한다.
 */
export function FlowPanel({
  open, onOpen, tab, onTab, flows, issues, nodeByRoute, playingSpec, onPlay,
  aiActive, onAction, busyKey, onSelectScreen,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  tab: SidePanelTab;
  onTab: (tab: SidePanelTab) => void;
  flows: CoverageFlow[];
  issues: IssueItem[];
  nodeByRoute: Map<string, SiteMapNode>;
  playingSpec: string | null;
  onPlay: (flow: CoverageFlow) => void;
  aiActive: boolean;
  onAction: IssueActionHandler;
  busyKey: string | null;
  onSelectScreen: (routeKey: string) => void;
}) {
  if (!open) {
    return (
      <div className="flex w-11 shrink-0 flex-col items-center gap-2 border-l border-border bg-card py-3">
        <button
          type="button"
          onClick={() => onOpen(true)}
          title="테스트 흐름 · 막힌 곳 펼치기"
          aria-label="테스트 흐름 · 막힌 곳 펼치기"
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4 rotate-180" />
        </button>
        <button
          type="button"
          onClick={() => {
            onTab('flows');
            onOpen(true);
          }}
          title={`테스트 흐름 ${flows.length}개`}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ListChecks className="h-4 w-4" />
        </button>
        {issues.length > 0 && (
          <button
            type="button"
            onClick={() => {
              onTab('issues');
              onOpen(true);
            }}
            title={`막힌 곳 ${issues.length}곳`}
            className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
          >
            <TriangleAlert className="h-4 w-4" />
            <span className="absolute -right-1 -top-1 rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-destructive-foreground">
              {issues.length}
            </span>
          </button>
        )}
      </div>
    );
  }

  const tabButton = (value: SidePanelTab, label: string, count: number, tone?: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === value}
      onClick={() => onTab(value)}
      className={cn(
        'flex flex-1 cursor-pointer items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-[13px] font-semibold transition-colors',
        tab === value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
      <span className={cn('rounded-full bg-muted px-1.5 text-[11px] tabular-nums leading-4', count > 0 && tone)}>{count}</span>
    </button>
  );

  return (
    <aside
      className="flex shrink-0 flex-col border-l border-border bg-card"
      style={{ width: FLOW_PANEL_WIDTH }}
      aria-label="테스트 흐름과 막힌 곳"
      data-testid="structure-flow-panel"
    >
      <div className="flex items-stretch border-b border-border">
        <div role="tablist" aria-label="패널 보기" className="flex flex-1">
          {tabButton('flows', '테스트 흐름', flows.length)}
          {tabButton('issues', '막힌 곳', issues.length, 'bg-destructive text-destructive-foreground')}
        </div>
        <button
          type="button"
          onClick={() => onOpen(false)}
          title="패널 접기"
          aria-label="패널 접기"
          className="flex w-9 cursor-pointer items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'flows' ? (
          flows.length === 0 ? (
            <div className="px-1 py-6 text-center text-sm text-muted-foreground">
              <p>아직 테스트 흐름이 없어요.</p>
              <p className="mt-1 text-xs">녹화하거나, 지도에서 화면을 이어 골라 테스트를 만들면 여기에 나타나요.</p>
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">흐름을 누르면 지도에서 지나간 길을 차례로 보여 줘요.</p>
              <ul className="space-y-2">
                {flows.map((flow) => (
                  <FlowCard key={flow.specPath} flow={flow} nodeByRoute={nodeByRoute} playing={playingSpec === flow.specPath} onPlay={onPlay} />
                ))}
              </ul>
            </>
          )
        ) : (
          <IssueList
            items={issues}
            aiActive={aiActive}
            onAction={onAction}
            busyKey={busyKey}
            onSelect={onSelectScreen}
            emptyText="막힌 곳이 없어요. 잘하고 있어요!"
          />
        )}
      </div>
    </aside>
  );
}
