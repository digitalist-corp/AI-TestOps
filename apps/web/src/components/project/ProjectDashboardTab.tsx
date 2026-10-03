import { useEffect, useMemo, useRef } from 'react';
import type { ECharts, EChartsOption } from 'echarts';
import { BarChart3, Clock3, FileCode, Play, TimerReset } from 'lucide-react';
import type { Execution, ExecutionStatus, Project } from '@/types';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme';

const statusLabel: Record<ExecutionStatus, string> = {
  SCHEDULED: '예약됨',
  PENDING: '대기',
  RUNNING: '실행 중',
  CANCEL_REQUESTED: '중단 중',
  CANCELLED: '중단됨',
  PASSED: '성공',
  FAILED: '실패',
  ERROR: '오류',
};

const statusTone: Record<ExecutionStatus, string> = {
  SCHEDULED: 'bg-ai-accent/10 text-ai-accent',
  PENDING: 'bg-muted text-muted-foreground',
  RUNNING: 'bg-primary/10 text-primary',
  CANCEL_REQUESTED: 'bg-warning/10 text-warning',
  CANCELLED: 'bg-muted text-muted-foreground',
  PASSED: 'bg-success/10 text-success',
  FAILED: 'bg-destructive/10 text-destructive',
  ERROR: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
};

function formatShortDate(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(durationMs: number | null) {
  if (durationMs == null) return '-';
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}초`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return seconds ? `${totalMinutes}분 ${seconds}초` : `${totalMinutes}분`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}시간 ${minutes}분` : `${hours}시간`;
}

function formatDurationAxis(durationMs: number) {
  if (durationMs < 60_000) return `${Math.round(durationMs / 1000)}초`;
  return `${Math.round(durationMs / 60_000)}분`;
}

function formatDurationForChart(durationMs: number) {
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}초`;
  const minutes = durationMs / 60_000;
  const minuteText = minutes >= 10 ? Math.round(minutes).toString() : minutes.toFixed(1);
  return `${minuteText}분 (${formatDuration(durationMs)})`;
}

function percent(value: number, total: number) {
  if (total === 0) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}

function ChartBox({ option }: { option: EChartsOption }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    let chart: ECharts | null = null;
    let disposed = false;

    import('echarts').then((echarts) => {
      if (!ref.current || disposed) return;
      chart = echarts.init(ref.current);
      chart.setOption(option);
    });

    const resize = () => chart?.resize();
    window.addEventListener('resize', resize);
    return () => {
      disposed = true;
      window.removeEventListener('resize', resize);
      chart?.dispose();
    };
  }, [option]);

  return <div ref={ref} className="h-[260px] w-full" />;
}

export function ProjectDashboardTab({
  project,
  executions,
  onRun,
  onOpenSource,
  onOpenRuns,
  onOpenResults,
}: {
  project: Project;
  executions: Execution[];
  onRun: () => void;
  onOpenSource: () => void;
  onOpenRuns: () => void;
  onOpenResults: () => void;
}) {
  const { theme } = useTheme();
  const axisTextColor = theme === 'dark' ? '#94a3b8' : '#475569';
  const splitLineColor = theme === 'dark' ? '#1e293b' : '#e2e8f0';
  const latest = executions[0] ?? null;
  const completed = executions.filter((execution) =>
    execution.status === 'PASSED'
    || execution.status === 'FAILED'
    || execution.status === 'ERROR'
    || execution.status === 'CANCELLED'
  );
  const durationSamples = completed.filter((execution) => execution.durationMs != null);
  const statusCounts = executions.reduce<Record<ExecutionStatus, number>>((counts, execution) => {
    counts[execution.status] += 1;
    return counts;
  }, {
    SCHEDULED: 0,
    PENDING: 0,
    RUNNING: 0,
    CANCEL_REQUESTED: 0,
    CANCELLED: 0,
    PASSED: 0,
    FAILED: 0,
    ERROR: 0,
  });
  const totalDuration = durationSamples.reduce((sum, execution) => sum + (execution.durationMs ?? 0), 0);
  const avgDuration = durationSamples.length
    ? Math.round(totalDuration / durationSamples.length)
    : null;
  const successRateBase = statusCounts.PASSED + statusCounts.FAILED + statusCounts.ERROR;

  const statusOption = useMemo<EChartsOption>(() => ({
    color: ['#10b981', '#ef4444', '#f97316', '#64748b', '#f59e0b', '#3b82f6', '#8b5cf6', '#94a3b8'],
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c}건 ({d}%)',
    },
    legend: {
      bottom: 0,
      left: 'center',
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: axisTextColor, fontSize: 12 },
    },
    series: [
      {
        type: 'pie',
        radius: ['48%', '72%'],
        center: ['50%', '40%'],
        avoidLabelOverlap: true,
        label: { show: false },
        emphasis: {
          label: {
            show: true,
            formatter: '{b}\n{c}건',
            fontSize: 13,
            fontWeight: 600,
          },
        },
        labelLine: { show: false },
        data: [
          { name: '성공', value: statusCounts.PASSED },
          { name: '실패', value: statusCounts.FAILED },
          { name: '오류', value: statusCounts.ERROR },
          { name: '중단됨', value: statusCounts.CANCELLED },
          { name: '중단 중', value: statusCounts.CANCEL_REQUESTED },
          { name: '실행 중', value: statusCounts.RUNNING },
          { name: '예약됨', value: statusCounts.SCHEDULED },
          { name: '대기', value: statusCounts.PENDING },
        ].filter((item) => item.value > 0),
      },
    ],
  }), [statusCounts, axisTextColor]);

  const durationOption = useMemo<EChartsOption>(() => {
    const recent = [...executions].slice(0, 8).reverse();
    return {
      color: ['#2563eb'],
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value: unknown) => formatDurationForChart(Number(value)),
      },
      grid: { left: 56, right: 18, top: 24, bottom: 36 },
      xAxis: {
        type: 'category',
        data: recent.map((execution) => `#${execution.id}`),
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: (value: number) => formatDurationAxis(value),
        },
        splitLine: { lineStyle: { color: splitLineColor } },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 34,
          data: recent.map((execution) => execution.durationMs ?? 0),
          itemStyle: { borderRadius: [4, 4, 0, 0] },
        },
      ],
    };
  }, [executions, splitLineColor]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 @5xl:flex-row @5xl:items-center @5xl:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">프로젝트 대시보드</h3>
          <p className="text-sm text-muted-foreground mt-1">{project.projectName}의 실행 상태와 최근 결과를 한눈에 봅니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onRun}>
            <Play className="h-4 w-4" />
            전체 실행
          </Button>
          <Button size="sm" variant="outline" onClick={onOpenSource}>
            <FileCode className="h-4 w-4" />
            소스
          </Button>
          <Button size="sm" variant="outline" onClick={onOpenRuns}>
            <Clock3 className="h-4 w-4" />
            이력
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 @3xl:grid-cols-2 @7xl:grid-cols-5 gap-3">
        {[
          ['최종 결과', latest ? statusLabel[latest.status] : '-', latest?.status],
          ['성공률', percent(statusCounts.PASSED, successRateBase), null],
          ['평균 소요', formatDuration(avgDuration), null],
          ['전체 소요', formatDuration(durationSamples.length ? totalDuration : null), null],
          ['실행 건수', `${executions.length}건`, null],
        ].map(([label, value, status]) => (
          <div key={label} className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            {status ? (
              <span className={cn('mt-2 inline-flex px-2 py-0.5 rounded-full text-sm font-medium', statusTone[status as ExecutionStatus])}>
                {value}
              </span>
            ) : (
              <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 @7xl:grid-cols-2 gap-4">
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold text-foreground">상태 분포</h4>
          </div>
          {executions.length ? <ChartBox option={statusOption} /> : <EmptyChart />}
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <TimerReset className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold text-foreground">최근 실행 소요시간</h4>
          </div>
          {executions.length ? <ChartBox option={durationOption} /> : <EmptyChart />}
        </section>
      </div>

      <section className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h4 className="text-sm font-semibold text-foreground">최근 실행</h4>
          <Button size="sm" variant="outline" onClick={onOpenResults} disabled={!latest}>
            결과 보기
          </Button>
        </div>
        <div className="divide-y divide-border">
          {executions.slice(0, 5).map((execution) => (
            <button
              key={execution.id}
              type="button"
              className="grid w-full grid-cols-[72px_minmax(180px,1fr)_96px_96px_150px] items-center gap-3 px-4 py-3 text-left text-sm hover:bg-accent"
              onClick={onOpenResults}
            >
              <span className="font-mono text-muted-foreground">#{execution.id}</span>
              <span className="truncate text-foreground">{execution.caseTitle ?? execution.grepFilter ?? '전체 실행'}</span>
              <span className={cn('w-fit px-2 py-0.5 rounded-full text-xs font-medium', statusTone[execution.status])}>
                {statusLabel[execution.status]}
              </span>
              <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDuration(execution.durationMs)}</span>
              <span className="whitespace-nowrap text-right text-xs text-muted-foreground">{formatShortDate(execution.startedAt ?? execution.createdAt)}</span>
            </button>
          ))}
          {executions.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">아직 실행 이력이 없습니다.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[260px] items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">
      실행 데이터가 쌓이면 차트가 표시됩니다.
    </div>
  );
}
