import { useEffect, useState } from 'react';
import type { ColGroupDef, ICellRendererParams } from 'ag-grid-community';
import { api } from '@/api/client';
import type { CaseFocus, PlanDailyResponse, PlanItem } from '@/types';
import { cellsByRow, dailyRowId, hasScheduledRuns, percent, shortDate } from '@/lib/planDaily';
import { cn } from '@/lib/utils';

/**
 * 계획 표 오른쪽 "정기 실행 (최근 7일)" 칸 (F-3). 계획 표와 따로 받아 행에 붙인다.
 * 성공 ✓ 초록 · 실패 ✗ 빨강(누르면 그 실행 결과) · 미실행 점선 빈칸. 맨 아래 고정 행은 일자별 통과율.
 */

/** 불러오지 못하면 null 그대로 — 계획 표는 날짜 칸 없이 보인다. */
export function usePlanDaily(projectId: string): PlanDailyResponse | null {
  const [daily, setDaily] = useState<PlanDailyResponse | null>(null);
  useEffect(() => {
    let alive = true;
    setDaily(null);
    api.plan
      .daily(projectId)
      .then((d) => alive && setDaily(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId]);
  return daily;
}

/** 고정 행(일자별 통과율). 계획 항목 칸은 그리지 않고 이름만 쓴다. */
export type DailyTotalRow = PlanItem & { dailyRates: (number | null)[] };

export function dailyTotalRow(rates: (number | null)[]): DailyTotalRow {
  return {
    specPath: '', grep: '\u0000daily-total', title: '일자별 통과율', describePath: '', line: 0,
    enabled: false, parentEnabled: false, sortOrder: null, assignee: null, assigneeUserId: null, dueDate: null,
    priority: null, lastStatus: null, lastRunAt: null, updatedByName: null, updatedAt: null,
    dailyRates: rates,
  };
}

/** defaultColDef 용: 고정 행에서는 기존 칸 대신 이 칸을 그린다 (체크박스 · 배지가 생기지 않게). */
export const pinnedRowSelector = (p: ICellRendererParams<PlanItem>) =>
  p.node.rowPinned ? { component: PinnedLabel } : undefined;

function PinnedLabel(p: ICellRendererParams<PlanItem>) {
  return p.colDef?.headerName === '계획 항목' ? <span className="font-medium text-foreground">{p.data?.title}</span> : null;
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

/** 정기 실행 기록이 없으면 빈 배열 — 화면은 칸 대신 안내를 보인다. */
export function dailyColumns(
  daily: PlanDailyResponse | null,
  onOpenExecution?: (executionId: number, focus?: CaseFocus) => void
): ColGroupDef<PlanItem>[] {
  if (!daily || !hasScheduledRuns(daily)) return [];
  const cells = cellsByRow(daily);
  return [
    {
      headerName: `정기 실행 (최근 ${daily.days.length}일)`,
      headerClass: 'text-center',
      children: daily.days.map((date, d) => ({
        colId: `daily-${date}`,
        headerName: shortDate(date),
        headerTooltip: `${date} (${WEEKDAY[new Date(`${date}T00:00:00`).getDay()]}) 03:00 정기 실행`,
        width: 64,
        resizable: false,
        cellClass: 'flex items-center justify-center !px-1',
        valueGetter: (p) =>
          p.node?.rowPinned
            ? (p.data as DailyTotalRow | undefined)?.dailyRates[d] ?? null
            : p.data ? cells.get(dailyRowId(p.data))?.[d]?.status ?? null : null,
        cellRendererSelector: () => ({ component: DailyCell }),
        cellRendererParams: { date, index: d, cells, onOpenExecution },
      })),
    },
  ];
}

function DailyCell(p: ICellRendererParams<PlanItem> & {
  date: string; index: number; cells: ReturnType<typeof cellsByRow>;
  onOpenExecution?: (executionId: number, focus?: CaseFocus) => void;
}) {
  const label = shortDate(p.date);
  if (p.node.rowPinned) {
    const rate = (p.data as DailyTotalRow | undefined)?.dailyRates[p.index] ?? null;
    return (
      <span className="text-xs font-semibold tabular-nums text-foreground" aria-label={`${label} 통과율 ${percent(rate)}`}>
        {percent(rate)}
      </span>
    );
  }
  if (!p.data) return null;
  const cell = p.cells.get(dailyRowId(p.data))?.[p.index];
  const box = 'inline-flex h-6 w-6 items-center justify-center rounded text-sm font-bold';
  if (cell?.status === 'PASSED') {
    return <span role="img" aria-label={`${label} 성공`} title={`${label} 성공`} className={cn(box, 'bg-success/15 text-success')}>✓</span>;
  }
  if (cell?.status === 'FAILED') {
    const { data, onOpenExecution } = p;
    const open = onOpenExecution && cell.executionId != null
      ? () => onOpenExecution(cell.executionId!, {
        specPath: data.specPath,
        title: [data.describePath, data.title].filter(Boolean).join(' > '),
      })
      : undefined;
    return (
      <button type="button" aria-label={`${label} 실패 · 결과 보기`} title={`${label} 실패 · 눌러서 결과 보기`}
              disabled={!open} onClick={open}
              className={cn(box, 'bg-destructive/15 text-destructive hover:bg-destructive/25 disabled:cursor-default')}>
        ✗
      </button>
    );
  }
  return <span role="img" aria-label={`${label} 미실행`} title={`${label} 미실행`} className={cn(box, 'border border-dashed border-border-strong')} />;
}
