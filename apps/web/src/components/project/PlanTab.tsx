import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { ArrowLeft, ClipboardList, Download, Loader2, Play, X } from 'lucide-react';
import { api } from '@/api/client';
import type { CaseFocus, PlanEntryPatch, PlanItem, PlanItemKey, PlanPriority, PlanResponse, ProjectMember, TestSuite } from '@/types';
import { Button } from '@/components/ui/Button';
import { casesByScreen } from '@/lib/rounds';
import { PRIORITY_LABEL, assigneeLabel, inSuite, planCounts, planKey, planSpecPath, screenNameByCase } from '@/lib/plan';
import { useAccess } from '@/lib/access';
import { formatRelative } from '@/lib/utils';
import { downloadCsv } from '@/lib/csv';
import { cellsByRow, dailyPassRates, hasScheduledRuns, percent } from '@/lib/planDaily';
import { PLAN_TITLE_ERROR, planMemberName, planScreenName, validPlanTitle, type PlanScreen } from '@/lib/planPaste';
import { projectTabPath } from '@/config/projectWorkspace';
import { AddPlanDialog, LinkPlanDialog, PastePlanDialog, PlanSuggestionsDialog, planError } from './PlanDialogs';
import { dailyColumns, dailyTotalRow, pinnedRowSelector, usePlanDaily } from './planDaily';

ModuleRegistry.registerModules([AllCommunityModule]);

type Change = Partial<Pick<PlanItem, 'title' | 'screenRouteKey' | 'expected' | 'assignee' | 'assigneeUserId' | 'dueDate' | 'priority'>>;
type PlanDialog = { kind: 'add' | 'paste' | 'suggestions' } | { kind: 'link'; planId: number };

const rowId = (i: PlanItem) => i.planId == null ? `${i.specPath}|${i.grep}` : `plan:${i.planId}`;
const keyOf = (i: PlanItem): PlanItemKey => ({
  specPath: i.specPath, grep: i.grep, ...(i.planId == null ? {} : { planId: i.planId }),
});

const MAX_GENERATE = 10;
const AI_WRITING = new Set(['PENDING', 'RUNNING', 'DIFF_READY']);
const AI_REVIEW = new Set(['PROPOSED', 'NEEDS_REVIEW']);

function writingState(item: PlanItem) {
  if (item.stage === 'WRITTEN') return '작성됨';
  if (AI_WRITING.has(item.aiJobStatus ?? '')) return 'AI 작성 중';
  if (AI_REVIEW.has(item.aiJobStatus ?? '')) return '검토 대기';
  return '미작성';
}

const STAGE_STYLE = {
  '미작성': 'bg-muted text-muted-foreground',
  'AI 작성 중': 'bg-primary/10 text-primary',
  '검토 대기': 'bg-warning/15 text-warning',
  '작성됨': 'bg-success/10 text-success',
};

function entryFields(item: PlanItem, metadataOnly: boolean): PlanEntryPatch {
  const metadata = { screenRouteKey: item.screenRouteKey, expected: item.expected };
  return metadataOnly ? metadata : {
    ...metadata, title: item.title, enabled: item.enabled, assigneeUserId: item.assigneeUserId,
    dueDate: item.dueDate, priority: item.priority,
  };
}

function summarize(items: PlanItem[]) {
  const enabled = items.filter((item) => item.enabled).length;
  const written = items.filter((item) => item.enabled && item.stage === 'WRITTEN').length;
  const counts = planCounts(items);
  return {
    ...counts, total: items.length, enabled, written, unwritten: enabled - written,
    writtenRate: enabled ? written / enabled : 0, completionRate: enabled ? counts.passed / enabled : 0,
  };
}

const RESULT_VIEW: Record<'PASSED' | 'FAILED' | 'NONE', { label: string; className: string }> = {
  PASSED: { label: '성공', className: 'bg-success/10 text-success' },
  FAILED: { label: '실패', className: 'bg-destructive/10 text-destructive' },
  NONE: { label: '미수행', className: 'bg-muted text-muted-foreground' },
};

const PRIORITY_OPTIONS = ['', 'HIGH', 'MEDIUM', 'LOW'];

/** 엑셀 내보내기 판정 표기 (설계 2-2). 지금 데이터는 통과 · 실패 · 미수행 3값 */
const VERDICT_EXPORT = { PASSED: 'Pass', FAILED: 'Fail' } as const;

function defectLabel(item: PlanItem) {
  if (!item.enabled) return '';
  if (item.defectStatus === 'OPEN') return `미해결 · ${item.defectFailCount}회 연속 실패`;
  return item.defectStatus === 'RESOLVED' ? '해결' : '';
}

/** 계획 표를 표준 TC 칸 순서로. 대분류는 화면 이름, 모르면 파일 경로 */
function planCsvRows(items: PlanItem[], screenLabel: (item: PlanItem) => string | undefined) {
  return [
    ['TC ID', '대분류', '케이스명', '사용', '담당자', '마감일', '우선순위', '판정', '최근 실행', '직전 결과', '결함', '작성 상태', '확인할 내용'],
    ...items.map((i, n) => [
      `TC-${String(n + 1).padStart(3, '0')}`,
      screenLabel(i) ?? i.specPath,
      i.title,
      i.enabled ? '사용' : '미사용',
      assigneeLabel(i),
      i.dueDate ?? '',
      i.priority ? PRIORITY_LABEL[i.priority] : '',
      i.lastStatus ? VERDICT_EXPORT[i.lastStatus] : 'Untested',
      i.lastRunAt ?? '',
      i.prevStatus ? VERDICT_EXPORT[i.prevStatus] : 'Untested',
      defectLabel(i),
      writingState(i),
      i.expected ?? '',
    ]),
  ];
}

/**
 * 담당자 칸 값: '' = 미지정, 't:이름' = 계정과 잇지 못한 옛 이름 그대로, 그 밖은 멤버 사용자 id.
 * 고르기 목록은 행 없이 값만으로 이름을 그리므로 옛 이름을 값 안에 담는다.
 */
const TEXT_PREFIX = 't:';

/**
 * 테스트 계획 표. 계획부터 만들고 테스트 케이스를 연결할 수 있다.
 * 셀을 고치면 바로 저장하고, 저장이 실패하면 원래 값으로 되돌린다. 체크한(사용 중) 항목만 실행된다.
 * readOnly(팀원): 고치지 못하고 보기 · 실행만 한다.
 */
export function PlanTab({ projectId, onRun, onOpenDefects, readOnly = false, runDisabled = false, aiOff = false, onOpenExecution }: {
  projectId: string; onRun: () => void; onOpenDefects?: () => void; readOnly?: boolean;
  /** 이 프로젝트의 테스트가 이미 돌고 있으면 실행 버튼을 잠근다 */
  runDisabled?: boolean;
  aiOff?: boolean;
  /** 정기 실행 칸의 실패를 누르면 그 실행 결과로 (F-3) */
  onOpenExecution?: (executionId: number, focus?: CaseFocus) => void;
}) {
  const { me } = useAccess();
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const items = plan?.items;
  const setItems = useCallback((update: (previous: PlanItem[]) => PlanItem[]) => {
    setPlan((previous) => {
      if (!previous) return previous;
      const items = update(previous.items);
      return { ...previous, items, summary: summarize(items) };
    });
  }, []);
  const [routeNodes, setRouteNodes] = useState<PlanScreen[]>([]);
  const [dialog, setDialog] = useState<PlanDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const rowWrites = useRef(new Map<string, Promise<void>>());
  const revision = useRef(0);
  const [screens, setScreens] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<PlanItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  // '' = 전체. 스위트를 고르면 그 스위트 항목만 보이고, 순서 끌어 옮기기는 끈다(일부만 다시 번호 매기지 않도록).
  const [suiteId, setSuiteId] = useState('');
  // 정기 실행 날짜 칸 (F-3). 계획 표와 따로 받아 붙인다.
  const daily = usePlanDaily(projectId);

  useEffect(() => {
    let alive = true;
    api.plan
      .get(projectId)
      .then((p) => alive && setPlan(p))
      .catch(() => alive && setNotice('계획 표를 불러오지 못했어요.'));
    api.testSuites
      .listByProject(projectId)
      .then((list) => alive && setSuites(list))
      .catch(() => {});
    api.members
      .list(projectId)
      .then((list) => alive && setMembers(list))
      .catch(() => {});
    const siteMap = api.getSiteMap(projectId).catch(() => null);
    void siteMap.then((map) => {
      if (alive) setRouteNodes(map?.nodes ?? []);
    });
    Promise.all([
      api.getScenarios(projectId),
      siteMap,
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

  const routeNames = useMemo(() => Object.fromEntries(
    routeNodes.map((node) => [node.routeKey, planScreenName(node)]),
  ), [routeNodes]);
  const screenLabel = useCallback((item: PlanItem) => item.screenRouteKey
    ? routeNames[item.screenRouteKey] ?? item.screenRouteKey
    : screens.get(planKey(item.specPath, item.title)), [routeNames, screens]);

  const refreshPlan = useCallback(async () => {
    try {
      await Promise.all(rowWrites.current.values());
      setPlan(await api.plan.get(projectId));
    } catch {
      setNotice('계획 표를 다시 불러오지 못했어요.');
    }
  }, [projectId]);

  const writing = items?.some((item) => writingState(item) === 'AI 작성 중');
  useEffect(() => {
    if (!writing || busy || dialog) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const version = revision.current;
      if (!rowWrites.current.size) {
        try {
          const fresh = await api.plan.get(projectId);
          if (active && version === revision.current && !rowWrites.current.size) setPlan(fresh);
        } catch {
          // 일시적으로 조회에 실패해도 다음 주기에 상태를 다시 읽는다.
        }
      }
      if (active) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [projectId, writing, busy, dialog]);

  const refreshEnabledResults = (ids: Set<string>) => {
    // 미사용 상태로 받은 행에는 결함이 없으므로, 사용으로 바꾼 뒤 서버의 판정을 다시 읽는다.
    return api.plan.get(projectId).then(({ items: fresh }) => {
      const byId = new Map(fresh.filter((i) => i.enabled && ids.has(rowId(i))).map((i) => [rowId(i), i]));
      setItems((list) => list.map((i) => {
        const result = byId.get(rowId(i));
        if (!i.enabled || !result) return i;
        const { lastStatus, lastRunAt, prevStatus, prevRunAt, defectStatus, defectFailCount } = result;
        return { ...i, lastStatus, lastRunAt, prevStatus, prevRunAt, defectStatus, defectFailCount };
      }));
    }).catch(() => setNotice('최근 결과와 결함을 다시 불러오지 못했어요.'));
  };

  const writeRows = (before: PlanItem[], after: PlanItem[], write: () => Promise<void>, refreshResults = false) => {
    const ids = new Set(before.map(rowId));
    if (!ids.size || busy || before.some((item) => rowWrites.current.has(rowId(item)))) return;
    const replaceRows = (rows: PlanItem[]) => {
      const byId = new Map(rows.map((item) => [rowId(item), item]));
      setItems((list) => list.map((item) => byId.get(rowId(item)) ?? item));
    };
    revision.current++;
    replaceRows(after);
    setNotice(null);
    const task = write()
      .then(() => refreshResults ? refreshEnabledResults(ids) : undefined)
      .catch(() => {
        replaceRows(before);
        setNotice('저장하지 못했어요. 다시 시도해 주세요.');
      })
      .finally(() => ids.forEach((id) => rowWrites.current.delete(id)));
    ids.forEach((id) => rowWrites.current.set(id, task));
  };

  const save = (before: PlanItem, change: Change) => {
    if (Object.entries(change).every(([key, value]) => before[key as keyof Change] === value)) return;
    if (change.title !== undefined && !validPlanTitle(change.title)) {
      setNotice(PLAN_TITLE_ERROR);
      return;
    }
    const after = {
      ...before, ...change, updatedByName: me?.displayName || me?.username || null, updatedAt: new Date().toISOString(),
    };
    const metadataOnly = before.stage === 'WRITTEN';
    writeRows([before], [after], () => {
      if (before.planId != null && (!metadataOnly || 'screenRouteKey' in change || 'expected' in change)) {
        return api.plan.patchEntry(projectId, before.planId, entryFields(after, metadataOnly));
      }
      return api.plan.patch(projectId, {
        specPath: after.specPath, grep: after.grep,
        assignee: after.assignee, assigneeUserId: after.assigneeUserId, dueDate: after.dueDate, priority: after.priority,
      });
    });
  };

  const setEnabled = (item: PlanItem, enabled: boolean) => {
    const { planId, specPath, grep, assignee, assigneeUserId, dueDate, priority } = item;
    const updated = { ...item, enabled, updatedByName: me?.displayName || me?.username || null, updatedAt: new Date().toISOString() };
    writeRows([item], [updated], () => planId == null
      ? api.plan.patch(projectId, { specPath, grep, enabled, assignee, assigneeUserId, dueDate, priority })
      : api.plan.setEnabled(projectId, [keyOf(item)], enabled), enabled && item.stage === 'WRITTEN');
  };

  const setEnabledMany = (all: PlanItem[], enabled: boolean) => {
    const targets = all.filter((i) => i.parentEnabled && i.enabled !== enabled && !rowWrites.current.has(rowId(i)));
    writeRows(targets, targets.map((item) => ({ ...item, enabled })),
      () => api.plan.setEnabled(projectId, targets.map(keyOf), enabled),
      enabled && targets.some((item) => item.stage === 'WRITTEN'));
  };

  const changePlan = async (write: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setNotice(null);
    revision.current++;
    let failure: string | null = null;
    try {
      await Promise.all(rowWrites.current.values());
      await write();
    } catch (e) {
      failure = planError(e, fallback);
    } finally {
      await refreshPlan();
      if (failure) setNotice(failure);
      setBusy(false);
    }
  };

  const generate = (target: number | number[]) => {
    if (aiOff) {
      setNotice('AI가 꺼져 있어요. AI를 켠 뒤 다시 시도해 주세요.');
      return;
    }
    if (Array.isArray(target) && (!target.length || target.length > MAX_GENERATE)) return;
    void changePlan(async () => {
      const jobs = Array.isArray(target)
        ? (await api.plan.bulkGenerate(projectId, target)).jobs
        : [await api.plan.generate(projectId, target)];
      const byPath = new Map(jobs.map((job) => [job.targetSpecPath, job]));
      setItems((rows) => rows.map((row) => {
        if (row.planId == null || row.stage !== 'UNWRITTEN') return row;
        const job = byPath.get(planSpecPath(row.planId));
        return job ? { ...row, aiJobId: job.id, aiJobStatus: job.status } : row;
      }));
    }, 'AI로 테스트를 만들지 못했어요.');
  };

  const remove = (item: PlanItem) => {
    const { planId } = item;
    if (planId == null || !window.confirm(`‘${item.title}’ 계획을 삭제할까요? 연결된 테스트 파일은 유지돼요.`)) return;
    void changePlan(() => api.plan.deleteEntry(projectId, planId), '계획을 삭제하지 못했어요.');
  };

  const columnDefs = useMemo<ColDef<PlanItem>[]>(
    () => [
      {
        headerName: '사용',
        width: 76,
        // 값이 있어야 사용 여부가 바뀔 때(저장 실패로 되돌릴 때 포함) 칸을 다시 그린다.
        valueGetter: (p) => p.data?.enabled,
        equals: () => false, // 제목을 고치면 체크박스 이름도 갱신한다
        cellRenderer: (p: ICellRendererParams<PlanItem>) =>
          p.data ? (
            <input
              type="checkbox"
              aria-label={`${p.data.title} 사용`}
              checked={p.data.enabled}
              disabled={readOnly || busy || !p.data.parentEnabled}
              title={p.data.parentEnabled ? undefined : '파일이나 묶음이 꺼져 있어요. 계획 › 테스트에서 먼저 켜 주세요.'}
              onChange={(e) => setEnabled(p.data!, e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
            />
          ) : null,
      },
      {
        headerName: '순서',
        width: 80,
        // 통과율 고정 행(F-3)은 끌지 않는다
        rowDrag: (p) => !readOnly && !busy && suiteId === '' && !p.node.rowPinned,
        valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1,
      },
      {
        headerName: '계획 항목',
        flex: 2,
        minWidth: 270,
        filter: true,
        editable: (p) => !readOnly && !busy && !p.node.rowPinned && p.data?.stage === 'UNWRITTEN',
        cellEditorParams: { maxLength: 200 },
        valueGetter: (p) => p.data?.title,
        equals: () => false, // 제목이 그대로여도 AI 작성 상태가 바뀌면 배지를 갱신한다
        valueSetter: (p) => {
          const title = String(p.newValue ?? '');
          if (validPlanTitle(title)) save(p.data, { title: title.trim() });
          else setNotice(PLAN_TITLE_ERROR);
          return false;
        },
        tooltipValueGetter: (p) => (p.data?.specPath && !p.node?.rowPinned ? `파일: ${p.data.specPath} (${p.data.line}줄)` : undefined),
        cellRenderer: (p: ICellRendererParams<PlanItem>) => {
          if (!p.data || p.node.rowPinned) return null;
          const status = writingState(p.data);
          return (
            <span className="flex h-full min-w-0 items-center gap-2">
              <span className="truncate">
                {p.data.describePath && <span className="mr-1 text-muted-foreground">{p.data.describePath} ›</span>}
                {p.data.title}
              </span>
              <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${STAGE_STYLE[status]}`}>{status}</span>
              {status === '검토 대기' && !readOnly && (
                <Link className="shrink-0 text-xs text-primary underline" to={projectTabPath(projectId, 'ai-review')}
                      onClick={(event) => event.stopPropagation()}>AI 검토에서 승인하세요</Link>
              )}
            </span>
          );
        },
      },
      {
        headerName: '화면',
        colId: 'screen',
        flex: 1,
        minWidth: 120,
        filter: true,
        editable: (p) => !readOnly && !busy && !p.node.rowPinned && p.data?.planId != null,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: (p: { data?: PlanItem }) => ({
          values: ['', ...Object.keys(routeNames),
            ...(p.data?.screenRouteKey && !Object.hasOwn(routeNames, p.data.screenRouteKey) ? [p.data.screenRouteKey] : [])],
        }),
        valueGetter: (p) => p.data?.screenRouteKey ?? '',
        valueFormatter: (p) => p.value
          ? routeNames[p.value] ?? p.value
          : (p.data && screenLabel(p.data)) || '미지정',
        filterValueGetter: (p) => p.data ? screenLabel(p.data) ?? '미지정' : '',
        valueSetter: (p) => {
          save(p.data, { screenRouteKey: p.newValue || null });
          return false;
        },
      },
      {
        headerName: '확인할 내용',
        field: 'expected',
        width: 140,
        editable: (p) => !readOnly && !busy && !p.node.rowPinned && p.data?.planId != null,
        cellEditor: 'agLargeTextCellEditor',
        cellEditorPopup: true,
        cellEditorParams: { maxLength: 2147483647, rows: 5, cols: 35 },
        tooltipValueGetter: (p) => p.data?.expected ?? undefined,
        valueSetter: (p) => {
          save(p.data, { expected: p.newValue?.trim() || null });
          return false;
        },
      },
      ...(!readOnly ? [{
        headerName: '행동',
        colId: 'actions',
        width: 300,
        cellRendererParams: { suppressMouseEventHandling: () => true },
        equals: () => false,
        cellRenderer: ({ data: item, node }: ICellRendererParams<PlanItem>) => {
          if (!item || node.rowPinned || item.planId == null) return null;
          const { planId } = item;
          const status = writingState(item);
          const lockGeneration = busy || status !== '미작성';
          const actionClass = 'h-auto px-1.5 py-0.5 text-xs';
          return (
            <div className="flex h-full items-center gap-1" onClick={(event) => event.stopPropagation()}>
              {item.stage === 'UNWRITTEN' ? (
                <>
                  <Button size="xs" variant="outline" className={actionClass} disabled={lockGeneration}
                          onClick={() => generate(planId)}>AI로 만들기</Button>
                  <Link className="rounded px-1.5 py-0.5 text-xs font-medium text-primary underline"
                        to={`${projectTabPath(projectId, 'recorder')}?plan=${planId}`}>클릭으로 만들기</Link>
                  <Button size="xs" variant="outline" className={actionClass} disabled={busy}
                          onClick={() => setDialog({ kind: 'link', planId })}>기존 테스트 연결</Button>
                </>
              ) : (
                <Button size="xs" variant="outline" className={actionClass} disabled={busy}
                        onClick={() => void changePlan(() => api.plan.unlink(projectId, planId), '연결을 해제하지 못했어요.')}>연결 해제</Button>
              )}
              <Button size="xs" variant="ghost" className={actionClass} disabled={busy}
                      aria-label={`${item.title} 계획 삭제`} onClick={() => remove(item)}>삭제</Button>
            </div>
          );
        },
      }] : []),
      {
        headerName: '담당자',
        width: 140,
        filter: true,
        editable: (p) => !readOnly && !busy && !p.node.rowPinned,
        // 프로젝트 멤버 중에서 고른다 (#119). 옛 이름 행은 그 이름을 그대로 두는 선택지도 남긴다.
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: (p: { data?: PlanItem }) => ({
          values: ['', ...members.map((m) => String(m.userId)),
            ...(p.data?.assigneeUserId == null && p.data?.assignee ? [TEXT_PREFIX + p.data.assignee] : [])],
        }),
        valueGetter: (p) =>
          p.data?.assigneeUserId != null ? String(p.data.assigneeUserId) : p.data?.assignee ? TEXT_PREFIX + p.data.assignee : '',
        filterValueGetter: (p) => (p.data ? assigneeLabel(p.data) || '미지정' : ''),
        valueFormatter: (p) => {
          const v = String(p.value ?? '');
          if (!v) return '미지정';
          if (v.startsWith(TEXT_PREFIX)) return assigneeLabel({ assignee: v.slice(TEXT_PREFIX.length), assigneeUserId: null });
          const m = members.find((x) => String(x.userId) === v);
          return m ? planMemberName(m) : p.data?.assignee ?? '';
        },
        valueSetter: (p) => {
          const v = String(p.newValue ?? '');
          if (v.startsWith(TEXT_PREFIX)) return false;
          const m = members.find((x) => String(x.userId) === v);
          save(p.data, m ? { assigneeUserId: m.userId, assignee: planMemberName(m) } : { assigneeUserId: null, assignee: null });
          return false;
        },
      },
      {
        headerName: '마감일',
        width: 140,
        editable: (p) => !readOnly && !busy && !p.node.rowPinned,
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
        editable: (p) => !readOnly && !busy && !p.node.rowPinned,
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
        headerName: '직전 결과',
        width: 110,
        field: 'prevStatus',
        // 직전 판정이 같아도 최근 판정이 바뀌면 화살표를 다시 그린다.
        equals: () => false,
        tooltipValueGetter: (p) => p.data?.prevRunAt ? new Date(p.data.prevRunAt).toLocaleString('ko-KR') : undefined,
        cellRenderer: (p: ICellRendererParams<PlanItem, PlanItem['prevStatus']>) => {
          const view = RESULT_VIEW[p.value ?? 'NONE'];
          const latest = p.data?.lastStatus;
          return (
            <span className="inline-flex items-center gap-1">
              {p.value && latest && p.value !== latest && (
                <span className="text-foreground" title={`결과 변경: ${view.label} → ${RESULT_VIEW[latest].label}`}>
                  <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
                  <span className="sr-only">결과 변경</span>
                </span>
              )}
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${view.className}`}>{view.label}</span>
            </span>
          );
        },
      },
      {
        headerName: '결함',
        width: 184,
        valueGetter: (p) => p.data ? defectLabel(p.data) : '',
        cellRenderer: (p: ICellRendererParams<PlanItem, string>) => {
          if (!p.value) return null;
          const badge = 'rounded px-2 py-0.5 text-xs font-medium';
          if (p.data?.defectStatus === 'RESOLVED') {
            return <span className={`${badge} bg-muted text-muted-foreground`}>{p.value}</span>;
          }
          const openBadge = `${badge} bg-destructive/10 text-destructive`;
          return onOpenDefects ? (
            <button type="button" title="결함 목록 열기" className={`${openBadge} hover:underline`}
                    onClick={(e) => { e.stopPropagation(); onOpenDefects(); }}>
              {p.value}
            </button>
          ) : <span className={openBadge}>{p.value}</span>;
        },
      },
      {
        headerName: '최근 수정',
        width: 150,
        valueGetter: (p) =>
          p.data?.updatedAt ? [p.data.updatedByName, formatRelative(p.data.updatedAt)].filter(Boolean).join(' · ') : '',
      },
    ],
    // 셀 콜백은 표의 행 데이터와 아래 의존성의 값으로 저장한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeNames, screenLabel, members, projectId, suiteId, readOnly, busy, aiOff, me, onOpenDefects]
  );

  // 날짜 칸은 기존 열 맨 끝에 붙인다.
  const allColumns = useMemo(
    () => [...columnDefs, ...dailyColumns(daily, onOpenExecution)],
    [columnDefs, daily, onOpenExecution]
  );

  if (!plan || !items) {
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

  const { summary } = plan;
  const enabledCount = items.filter((i) => i.enabled && i.stage === 'WRITTEN').length;
  const selectedIds = new Set(selected.map(rowId));
  const selectedRows = items.filter((i) => selectedIds.has(rowId(i)));
  const selectedPlans = selectedRows.flatMap((i) =>
    i.planId != null && writingState(i) === '미작성' ? [i.planId] : [],
  );
  const linkPlan = dialog?.kind === 'link' ? items.find((i) => i.planId === dialog.planId) : undefined;
  const dialogProps = { projectId, onClose: () => setDialog(null), onChanged: refreshPlan };
  const suite = suites.find((x) => String(x.id) === suiteId) ?? null;
  const shown = suite ? items.filter((i) => inSuite(suite, i)) : items;
  const counts = planCounts(shown);
  const dailyRates = daily && allColumns.length > columnDefs.length
    ? dailyPassRates(daily.days, shown, cellsByRow(daily))
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 @5xl:flex-row @5xl:items-end @5xl:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <ClipboardList className="h-5 w-5 text-primary" />
            테스트 계획
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            계획 {summary.total} · 작성 {summary.written} ({percent(summary.writtenRate)}) · 완료 {summary.passed} ({percent(summary.completionRate)})
          </p>
          <p className="text-xs text-muted-foreground">
            {readOnly ? '계획은 PM이 정해요. 보고 실행할 수 있어요.' : '칸을 두 번 눌러 고치고, 순서 칸을 끌어 옮겨요.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!readOnly && (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog({ kind: 'add' })}>계획 추가</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog({ kind: 'paste' })}>엑셀에서 붙여넣기</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog({ kind: 'suggestions' })}>AI 연결 추천</Button>
              {selectedPlans.length > 0 && (
                <Button size="sm" variant="outline" disabled={busy || selectedPlans.length > MAX_GENERATE}
                        title={selectedPlans.length > MAX_GENERATE ? '한 번에 10건까지 만들 수 있어요.' : undefined}
                        onClick={() => generate(selectedPlans)}>AI로 {selectedPlans.length}건 만들기</Button>
              )}
            </>
          )}
          {!readOnly && selectedRows.length > 0 && (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setEnabledMany(selectedRows, true)}>
                선택한 {selectedRows.length}건 사용
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setEnabledMany(selectedRows, false)}>
                선택한 {selectedRows.length}건 미사용
              </Button>
            </>
          )}
          <Button size="sm" variant="outline"
                  onClick={() => downloadCsv(`${projectId}-계획-${new Date().toLocaleDateString('sv-SE').replaceAll('-', '')}.csv`, planCsvRows(items, screenLabel))}>
            <Download className="h-4 w-4" />
            CSV 내보내기
          </Button>
          <Button size="sm" onClick={onRun} disabled={enabledCount === 0 || runDisabled || busy}
                  title={runDisabled ? '실행 중인 테스트가 끝나면 다시 실행할 수 있어요' : undefined}>
            <Play className="h-4 w-4" />
            {runDisabled ? '실행 중…' : `체크한 ${enabledCount}건 실행`}
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
          <span className="flex-1" role="alert">{notice}</span>
          <button type="button" aria-label="알림 닫기" onClick={() => setNotice(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {daily && !hasScheduledRuns(daily) && (
        <p className="rounded-lg border border-dashed border-border px-4 py-2 text-sm text-muted-foreground">
          정기 실행 기록이 아직 없어요 · 설정에서 매일 03:00 실행을 켜면 날짜별 성공 · 실패가 여기에 쌓여요.
        </p>
      )}

      <div className="ag-theme-playops overflow-hidden rounded-xl border border-border" style={{ height: 560 }}>
        <AgGridReact<PlanItem>
          theme="legacy"
          rowData={shown}
          columnDefs={allColumns}
          defaultColDef={{ sortable: false, resizable: true, cellRendererSelector: pinnedRowSelector }}
          pinnedBottomRowData={dailyRates ? [dailyTotalRow(dailyRates)] : undefined}
          onCellEditingStarted={(e) => e.node.rowPinned && e.api.stopEditing(true)}
          getRowId={(p) => rowId(p.data)}
          rowDragManaged
          rowSelection={{ mode: 'multiRow', checkboxes: false, headerCheckbox: false, enableClickSelection: true }}
          onSelectionChanged={(e) => setSelected(e.api.getSelectedRows())}
          onRowDragEnd={(e) => {
            if (suite || busy) return;
            const ordered: PlanItem[] = [];
            e.api.forEachNode((n) => n.data && ordered.push(n.data));
            setItems(() => ordered);
            void changePlan(() => api.plan.reorder(projectId, ordered.map(keyOf)), '순서를 저장하지 못했어요.');
          }}
          tooltipShowDelay={300}
          overlayNoRowsTemplate="표시할 계획이나 테스트가 없어요."
        />
      </div>

      {!readOnly && dialog?.kind === 'add' && <AddPlanDialog {...dialogProps} screens={routeNodes} members={members} />}
      {!readOnly && dialog?.kind === 'paste' && <PastePlanDialog {...dialogProps} screens={routeNodes} members={members} />}
      {!readOnly && dialog?.kind === 'suggestions' && <PlanSuggestionsDialog {...dialogProps} items={items} aiOff={aiOff} />}
      {!readOnly && linkPlan && (
        <LinkPlanDialog {...dialogProps} plan={linkPlan}
                        candidates={items.filter((item) => item.stage === 'WRITTEN' && item.planId == null)} />
      )}
    </div>
  );
}
