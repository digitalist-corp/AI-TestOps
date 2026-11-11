import { useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { RoundChange, TestRound, TestRoundCase, TestRoundDetail } from '@/types';
import { CHANGE_META, caseLeaf } from '@/lib/rounds';
import { cn } from '@/lib/utils';
import { ChartBox, useChartTheme } from './ChartBox';

const TONE: Record<string, string> = {
  destructive: 'bg-destructive/10 text-destructive border-destructive/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  success: 'bg-success/10 text-success border-success/30',
  primary: 'bg-primary/10 text-primary border-primary/30',
  muted: 'bg-muted text-muted-foreground border-border',
};

/** 눈여겨볼 순서. 계속 통과 · 건너뜀은 접어 둔다. */
const SHOWN: RoundChange[] = ['NEW_FAIL', 'STILL_FAIL', 'FIXED', 'FIRST_RUN'];
const FOLDED: RoundChange[] = ['STILL_PASS', 'SKIPPED'];
const TREND_ROUNDS = 12;

export function changeToneClass(change: RoundChange) {
  return TONE[CHANGE_META[change].tone];
}

/** 차수별 통과 · 실패 막대. 막대를 누르면 그 차수를 고른다. */
export function RoundTrend({
  rounds,
  selectedId,
  onSelect,
}: {
  rounds: TestRound[];
  selectedId: number | null;
  onSelect: (executionId: number) => void;
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const recent = rounds.slice(0, TREND_ROUNDS).reverse();
    const bar = (name: string, color: string, pick: (r: TestRound) => number) => ({
      name,
      type: 'bar' as const,
      stack: 'cases',
      barMaxWidth: 34,
      itemStyle: { color },
      data: recent.map((r) => ({
        value: pick(r),
        executionId: r.executionId,
        itemStyle: r.executionId === selectedId ? { borderColor: t.strong, borderWidth: 2 } : undefined,
      })),
    });
    return {
      tooltip: { ...t.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: t.text, fontSize: 12 } },
      grid: { left: 40, right: 12, top: 16, bottom: 48 },
      xAxis: {
        type: 'category',
        data: recent.map((r) => `${r.round}차`),
        axisTick: { show: false },
        axisLabel: { color: t.text },
      },
      yAxis: { type: 'value', minInterval: 1, axisLabel: { color: t.text }, splitLine: { lineStyle: { color: t.grid } } },
      series: [
        bar('통과', '#10b981', (r) => r.passed),
        bar('실패', '#ef4444', (r) => r.failed),
        bar('건너뜀', '#94a3b8', (r) => r.skipped),
      ],
    };
  }, [rounds, selectedId, t]);

  return (
    <ChartBox
      option={option}
      height={240}
      label="최근 차수별 통과 · 실패 케이스 수 막대 차트"
      onClick={(data) => {
        const id = (data as { executionId?: number } | null)?.executionId;
        if (id) onSelect(id);
      }}
    />
  );
}

/** 고른 차수에서 지난번과 달라진 케이스. 실패는 이유 첫 줄을 함께 보여 준다. */
export function RoundChanges({ detail }: { detail: TestRoundDetail }) {
  const [showFolded, setShowFolded] = useState(false);
  const byChange = (change: RoundChange) => detail.cases.filter((c) => c.change === change);
  const folded = FOLDED.reduce((n, c) => n + detail.changes[c], 0);

  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-2" aria-label="지난번 대비 변화">
        {[...SHOWN, ...FOLDED].map((change) => (
          <li
            key={change}
            title={CHANGE_META[change].hint}
            className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', changeToneClass(change))}
          >
            {CHANGE_META[change].label} {detail.changes[change]}
          </li>
        ))}
      </ul>

      {SHOWN.map((change) => {
        const cases = byChange(change);
        if (!cases.length) return null;
        return <CaseGroup key={change} change={change} cases={cases} />;
      })}

      {folded > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowFolded((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={showFolded}
          >
            {showFolded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            그대로인 케이스 {folded}개 {showFolded ? '접기' : '보기'}
          </button>
          {showFolded && (
            <div className="mt-2 space-y-3">
              {FOLDED.map((change) => {
                const cases = byChange(change);
                return cases.length ? <CaseGroup key={change} change={change} cases={cases} /> : null;
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CaseGroup({ change, cases }: { change: RoundChange; cases: TestRoundCase[] }) {
  return (
    <section>
      <h5 className="mb-1 text-xs font-semibold text-muted-foreground">
        {CHANGE_META[change].label} · {cases.length}개
      </h5>
      <ul className="divide-y divide-border rounded-md border border-border">
        {cases.map((c, i) => (
          <li key={`${c.specPath}-${c.caseTitle}-${i}`} className="px-3 py-2 text-sm">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0 text-foreground">{caseLeaf(c.caseTitle) || c.caseTitle}</span>
              {c.previousRound != null && (
                <span className="shrink-0 text-xs text-muted-foreground">{c.previousRound}차와 비교</span>
              )}
            </div>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{c.specPath}</p>
            {c.status === 'FAILED' && c.errorMessage && (
              <p className="mt-0.5 line-clamp-2 text-xs text-destructive">{firstLine(c.errorMessage)}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function firstLine(message: string) {
  // 터미널 색 코드(ESC[..m)를 지우고 첫 줄만
  // eslint-disable-next-line no-control-regex
  return message.replace(/\u001b\[[0-9;]*m/g, '').split('\n').find((line) => line.trim()) ?? message;
}
