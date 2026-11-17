import { useEffect, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { ClipboardList, Loader2, Play, X } from 'lucide-react';
import { api } from '@/api/client';
import type { PlanItem, PlanItemKey, PlanPriority, TestSuite } from '@/types';
import { Button } from '@/components/ui/Button';
import { casesByScreen } from '@/lib/rounds';
import { PRIORITY_LABEL, inSuite, planCounts, planKey, screenNameByCase } from '@/lib/plan';
import { useAccess } from '@/lib/access';
import { formatRelative } from '@/lib/utils';

ModuleRegistry.registerModules([AllCommunityModule]);

type Change = Partial<Pick<PlanItem, 'enabled' | 'assignee' | 'dueDate' | 'priority'>>;

const rowId = (i: PlanItemKey) => `${i.specPath}\n${i.grep}`;
const keyOf = (i: PlanItem): PlanItemKey => ({ specPath: i.specPath, grep: i.grep });

const RESULT_VIEW: Record<'PASSED' | 'FAILED' | 'NONE', { label: string; className: string }> = {
  PASSED: { label: '성공', className: 'bg-success/10 text-success' },
  FAILED: { label: '실패', className: 'bg-destructive/10 text-destructive' },
  NONE: { label: '미수행', className: 'bg-muted text-muted-foreground' },
};

const PRIORITY_OPTIONS = ['', 'HIGH', 'MEDIUM', 'LOW'];

/**
 * 테스트 계획 표(F-1). 케이스 하나 = 계획 항목 하나.
 * 셀을 고치면 바로 저장하고, 저장이 실패하면 원래 값으로 되돌린다. 체크한(사용 중) 항목만 실행된다.
 * readOnly(팀원): 고치지 못하고 보기 · 실행만 한다.
 */
export function PlanTab({ projectId, onRun, readOnly = false }: { projectId: string; onRun: () => void; readOnly?: boolean }) {
  const { me } = useAccess();
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const [screens, setScreens] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<PlanItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [suites, setSuites] = useState<TestSuite[]>([]);
  // '' = 전체. 스위트를 고르면 그 스위트 항목만 보이고, 순서 끌어 옮기기는 끈다(일부만 다시 번호 매기지 않도록).
  const [suiteId, setSuiteId] = useState('');

  useEffect(() => {
    let alive = true;
    api.plan
      .get(projectId)
      .then((p) => alive && setItems(p.items))
      .catch(() => alive && setNotice('계획 표를 불러오지 못했어요.'));
    api.testSuites
      .listByProject(projectId)
      .then((list) => alive && setSuites(list))
      .catch(() => {});
    Promise.all([
      api.getScenarios(projectId),
      api.getSiteMap(projectId).catch(() => null),
      api.getSiteMapCoverage(projectId).catch(() => null),
    ])
      .then(([scenarios, map, coverage]) => {
        if (!alive) return;
        const groups = casesByScreen({
          nodes: map?.nodes ?? [],
          flows: coverage?.flows ?? [],
          specs: scenarios.specs,
          results: [],
        });
        setScreens(screenNameByCase(groups));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId]);

  const replace = (next: PlanItem) =>
    setItems((list) => list?.map((i) => (rowId(i) === rowId(next) ? next : i)) ?? list);

  const save = (before: PlanItem, change: Change) => {
    // 최근 수정은 저장하면 서버도 나로 바뀌므로 화면에서 먼저 바꿔 둔다.
    const after = { ...before, ...change, updatedByName: me?.displayName || me?.username || null, updatedAt: new Date().toISOString() };
    replace(after);
    setNotice(null);
    api.plan
      .patch(projectId, {
        ...keyOf(after),
        ...('enabled' in change ? { enabled: after.enabled } : {}),
        assignee: after.assignee,
        dueDate: after.dueDate,
        priority: after.priority,
      })
      .catch(() => {
        replace(before);
        setNotice('저장하지 못했어요. 다시 시도해 주세요.');
      });
  };

  const setEnabledMany = (all: PlanItem[], enabled: boolean) => {
    // 파일 · 묶음이 꺼진 행은 켜도 실행되지 않으므로 건드리지 않는다.
    const targets = all.filter((i) => i.parentEnabled);
    if (targets.length === 0) return;
    const before = items;
    const ids = new Set(targets.map(rowId));
    setItems((list) => list?.map((i) => (ids.has(rowId(i)) ? { ...i, enabled } : i)) ?? list);
    api.plan.setEnabled(projectId, targets.map(keyOf), enabled).catch(() => {
      setItems(before);
      setNotice('저장하지 못했어요. 다시 시도해 주세요.');
    });
  };

  const columnDefs = useMemo<ColDef<PlanItem>[]>(
    () => [
      {
        headerName: '사용',
        width: 76,
        // 값이 있어야 사용 여부가 바뀔 때(저장 실패로 되돌릴 때 포함) 칸을 다시 그린다.
        valueGetter: (p) => p.data?.enabled,
        cellRenderer: (p: ICellRendererParams<PlanItem>) =>
          p.data ? (
            <input
              type="checkbox"
              aria-label={`${p.data.title} 사용`}
              checked={p.data.enabled}
              disabled={readOnly || !p.data.parentEnabled}
              title={p.data.parentEnabled ? undefined : '파일이나 묶음이 꺼져 있어요. 계획 › 테스트에서 먼저 켜 주세요.'}
              onChange={(e) => save(p.data!, { enabled: e.target.checked })}
              className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
            />
          ) : null,
      },
      {
        headerName: '순서',
        width: 80,
        rowDrag: !readOnly && suiteId === '',
        valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1,
      },
      {
        headerName: '계획 항목',
        flex: 2,
        minWidth: 220,
        filter: true,
        valueGetter: (p) => p.data?.title,
        tooltipValueGetter: (p) => p.data && `파일: ${p.data.specPath} (${p.data.line}줄)`,
        cellRenderer: (p: ICellRendererParams<PlanItem>) =>
          p.data ? (
            <span>
              {p.data.describePath && <span className="mr-1 text-muted-foreground">{p.data.describePath} ›</span>}
              {p.data.title}
            </span>
          ) : null,
      },
      {
        headerName: '화면',
        flex: 1,
        minWidth: 120,
        filter: true,
        valueGetter: (p) => (p.data ? screens.get(planKey(p.data.specPath, p.data.title)) ?? '미지정' : ''),
      },
      {
        headerName: '담당자',
        width: 120,
        filter: true,
        editable: !readOnly,
        valueGetter: (p) => p.data?.assignee ?? '',
        valueSetter: (p) => {
          const v = String(p.newValue ?? '').trim();
          save(p.data, { assignee: v || null });
          return false;
        },
      },
      {
        headerName: '마감일',
        width: 140,
        editable: !readOnly,
        cellEditor: 'agDateStringCellEditor',
        valueGetter: (p) => p.data?.dueDate ?? '',
        valueSetter: (p) => {
          save(p.data, { dueDate: p.newValue || null });
          return false;
        },
      },
      {
        headerName: '우선순위',
        width: 110,
        editable: !readOnly,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: PRIORITY_OPTIONS },
        refData: { '': '없음', ...PRIORITY_LABEL },
        valueGetter: (p) => p.data?.priority ?? '',
        valueSetter: (p) => {
          save(p.data, { priority: (p.newValue || null) as PlanPriority | null });
          return false;
        },
      },
      {
        headerName: '최근 결과',
        width: 110,
        valueGetter: (p) => p.data?.lastStatus ?? 'NONE',
        cellRenderer: (p: ICellRendererParams<PlanItem>) => {
          const view = RESULT_VIEW[(p.value as keyof typeof RESULT_VIEW) ?? 'NONE'];
          return <span className={`rounded px-2 py-0.5 text-xs font-medium ${view.className}`}>{view.label}</span>;
        },
      },
      {
        headerName: '최근 수정',
        width: 150,
        valueGetter: (p) =>
          p.data?.updatedAt ? [p.data.updatedByName, formatRelative(p.data.updatedAt)].filter(Boolean).join(' · ') : '',
      },
    ],
    // save · setItems 는 매번 새로 만들어지지만 최신 상태를 쓰므로 화면 이름이 바뀔 때만 열을 다시 만든다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [screens, projectId, suiteId, readOnly]
  );

  if (!items) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        {notice ?? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
          </>
        )}
      </div>
    );
  }

  const enabledCount = items.filter((i) => i.enabled).length;
  const suite = suites.find((x) => String(x.id) === suiteId) ?? null;
  const shown = suite ? items.filter((i) => inSuite(suite, i)) : items;
  const counts = planCounts(shown);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 @5xl:flex-row @5xl:items-end @5xl:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <ClipboardList className="h-5 w-5 text-primary" />
            테스트 계획
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            사용 중 {enabledCount}건 · 미사용 {items.length - enabledCount}건.
            {readOnly ? ' 계획은 PM이 정해요. 보고 실행할 수 있어요.' : ' 칸을 두 번 눌러 고치고, 순서 칸을 끌어 옮겨요.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!readOnly && selected.length > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={() => setEnabledMany(selected, true)}>
                선택한 {selected.length}건 사용
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEnabledMany(selected, false)}>
                선택한 {selected.length}건 미사용
              </Button>
            </>
          )}
          <Button size="sm" onClick={onRun} disabled={enabledCount === 0}>
            <Play className="h-4 w-4" />
            체크한 {enabledCount}건 실행
          </Button>
        </div>
      </div>

      {suites.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="스위트"
            value={suiteId}
            onChange={(e) => setSuiteId(e.target.value)}
            className="h-9 rounded-sm border border-border bg-card px-3 text-sm text-foreground hover:border-border-strong"
          >
            <option value="">스위트: 전체</option>
            {suites.map((x) => (
              <option key={x.id} value={x.id}>
                스위트: {x.name}
              </option>
            ))}
          </select>
          <span className="text-sm text-muted-foreground">
            성공 {counts.passed} · 실패 {counts.failed} · 미수행 {counts.notRun} · 미사용 {counts.disabled}
          </span>
          {suite && <span className="text-xs text-muted-foreground">스위트를 고른 동안에는 순서를 옮길 수 없어요.</span>}
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          <span className="flex-1">{notice}</span>
          <button type="button" aria-label="알림 닫기" onClick={() => setNotice(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="ag-theme-playops overflow-hidden rounded-xl border border-border" style={{ height: 560 }}>
        <AgGridReact<PlanItem>
          theme="legacy"
          rowData={shown}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: false, resizable: true }}
          getRowId={(p) => rowId(p.data)}
          rowDragManaged
          rowSelection={{ mode: 'multiRow', checkboxes: false, headerCheckbox: false, enableClickSelection: true }}
          onSelectionChanged={(e) => setSelected(e.api.getSelectedRows())}
          onRowDragEnd={(e) => {
            if (suite) return;
            const ordered: PlanItem[] = [];
            e.api.forEachNode((n) => n.data && ordered.push(n.data));
            setItems(ordered);
            api.plan.reorder(projectId, ordered.map(keyOf)).catch(() => setNotice('순서를 저장하지 못했어요.'));
          }}
          tooltipShowDelay={300}
          overlayNoRowsTemplate="테스트 케이스가 없어요. 계획 › 테스트에서 테스트 파일을 만들어 주세요."
        />
      </div>
    </div>
  );
}
