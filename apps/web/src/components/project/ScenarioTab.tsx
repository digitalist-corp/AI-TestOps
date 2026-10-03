import { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Bookmark,
  ExternalLink,
  FileCode,
  FolderOpen,
  History,
  Loader2,
  Play,
  Sparkles,
  Trash2,
  TestTube,
} from 'lucide-react';
import type { AiJob, Execution, ExecutionStatus, ScenarioCaseNode, ScenarioTree, TestSuite } from '@/types';
import { api } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SpecPathField } from '@/components/project/SpecPathField';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';
import { cn } from '@/lib/utils';

export interface SelectedCase {
  grep: string;
  title: string;
  specPath: string;
}

export interface SelectedScenario {
  grep: string | null;
  title: string;
  specPath: string;
}

interface Props {
  projectId: string;
  tree: ScenarioTree | null;
  executions: Execution[];
  loading: boolean;
  onRefresh: () => void;
  onRunCase: (selected: SelectedCase) => void;
  onRunCases: (selected: SelectedCase[]) => void;
  onRunScenario: (selected: SelectedScenario) => void;
  onRunSuite: (suite: TestSuite) => void;
  onOpenFile: (path: string) => void;
  onViewExecution: (id: number) => void;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function caseKey(specPath: string, grep: string) {
  return `${specPath}\u0000${grep}`;
}

function usageKey(nodeType: string, specPath: string, grep: string | null) {
  return `${nodeType}\u0000${specPath}\u0000${grep ?? ''}`;
}

function getFileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function getSingleScenario(nodes: ScenarioCaseNode[]) {
  return nodes.length === 1 && nodes[0].type === 'DESCRIBE' ? nodes[0] : null;
}

const statusColor: Record<ExecutionStatus, string> = {
  SCHEDULED: 'text-ai-accent',
  PASSED: 'text-success',
  FAILED: 'text-destructive',
  ERROR: 'text-orange-600 dark:text-orange-300',
  RUNNING: 'text-primary',
  PENDING: 'text-muted-foreground',
  CANCEL_REQUESTED: 'text-warning',
  CANCELLED: 'text-muted-foreground',
};

const statusPillColor: Record<ExecutionStatus, string> = {
  SCHEDULED: 'bg-ai-accent/10 text-ai-accent',
  PENDING: 'bg-muted text-muted-foreground',
  RUNNING: 'bg-primary/10 text-primary',
  CANCEL_REQUESTED: 'bg-warning/10 text-warning',
  CANCELLED: 'bg-muted text-muted-foreground',
  PASSED: 'bg-success/10 text-success',
  FAILED: 'bg-destructive/10 text-destructive',
  ERROR: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
};

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

function splitSpecPaths(value: string | null) {
  return value?.split('\n').map((item) => item.trim()).filter(Boolean) ?? [];
}

function includesSpecPath(execution: Execution, specPath: string) {
  const executionSpecPaths = splitSpecPaths(execution.specPath);
  if (executionSpecPaths.length === 0) return false;
  const normalizedSpecPath = specPath.replaceAll('\\', '/');
  return executionSpecPaths
    .map((item) => item.replaceAll('\\', '/'))
    .includes(normalizedSpecPath);
}

function executionTime(execution: Execution) {
  return execution.startedAt ?? execution.createdAt;
}

function formatExecutionTime(execution: Execution | null) {
  const value = execution ? executionTime(execution) : null;
  return value ? new Date(value).toLocaleString('ko-KR') : '-';
}

function latestByTime(executions: Execution[]) {
  return [...executions].sort((a, b) => (
    new Date(executionTime(b)).getTime() - new Date(executionTime(a)).getTime()
  ))[0] ?? null;
}

function grepMatches(grepFilter: string | null, title: string) {
  if (!grepFilter) return false;
  if (grepFilter === title) return true;
  try {
    return new RegExp(grepFilter).test(title);
  } catch {
    return false;
  }
}

function findCaseExecution(executions: Execution[], specPath: string, node: ScenarioCaseNode) {
  return latestByTime(executions.filter((execution) =>
    grepMatches(execution.grepFilter, node.grep) && includesSpecPath(execution, specPath)
  ));
}

function collectTestNodes(nodes: ScenarioCaseNode[]): ScenarioCaseNode[] {
  return nodes.flatMap((node) => [
    ...(node.type === 'TEST' ? [node] : []),
    ...collectTestNodes(node.children),
  ]);
}

function findScenarioExecution(
  executions: Execution[],
  specPath: string,
  scenario: ScenarioCaseNode | null,
  nodes: ScenarioCaseNode[]
) {
  const specExecution = latestByTime(executions.filter((execution) =>
    includesSpecPath(execution, specPath) && !execution.grepFilter
  ));
  if (specExecution) return specExecution;

  const scenarioExecution = scenario
    ? latestByTime(executions.filter((execution) =>
        grepMatches(execution.grepFilter, scenario.grep) && includesSpecPath(execution, specPath)
      ))
    : null;
  if (scenarioExecution) return scenarioExecution;

  return latestByTime(collectTestNodes(nodes)
    .map((node) => findCaseExecution(executions, specPath, node))
    .filter((execution): execution is Execution => Boolean(execution)));
}

function findNodeExecution(executions: Execution[], specPath: string, node: ScenarioCaseNode) {
  if (node.type === 'TEST') {
    return findCaseExecution(executions, specPath, node);
  }

  const describeExecution = latestByTime(executions.filter((execution) =>
    grepMatches(execution.grepFilter, node.grep) && includesSpecPath(execution, specPath)
  ));
  if (describeExecution) return describeExecution;

  return latestByTime(collectTestNodes(node.children)
    .map((child) => findCaseExecution(executions, specPath, child))
    .filter((execution): execution is Execution => Boolean(execution)));
}

function StatusBadge({ execution }: { execution: Execution | null }) {
  if (!execution) {
    return <span className="text-xs text-muted-foreground">미실행</span>;
  }

  return (
    <span className={cn('inline-flex px-2 py-0.5 rounded-full text-xs font-medium', statusPillColor[execution.status])}>
      {statusLabel[execution.status]}
    </span>
  );
}

function UsageToggle({
  enabled,
  loading,
  onClick,
}: {
  enabled: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={loading}
      className={cn(
        'inline-flex h-6 min-w-10 items-center justify-center rounded-md border px-2 text-xs font-semibold disabled:opacity-60',
        enabled
          ? 'border-success/30 bg-success/10 text-success hover:bg-success/20'
          : 'border-border bg-muted text-muted-foreground hover:bg-accent'
      )}
      onClick={onClick}
      title={enabled ? '사용 중' : '미사용'}
    >
      {enabled ? 'Y' : 'N'}
    </button>
  );
}

function ScenarioNodeRows({
  nodes,
  specPath,
  depth,
  executions,
  selectedGrep,
  selectedCaseKeys,
  ancestorEnabled,
  usageSavingKeys,
  onSelectCase,
  onToggleCase,
  onToggleUsage,
  onRunCase,
  onViewExecution,
}: {
  nodes: ScenarioCaseNode[];
  specPath: string;
  depth: number;
  executions: Execution[];
  selectedGrep: string | null;
  selectedCaseKeys: Set<string>;
  ancestorEnabled: boolean;
  usageSavingKeys: Set<string>;
  onSelectCase: (c: SelectedCase) => void;
  onToggleCase: (c: SelectedCase, checked: boolean) => void;
  onToggleUsage: (nodeType: 'DESCRIBE' | 'TEST', specPath: string, grep: string, enabled: boolean) => void;
  onRunCase: (c: SelectedCase) => void;
  onViewExecution: (id: number) => void;
}) {
  return (
    <>
      {nodes.map((node, i) => {
        const isTest = node.type === 'TEST';
        const latestExecution = findNodeExecution(executions, specPath, node);
        const selected = isTest && selectedGrep === node.grep;
        const enabled = node.enabled ?? true;
        const effectiveEnabled = ancestorEnabled && enabled;
        const currentUsageKey = usageKey(node.type, specPath, node.grep);

        return (
          <Fragment key={`${specPath}-${depth}-${i}-${node.line}`}>
            <tr
              className={cn(
                'group border-t border-border hover:bg-accent',
                selected && 'bg-primary/10',
                !effectiveEnabled && 'bg-muted text-muted-foreground'
              )}
            >
              <td className="px-3 py-2">
                <div className="flex items-center gap-2 min-w-0" style={{ paddingLeft: `${depth * 18}px` }}>
                  {isTest ? (
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-border"
                      checked={selectedCaseKeys.has(caseKey(specPath, node.grep))}
                      disabled={!effectiveEnabled}
                      onChange={(e) => onToggleCase({ grep: node.grep, title: node.title, specPath }, e.target.checked)}
                      aria-label={`${node.title} 선택`}
                    />
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0" />
                  )}
                  {isTest ? (
                    <TestTube className="h-3.5 w-3.5 text-success shrink-0" />
                  ) : (
                    <FolderOpen className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  )}
                  {isTest ? (
                    <button
                      type="button"
                      className={cn(
                        'min-w-0 truncate rounded px-1 py-0.5 text-left text-sm hover:text-primary',
                        selected && 'font-medium text-primary'
                      )}
                      onClick={() => onSelectCase({ grep: node.grep, title: node.title, specPath })}
                    >
                      {node.title}
                    </button>
                  ) : (
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">{node.title}</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {node.sourceName ? <span className="font-mono">{node.sourceName}</span> : '-'}
              </td>
              <td className="px-3 py-2">
                <UsageToggle
                  enabled={enabled}
                  loading={usageSavingKeys.has(currentUsageKey)}
                  onClick={() => onToggleUsage(node.type === 'TEST' ? 'TEST' : 'DESCRIBE', specPath, node.grep, !enabled)}
                />
              </td>
              <td className="px-3 py-2">
                <button
                  type="button"
                  className={cn(latestExecution ? 'cursor-pointer' : 'cursor-default')}
                  onClick={() => latestExecution && onViewExecution(latestExecution.id)}
                  disabled={!latestExecution}
                >
                  <StatusBadge execution={latestExecution} />
                </button>
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                {formatExecutionTime(latestExecution)}
              </td>
              <td className="px-3 py-2 text-right">
                {isTest && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-primary"
                    disabled={!effectiveEnabled}
                    onClick={() => onRunCase({ grep: node.grep, title: node.title, specPath })}
                    title="케이스 실행"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                )}
              </td>
            </tr>
            {node.children.length > 0 && (
              <ScenarioNodeRows
                nodes={node.children}
                specPath={specPath}
                depth={depth + 1}
                executions={executions}
                selectedGrep={selectedGrep}
                selectedCaseKeys={selectedCaseKeys}
                ancestorEnabled={effectiveEnabled}
                usageSavingKeys={usageSavingKeys}
                onSelectCase={onSelectCase}
                onToggleCase={onToggleCase}
                onToggleUsage={onToggleUsage}
                onRunCase={onRunCase}
                onViewExecution={onViewExecution}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

export function ScenarioTab({
  projectId,
  tree,
  executions,
  loading,
  onRefresh,
  onRunCase,
  onRunCases,
  onRunScenario,
  onRunSuite,
  onOpenFile,
  onViewExecution,
}: Props) {
  const [selectedCase, setSelectedCase] = useState<SelectedCase | null>(null);
  const [checkedCases, setCheckedCases] = useState<Map<string, SelectedCase>>(new Map());
  const [history, setHistory] = useState<Execution[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [usageSavingKeys, setUsageSavingKeys] = useState<Set<string>>(new Set());

  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [suiteSaveOpen, setSuiteSaveOpen] = useState(false);
  const [suiteName, setSuiteName] = useState('');
  const [suiteSequential, setSuiteSequential] = useState(false);
  const [suiteSaving, setSuiteSaving] = useState(false);
  const [suiteError, setSuiteError] = useState('');

  const loadSuites = () => {
    api.testSuites.listByProject(projectId).then(setSuites).catch(() => setSuites([]));
  };

  useEffect(() => {
    loadSuites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const navigate = useNavigate();
  const [genDialogOpen, setGenDialogOpen] = useState(false);
  const [genSpecPath, setGenSpecPath] = useState('');
  const [genInstruction, setGenInstruction] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genJob, setGenJob] = useState<AiJob | null>(null);
  const [genError, setGenError] = useState('');
  const genPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const genTerminalStatuses: AiJob['status'][] = [
    'NEEDS_REVIEW', 'APPLIED', 'REJECTED', 'FAILED', 'ERROR', 'CANCELED', 'TIMEOUT',
  ];
  const genStatusLabel: Record<AiJob['status'], string> = {
    PENDING: '대기 중',
    RUNNING: 'AI가 spec 파일 생성 중...',
    DIFF_READY: '결과 처리 중',
    NEEDS_REVIEW: '관리자 검토 대기',
    APPLIED: '적용 완료',
    REJECTED: '거부됨',
    FAILED: '생성 실패',
    ERROR: '오류 발생',
    CANCELED: '취소됨',
    TIMEOUT: '시간 초과',
  };

  const stopGenPolling = () => {
    if (genPollRef.current) {
      clearInterval(genPollRef.current);
      genPollRef.current = null;
    }
  };

  useEffect(() => stopGenPolling, []);

  // 헤더에서 'AI로 만들기' · '선택 실행'을 누르면 ?do= 로 넘어온다.
  // 탭을 옮기는 순간 이 컴포넌트가 다시 마운트되므로, 상태가 아니라 주소로 창을 연다.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlAction = searchParams.get('do');
  const clearUrlAction = () => {
    if (!urlAction) return;
    const next = new URLSearchParams(searchParams);
    next.delete('do');
    setSearchParams(next, { replace: true });
  };


  const resetGenDialog = () => {
    stopGenPolling();
    setGenDialogOpen(false);
    setGenJob(null);
    setGenSpecPath('');
    setGenInstruction('');
    setGenError('');
  };

  const handleGenerateScenario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!genSpecPath.trim() || !genInstruction.trim()) return;
    setGenLoading(true);
    setGenError('');
    stopGenPolling();
    try {
      const job = await api.aiJobs.createTemplateGenerate(projectId, {
        targetSpecPath: genSpecPath.trim(),
        instruction: genInstruction.trim(),
      });
      setGenJob(job);
      genPollRef.current = setInterval(async () => {
        try {
          const jobs = await api.aiJobs.listByProject(projectId);
          const updated = jobs.find((j) => j.id === job.id);
          if (updated) {
            setGenJob(updated);
            if (genTerminalStatuses.includes(updated.status)) {
              stopGenPolling();
              if (updated.status === 'NEEDS_REVIEW' || updated.status === 'APPLIED') {
                onRefresh();
              }
            }
          }
        } catch {
          // 폴링 중 일시적 오류는 무시하고 다음 tick에 재시도
        }
      }, 3000);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'AI 시나리오 생성 요청 실패');
    } finally {
      setGenLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedCase?.grep) {
      setHistory([]);
      return;
    }
    setHistoryLoading(true);
    api.getCaseHistory(projectId, selectedCase.grep)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [projectId, selectedCase?.grep]);

  const toggleCheckedCase = (selected: SelectedCase, checked: boolean) => {
    setCheckedCases((prev) => {
      const next = new Map(prev);
      const key = caseKey(selected.specPath, selected.grep);
      if (checked) {
        next.set(key, selected);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const selectedCaseKeys = new Set(checkedCases.keys());
  const checkedCaseList = [...checkedCases.values()];

  const toggleUsage = async (
    nodeType: 'SPEC' | 'DESCRIBE' | 'TEST',
    specPath: string,
    grep: string | null,
    enabled: boolean
  ) => {
    const key = usageKey(nodeType, specPath, grep);
    setUsageSavingKeys((prev) => new Set(prev).add(key));
    try {
      await api.updateScenarioUsage(projectId, { nodeType, specPath, grep, enabled });
      if (!enabled && nodeType === 'TEST' && grep) {
        setCheckedCases((prev) => {
          const next = new Map(prev);
          next.delete(caseKey(specPath, grep));
          return next;
        });
      }
      onRefresh();
    } finally {
      setUsageSavingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleSaveSuite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkedCaseList.length === 0) return;
    setSuiteError('');
    setSuiteSaving(true);
    try {
      const specPaths = [...new Set(checkedCaseList.map((item) => item.specPath))];
      const grep = `(?:${checkedCaseList.map((item) => escapeRegex(item.grep)).join('|')})`;
      await api.testSuites.create(projectId, {
        name: suiteName.trim(),
        specPaths,
        grep,
        caseCount: checkedCaseList.length,
        sequential: suiteSequential,
      });
      setSuiteSaveOpen(false);
      setSuiteName('');
      setSuiteSequential(false);
      loadSuites();
    } catch (err) {
      setSuiteError(err instanceof Error ? err.message : '저장 실패');
    } finally {
      setSuiteSaving(false);
    }
  };

  const handleDeleteSuite = async (suite: TestSuite) => {
    if (!confirm(`테스트 묶음 "${suite.name}"을(를) 삭제하시겠습니까?`)) return;
    await api.testSuites.remove(projectId, suite.id);
    loadSuites();
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">시나리오 분석 중...</p>;
  }
  if (!tree || tree.specs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <FileCode className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">spec 파일이 없습니다. 소스 탭에서 템플릿을 생성하세요.</p>
        <Button size="sm" variant="outline" className="mt-4" onClick={onRefresh}>
          다시 분석
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 @5xl:grid-cols-3 gap-4">
      {urlAction === 'pick' && checkedCaseList.length === 0 && (
        <p className="rounded-sm border border-primary bg-primary-subtle px-3.5 py-2.5 text-[13px] text-primary">
          실행할 테스트 케이스를 아래 목록에서 고르세요. 고른 뒤 &quot;선택 케이스 실행&quot;을 누르면 그 케이스만 실행합니다.
          자주 쓰는 조합은 &quot;묶음으로 저장&quot;으로 남겨두면 다음부터 한 번에 실행할 수 있습니다.
        </p>
      )}
      <div className="min-w-0 @5xl:col-span-2 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">{tree.totalSpecs}</strong>개 spec · <strong className="text-foreground">{tree.totalCases}</strong>개 테스트 케이스
            {checkedCaseList.length > 0 && <span className="ml-2 text-primary">케이스 {checkedCaseList.length}개 선택</span>}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={checkedCaseList.length === 0}
              onClick={() => onRunCases(checkedCaseList)}
              title="체크한 케이스만 묶어서 실행"
            >
              <Play className="h-3 w-3" />
              선택 케이스 실행
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={checkedCaseList.length === 0}
              onClick={() => setSuiteSaveOpen(true)}
              title="체크한 케이스를 이름 붙여 저장해두고 나중에 한 번에 다시 실행"
            >
              <Bookmark className="h-3 w-3" />
              묶음으로 저장
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={checkedCaseList.length === 0}
              onClick={() => setCheckedCases(new Map())}
            >
              선택 해제
            </Button>
            <Button size="sm" variant="outline" onClick={onRefresh}>새로고침</Button>
            <Button
              size="sm"
              className="bg-ai-accent hover:opacity-90 text-ai-accent-foreground"
              onClick={() => setGenDialogOpen(true)}
              title="자연어로 새 테스트 시나리오를 생성해 이 프로젝트에 추가 (검토/승인 필요)"
            >
              <Sparkles className="h-3 w-3" />
              AI로 새 시나리오 생성
            </Button>
          </div>
        </div>

        {suites.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/60 p-3">
            <span className="text-xs font-semibold text-muted-foreground shrink-0">저장된 테스트 묶음</span>
            {suites.map((suite) => (
              <div
                key={suite.id}
                className="flex items-center gap-1 rounded-full border border-border bg-card pl-3 pr-1 py-1"
              >
                <button
                  type="button"
                  className="text-xs font-medium text-foreground hover:text-primary"
                  onClick={() => onRunSuite(suite)}
                  title={`${suite.name} (${suite.caseCount}개 케이스) 실행${suite.sequential ? ' — 순차 실행' : ''}`}
                >
                  {suite.name}
                  <span className="ml-1 text-muted-foreground">({suite.caseCount})</span>
                  {suite.sequential && (
                    <span className="ml-1 rounded bg-warning/15 px-1 py-0.5 text-[10px] font-semibold text-warning">
                      순차
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => handleDeleteSuite(suite)}
                  title="묶음 삭제"
                  aria-label={`${suite.name} 묶음 삭제`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="min-w-[860px] w-full table-fixed text-left">
              <colgroup>
                <col className="w-[36%]" />
                <col className="w-[17%]" />
                <col className="w-[8%]" />
                <col className="w-[12%]" />
                <col className="w-[18%]" />
                <col className="w-[9%]" />
              </colgroup>
              <thead className="bg-muted text-xs font-semibold text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">시나리오 / 케이스</th>
                  <th className="px-3 py-2">소스</th>
                  <th className="px-3 py-2">사용</th>
                  <th className="px-3 py-2">최종 상태</th>
                  <th className="px-3 py-2">최종 실행시간</th>
                  <th className="px-3 py-2 text-right">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tree.specs.map((spec) => {
                  const scenario = getSingleScenario(spec.cases);
                  const nodes = scenario ? scenario.children : spec.cases;
                  const specFileName = getFileName(spec.path);
                  const scenarioTitle = scenario?.title ?? specFileName;
                  const scenarioEnabled = scenario?.enabled ?? spec.enabled ?? true;
                  const currentUsageKey = usageKey(scenario ? 'DESCRIBE' : 'SPEC', spec.path, scenario?.grep ?? null);
                  const latestExecution = findScenarioExecution(executions, spec.path, scenario, nodes);

                  return (
                    <Fragment key={spec.path}>
                      <tr className={cn('bg-muted/70 hover:bg-accent', !scenarioEnabled && 'text-muted-foreground')}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <FolderOpen className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                            <span className={cn('truncate text-sm font-semibold text-foreground', !scenarioEnabled && 'text-muted-foreground')}>
                              {scenarioTitle}
                            </span>
                            <span className="rounded bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border">
                              {spec.caseCount} cases
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileCode className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="truncate font-mono text-xs text-muted-foreground" title={spec.path}>
                              {specFileName}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <UsageToggle
                            enabled={scenarioEnabled}
                            loading={usageSavingKeys.has(currentUsageKey)}
                            onClick={() => toggleUsage(
                              scenario ? 'DESCRIBE' : 'SPEC',
                              spec.path,
                              scenario?.grep ?? null,
                              !scenarioEnabled
                            )}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className={cn(latestExecution ? 'cursor-pointer' : 'cursor-default')}
                            onClick={() => latestExecution && onViewExecution(latestExecution.id)}
                            disabled={!latestExecution}
                          >
                            <StatusBadge execution={latestExecution} />
                          </button>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {formatExecutionTime(latestExecution)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:bg-card hover:text-primary"
                              disabled={!scenarioEnabled}
                              onClick={() => onRunScenario({
                                grep: scenario?.grep ?? null,
                                title: scenarioTitle,
                                specPath: spec.path,
                              })}
                              title={scenario ? '시나리오 실행' : 'spec 실행'}
                              aria-label={`${scenarioTitle} 실행`}
                            >
                              <Play className="h-3.5 w-3.5" />
                            </Button>
                            <button
                              type="button"
                              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-primary"
                              onClick={() => onOpenFile(spec.path)}
                              aria-label={`${specFileName} 소스 열기`}
                              title="소스 열기"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      <ScenarioNodeRows
                        nodes={nodes}
                        specPath={spec.path}
                        depth={0}
                        executions={executions}
                        selectedGrep={selectedCase?.grep ?? null}
                        selectedCaseKeys={selectedCaseKeys}
                        ancestorEnabled={scenarioEnabled}
                        usageSavingKeys={usageSavingKeys}
                        onSelectCase={setSelectedCase}
                        onToggleCase={toggleCheckedCase}
                        onToggleUsage={toggleUsage}
                        onRunCase={onRunCase}
                        onViewExecution={onViewExecution}
                      />
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="border border-border rounded-lg p-4 bg-muted/50 min-h-[200px]">
        <div className="flex items-center gap-2 mb-3">
          <History className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">케이스 실행 이력</h3>
        </div>
        {!selectedCase ? (
          <p className="text-xs text-muted-foreground">테스트 케이스를 클릭하면 이전 실행 이력이 표시됩니다.</p>
        ) : historyLoading ? (
          <p className="text-xs text-muted-foreground">불러오는 중...</p>
        ) : history.length === 0 ? (
          <div>
            <p className="text-xs font-medium text-foreground mb-1">{selectedCase.title}</p>
            <p className="text-xs text-muted-foreground">실행 이력이 없습니다.</p>
            <Button size="sm" className="mt-3 w-full" onClick={() => onRunCase(selectedCase)}>
              <Play className="h-3 w-3" />
              첫 실행
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground truncate" title={selectedCase.title}>
              {selectedCase.title}
            </p>
            <ul className="space-y-1.5 max-h-[400px] overflow-auto">
              {history.map((execution) => (
                <li key={execution.id}>
                  <button
                    type="button"
                    className="w-full text-left px-2 py-2 rounded-md bg-card border border-border hover:border-primary/40 text-xs cursor-pointer"
                    onClick={() => onViewExecution(execution.id)}
                  >
                    <div className="flex justify-between">
                      <span className="font-mono">#{execution.id}</span>
                      <span className={cn('font-medium', statusColor[execution.status])}>{execution.status}</span>
                    </div>
                    <div className="text-muted-foreground mt-0.5">
                      {execution.passedTests}/{execution.totalTests} ·{' '}
                      {new Date(execution.createdAt).toLocaleString('ko-KR')}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="outline" className="w-full mt-2" onClick={() => onRunCase(selectedCase)}>
              <Play className="h-3 w-3" />
              다시 실행
            </Button>
          </div>
        )}
      </div>

      <Dialog open={suiteSaveOpen} onOpenChange={setSuiteSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>테스트 묶음으로 저장</DialogTitle>
            <DialogDescription>
              현재 선택한 케이스 {checkedCaseList.length}개를 이름 붙여 저장합니다. 나중에 이 이름을 눌러 한 번에 다시 실행할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveSuite} className="space-y-4">
            <Input
              value={suiteName}
              onChange={(e) => setSuiteName(e.target.value)}
              placeholder="예: 로그인/결제 회귀 묶음"
              required
              autoFocus
            />
            <label className="flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2">
              <input
                type="checkbox"
                className="mt-0.5 h-3.5 w-3.5 rounded border-border"
                checked={suiteSequential}
                onChange={(e) => setSuiteSequential(e.target.checked)}
              />
              <span className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">순차 실행 (병렬 끄기)</span>
                <br />
                켜면 이 묶음을 실행할 때 케이스/spec을 동시에 여러 개 돌리지 않고 하나씩 순서대로 실행합니다.
              </span>
            </label>
            {suiteError && <p className="text-sm text-destructive">{suiteError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setSuiteSaveOpen(false)}>
                취소
              </Button>
              <Button type="submit" disabled={suiteSaving}>
                {suiteSaving ? '저장 중...' : '저장'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={genDialogOpen || urlAction === 'generate'}
        onOpenChange={(open) => {
          if (open) {
            setGenDialogOpen(true);
          } else {
            resetGenDialog();
            clearUrlAction();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-ai-accent" />
              AI로 새 시나리오 생성
            </DialogTitle>
            <DialogDescription>
              자연어로 요구사항을 설명하면 AI가 새 spec 파일을 생성합니다. 생성 결과는 자동 반영되지 않고,
              관리자가 "AI 검토" 메뉴에서 승인해야 실제 프로젝트에 추가됩니다.
            </DialogDescription>
          </DialogHeader>

          {!genJob ? (
            <form onSubmit={handleGenerateScenario} className="space-y-4">
              <SpecPathField
                specPaths={tree?.specs.map((spec) => spec.path) ?? []}
                value={genSpecPath}
                onChange={setGenSpecPath}
              />
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">시나리오 요구사항 (자연어)</label>
                <textarea
                  rows={4}
                  value={genInstruction}
                  onChange={(e) => setGenInstruction(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ai-accent"
                  placeholder="예: 장바구니에 상품을 담고 결제 페이지로 이동해 총 금액이 표시되는지 확인하는 시나리오를 작성해줘."
                  required
                />
              </div>
              {genError && <p className="text-xs text-destructive">{genError}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetGenDialog}>
                  취소
                </Button>
                <Button type="submit" disabled={genLoading} className="bg-ai-accent hover:opacity-90 text-ai-accent-foreground">
                  {genLoading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> 요청 중...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" /> 생성 요청
                    </>
                  )}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-foreground">Job #{genJob.id}</span>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-ai-accent/15 text-ai-accent">
                  {genStatusLabel[genJob.status]}
                </span>
                {!genTerminalStatuses.includes(genJob.status) && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-ai-accent" />
                )}
              </div>
              <p className="text-xs font-mono text-muted-foreground">{genJob.targetSpecPath}</p>
              {genJob.riskFlags && genJob.riskFlags !== '[]' && (
                <p className="text-[11px] text-warning font-mono break-all">위험 신호: {genJob.riskFlags}</p>
              )}
              {genJob.errorMessage && <p className="text-xs text-destructive">{genJob.errorMessage}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={resetGenDialog}>
                  닫기
                </Button>
                {genJob.status === 'NEEDS_REVIEW' && (
                  <Button type="button" size="sm" onClick={() => navigate('/ai-jobs')}>
                    AI 검토로 이동
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
