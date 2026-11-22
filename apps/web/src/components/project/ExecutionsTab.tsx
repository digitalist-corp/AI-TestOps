import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { Info, RefreshCw, RotateCcw, Square, Trash2 } from 'lucide-react';
import type { Execution, ExecutionStatus } from '@/types';
import { Button } from '@/components/ui/Button';
import { ExecutionLogPanel } from '@/components/project/ExecutionLogPanel';
import { RoundResults } from '@/components/dashboard/RoundResults';
import { cn, executionStatusLabel, formatDuration } from '@/lib/utils';

const statusStyle: Record<ExecutionStatus, string> = {
  SCHEDULED: 'bg-ai-accent/10 text-ai-accent',
  PENDING: 'bg-muted text-muted-foreground',
  RUNNING: 'bg-primary/10 text-primary',
  CANCEL_REQUESTED: 'bg-warning/10 text-warning',
  CANCELLED: 'bg-muted text-muted-foreground',
  PASSED: 'bg-success/10 text-success',
  FAILED: 'bg-destructive/10 text-destructive',
  ERROR: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
};

interface Props {
  projectId: string;
  executions: Execution[];
  loading: boolean;
  activeExecutionId: number | null;
  onRefresh: () => void;
  onSelect: (id: number) => void;
  onCancel: (id: number) => void;
  onDelete: (id: number) => void;
  onReset: () => void;
  selectedId: number | null;
  /** 이력 삭제 · 초기화는 PM · 관리자만 (서버도 막는다). 팀원은 보기 · 중지만 */
  canManage?: boolean;
}

export function ExecutionsTab({
  projectId,
  executions,
  loading,
  activeExecutionId,
  onRefresh,
  onSelect,
  onCancel,
  onDelete,
  onReset,
  selectedId,
  canManage = true,
}: Props) {
  const streamId =
    activeExecutionId ??
    executions.find((e) => e.status === 'RUNNING' || e.status === 'PENDING' || e.status === 'CANCEL_REQUESTED')?.id ??
    null;
  const selectedExecution = executions.find((execution) => execution.id === selectedId) ?? null;
  const selectedDeletable = selectedExecution ? isDeletable(selectedExecution.status) : false;

  const columnDefs: ColDef<Execution>[] = [
    { field: 'id', headerName: '번호', width: 70 },
    {
      field: 'status',
      headerName: '상태',
      width: 100,
      cellRenderer: (p: ICellRendererParams<Execution>) =>
        p.value ? (
          <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', statusStyle[p.value as ExecutionStatus])}>
            {executionStatusLabel[p.value as ExecutionStatus]}
          </span>
        ) : null,
    },
    {
      field: 'caseTitle',
      headerName: '케이스',
      flex: 1,
      valueFormatter: (p) =>
        `${p.value ?? p.data?.grepFilter ?? '전체'}${p.data?.rerunOf ? ` · #${p.data.rerunOf} 다시 실행` : ''}`,
    },
    {
      field: 'passedTests',
      headerName: '결과',
      width: 120,
      valueGetter: (p) => (p.data ? `${p.data.passedTests}/${p.data.totalTests}` : ''),
    },
    {
      field: 'durationMs',
      headerName: '소요',
      width: 90,
      valueFormatter: (p) => formatDuration(p.value) || '-',
    },
    {
      field: 'createdAt',
      headerName: '시작',
      flex: 1,
      valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleString('ko-KR') : '-'),
    },
    {
      headerName: '',
      width: 92,
      sortable: false,
      resizable: false,
      cellRenderer: (p: ICellRendererParams<Execution>) => {
        const execution = p.data;
        const cancellable = execution?.status === 'PENDING' || execution?.status === 'RUNNING';
        const deletable = execution ? isDeletable(execution.status) : false;
        return execution ? (
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              disabled={!cancellable}
              onClick={(event) => {
                event.stopPropagation();
                onCancel(execution.id);
              }}
              title="실행 중단"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
            {canManage && <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              disabled={!deletable}
              onClick={(event) => {
                event.stopPropagation();
                onDelete(execution.id);
              }}
              title={deletable ? '이력 삭제' : '실행 중인 이력은 삭제할 수 없습니다'}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>}
          </div>
        ) : null;
      },
    },
  ];

  return (
    <div className="space-y-4">
      {/* 버튼은 오른쪽에 모은다 — 넓은 화면에서 줄 전체로 흩어지지 않게 (#108) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium text-foreground">실행 이력</h3>
          <p className="text-xs text-muted-foreground mt-0.5">전체 실행은 상단 버튼, 케이스 실행은 시나리오 탭에서 시작합니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            새로고침
          </Button>
          {canManage && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => selectedId && onDelete(selectedId)}
                disabled={!selectedDeletable}
                title={selectedExecution && !selectedDeletable ? '실행 중인 이력은 삭제할 수 없습니다' : undefined}
              >
                <Trash2 className="h-4 w-4" />
                선택 삭제
              </Button>
              <Button size="sm" variant="outline" onClick={onReset} disabled={executions.length === 0}>
                <RotateCcw className="h-4 w-4" />
                전체 초기화
              </Button>
            </>
          )}
        </div>
      </div>

      <RoundResults
        projectId={projectId}
        runKey={executions.map((e) => `${e.id}:${e.status}`).join(',')}
        onOpenExecution={onSelect}
      />

      <ExecutionLogPanel executionId={streamId} />

      <div className="ag-theme-playops rounded-xl border border-border overflow-hidden" style={{ height: 300 }}>
        <AgGridReact
          rowData={executions}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true }}
          theme="legacy"
          rowSelection={{ mode: 'singleRow' }}
          onRowClicked={(e) => e.data && onSelect(e.data.id)}
          getRowClass={(p) => (p.data?.id === selectedId ? 'bg-primary/10' : '')}
          overlayNoRowsTemplate="실행 이력이 없습니다"
        />
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <p>
          현재 실행 큐는 동시에 2개만 실행하고, 이후 요청은 최대 20개까지 대기합니다. 대기열이 가득 차면
          추가 실행은 거절됩니다. 중단 버튼은 대기 중인 실행은 즉시 취소하고, 실행 중인 테스트는 중단 요청 후
          종료 처리합니다.
        </p>
      </div>
    </div>
  );
}

function isDeletable(status: ExecutionStatus) {
  return status !== 'PENDING'
    && status !== 'RUNNING'
    && status !== 'CANCEL_REQUESTED';
}
