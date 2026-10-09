import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, KeyRound, ListChecks, Loader2, LogIn, Play, RefreshCw, Settings2, Sparkles, Square, Terminal, Upload } from 'lucide-react';
import { api } from '@/api/client';
import type { AuthStateStatus, Execution, PlaywrightTemplate, Project, RunnerActivity, RunnerOperationLog, ScenarioTree, TestSuite } from '@/types';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { ProjectFormDialog } from '@/components/ProjectFormDialog';
import { SourceExplorerTab } from '@/components/project/SourceExplorerTab';
import { ProjectDashboardTab } from '@/components/project/ProjectDashboardTab';
import { ScenarioTab, type SelectedCase, type SelectedScenario } from '@/components/project/ScenarioTab';
import { ExecutionsTab } from '@/components/project/ExecutionsTab';
import { ExecutionLogPanel } from '@/components/project/ExecutionLogPanel';
import { ResultsTab } from '@/components/project/ResultsTab';
import { AiAnalysisTab } from '@/components/project/AiAnalysisTab';
import { SchedulesTab } from '@/components/project/SchedulesTab';
import { StructureTab } from '@/components/project/StructureTab';
import { AnalysisProgress } from '@/components/project/AnalysisProgress';
import { useRunningAnalyses } from '@/hooks/useRunningAnalyses';
import { EnvVariablesDialog } from '@/components/project/EnvVariablesDialog';
import type { ExecutionDetail } from '@/types';
import {
  configuredEnvCount as countConfiguredEnvVariables,
  isRequiredEnvMissing,
  resolveEnvRequirementState,
} from '@/lib/envVariables';
import { confirmPlaywrightVersion } from '@/lib/projectRuntime';
import { cn } from '@/lib/utils';
import {
  DEFAULT_PROJECT_TAB,
  isValidProjectTab,
  projectTabPath,
  PROJECT_WORKSPACE_TABS,
  type ProjectTabId,
} from '@/config/projectWorkspace';

const dockerStatusLabel: Record<Project['dockerStatus'], string> = {
  RUNNING: '러너 실행 중',
  STOPPED: '러너 중지',
  ERROR: '오류',
  NOT_CONFIGURED: '미설정',
};

const runnerActivityLabel: Record<RunnerActivity, string> = {
  IDLE: '대기',
  TESTING: '테스트 중',
  UNAVAILABLE: '중지',
};

const runnerActivityColor: Record<RunnerActivity, string> = {
  IDLE: 'bg-success/10 text-success',
  TESTING: 'bg-primary/10 text-primary',
  UNAVAILABLE: 'bg-muted text-muted-foreground',
};

const hiddenSourceSegments = new Set([
  '.git',
  '.hg',
  '.svn',
  '.cache',
  '.gradle',
  '.idea',
  '.next',
  '.playwright',
  '.turbo',
  '.vscode',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'playwright-report',
  'target',
  'test-results',
]);

function configuredEnvCount(project: Project): number {
  return countConfiguredEnvVariables(project.envVariables);
}

function envButtonState(project: Project) {
  return resolveEnvRequirementState(project.loginEnvRequired, project.envVariables);
}

function envButtonTitle(project: Project): string {
  const count = configuredEnvCount(project);
  const state = envButtonState(project);
  if (state === 'required-missing') return '필수 환경변수 입력 필요';
  if (state === 'required-configured') return `필수 환경변수 ${count}개 입력됨`;
  if (state === 'optional-configured') return `환경변수 ${count}개 입력됨`;
  return '환경변수 설정';
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isHiddenSourcePath(path: string) {
  return path
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .some((segment) => hiddenSourceSegments.has(segment));
}

function sameExecutions(a: Execution[], b: Execution[]) {
  if (a.length !== b.length) return false;
  return a.every((left, index) => {
    const right = b[index];
    return Boolean(right)
      && left.id === right.id
      && left.status === right.status
      && left.totalTests === right.totalTests
      && left.passedTests === right.passedTests
      && left.failedTests === right.failedTests
      && left.skippedTests === right.skippedTests
      && left.durationMs === right.durationMs
      && left.finishedAt === right.finishedAt;
  });
}

function isActiveExecution(execution: Execution) {
  return execution.status === 'RUNNING'
    || execution.status === 'PENDING'
    || execution.status === 'CANCEL_REQUESTED';
}

export function ProjectDetailPage() {
  const runningAnalyses = useRunningAnalyses();
  const { projectId, tab: tabParam } = useParams<{ projectId: string; tab: string }>();
  const navigate = useNavigate();
  const activeTab: ProjectTabId = isValidProjectTab(tabParam) ? tabParam : DEFAULT_PROJECT_TAB;

  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (projectId && tabParam && !isValidProjectTab(tabParam)) {
      navigate(projectTabPath(projectId, DEFAULT_PROJECT_TAB), { replace: true });
    }
  }, [projectId, tabParam, navigate]);

  const goTab = (tab: ProjectTabId) => {
    if (projectId) navigate(projectTabPath(projectId, tab));
  };

  // 헤더에서 누른 동작은 주소(?do=)로 넘겨 테스트 탭이 받아 연다.
  const requestScenarioAction = (action: 'pick' | 'generate') => {
    if (projectId) navigate(`${projectTabPath(projectId, 'scenarios')}?do=${action}`);
  };

  const [scenarios, setScenarios] = useState<ScenarioTree | null>(null);
  const [scenariosLoading, setScenariosLoading] = useState(false);

  const [executions, setExecutions] = useState<Execution[]>([]);
  const [executionsLoading, setExecutionsLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [activeExecutionId, setActiveExecutionId] = useState<number | null>(null);
  const [selectedExecutionId, setSelectedExecutionId] = useState<number | null>(null);
  const [executionDetail, setExecutionDetail] = useState<ExecutionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [dockerLoading, setDockerLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [templates, setTemplates] = useState<PlaywrightTemplate[]>([]);
  const [scaffoldTemplateId, setScaffoldTemplateId] = useState('default');
  const [scaffolding, setScaffolding] = useState(false);
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [envDialogOpen, setEnvDialogOpen] = useState(false);
  const [runnerLogOpen, setRunnerLogOpen] = useState(false);
  const [runnerLog, setRunnerLog] = useState<RunnerOperationLog | null>(null);
  const [authState, setAuthState] = useState<AuthStateStatus | null>(null);
  const [authStateLoading, setAuthStateLoading] = useState(false);

  const loadFiles = useCallback(async () => {
    if (!projectId) return;
    setFiles(await api.listFiles(projectId));
  }, [projectId]);

  const loadScenarios = useCallback(async () => {
    if (!projectId) return;
    setScenariosLoading(true);
    try {
      setScenarios(await api.getScenarios(projectId));
    } catch {
      setScenarios(null);
    } finally {
      setScenariosLoading(false);
    }
  }, [projectId]);

  const loadExecutions = useCallback(async (options?: { silent?: boolean }) => {
    if (!projectId) return;
    if (!options?.silent) setExecutionsLoading(true);
    try {
      const next = await api.getExecutions(projectId);
      setExecutions((prev) => (sameExecutions(prev, next) ? prev : next));
    } finally {
      if (!options?.silent) setExecutionsLoading(false);
    }
  }, [projectId]);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const p = await api.getProject(projectId);
      setProject(p);
      await loadFiles();
      await loadScenarios();
      await loadExecutions();
    } catch {
      navigate('/projects');
    } finally {
      setLoading(false);
    }
  }, [projectId, navigate, loadFiles, loadScenarios, loadExecutions]);

  const loadRunnerLog = useCallback(async () => {
    if (!projectId) return;
    setRunnerLog(await api.getDockerLogs(projectId));
  }, [projectId]);

  const loadAuthState = useCallback(async () => {
    if (!projectId) return;
    setAuthStateLoading(true);
    try {
      setAuthState(await api.getAuthState(projectId));
    } catch {
      setAuthState(null);
    } finally {
      setAuthStateLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
    api.getTemplates().then(setTemplates).catch(() => []);
  }, [load]);

  useEffect(() => {
    if (activeTab === 'settings') {
      loadAuthState().catch(() => undefined);
    }
  }, [activeTab, loadAuthState]);

  useEffect(() => {
    if (!runnerLogOpen) return;
    loadRunnerLog().catch(() => undefined);
    const t = setInterval(() => loadRunnerLog().catch(() => undefined), dockerLoading ? 1000 : 2500);
    return () => clearInterval(t);
  }, [dockerLoading, loadRunnerLog, runnerLogOpen]);

  useEffect(() => {
    const hasRunning = executions.some(isActiveExecution);
    if (!hasRunning) return;
    const t = setInterval(() => loadExecutions({ silent: true }), 1500);
    return () => clearInterval(t);
  }, [executions, loadExecutions]);

  useEffect(() => {
    if (activeTab !== 'results') return;
    if (executions.length === 0) {
      setSelectedExecutionId(null);
      setExecutionDetail(null);
      return;
    }
    if (!selectedExecutionId && executions.length > 0) {
      setSelectedExecutionId(executions[0].id);
      return;
    }
    if (selectedExecutionId && !executions.some((ex) => ex.id === selectedExecutionId)) {
      setSelectedExecutionId(executions[0].id);
      return;
    }
    if (selectedExecutionId) {
      const shouldShowLoader = executionDetail?.execution.id !== selectedExecutionId;
      if (shouldShowLoader) setDetailLoading(true);
      api.getExecutionDetail(selectedExecutionId)
        .then(setExecutionDetail)
        .catch(() => setExecutionDetail(null))
        .finally(() => {
          if (shouldShowLoader) setDetailLoading(false);
        });
    }
  }, [activeTab, selectedExecutionId, executions, executionDetail?.execution.id]);

  const handleRun = async (options?: { grep?: string; specPath?: string; specPaths?: string[]; caseTitle?: string; sequential?: boolean }) => {
    if (!projectId) return;
    if (!project) return;
    if (project && isRequiredEnvMissing(project.loginEnvRequired, project.envVariables)) {
      alert('테스트 계정 환경변수가 필요합니다. 환경변수를 먼저 입력하세요.');
      setEnvDialogOpen(true);
      return;
    }

    setRunning(true);
    try {
      if (project && !(await confirmPlaywrightVersion(project, '테스트 실행'))) {
        return;
      }
      let runnableProject = project;
      if (runnableProject.dockerStatus !== 'RUNNING'
        && !(runnableProject.dockerEnabled && runnableProject.runnerLifecycle === 'EPHEMERAL')) {
        if (runnableProject.dockerEnabled && runnableProject.runnerLifecycle === 'PERSISTENT') {
          runnableProject = await api.startDocker(projectId);
          setProject(runnableProject);
        } else {
          alert('Docker Runner를 사용할 수 없습니다. 프로젝트 설정을 확인하세요.');
          goTab('settings');
          return;
        }
      }
      const ex = await api.runTests(projectId, options);
      setActiveExecutionId(ex.id);
      setSelectedExecutionId(ex.id);
      goTab('runs');
      await loadExecutions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '실행 실패');
    } finally {
      setRunning(false);
    }
  };

  const handleRunCase = (selected: SelectedCase) => {
    handleRun({
      grep: selected.grep,
      specPath: selected.specPath,
      caseTitle: selected.title,
    });
  };

  const handleRunCases = (selected: SelectedCase[]) => {
    if (selected.length === 0) return;
    const specPaths = [...new Set(selected.map((item) => item.specPath))];
    const grep = selected.map((item) => escapeRegex(item.grep)).join('|');
    handleRun({
      grep: `(?:${grep})`,
      specPaths,
      caseTitle: `선택 케이스 ${selected.length}건`,
    });
  };

  const handleRunScenario = (selected: SelectedScenario) => {
    handleRun({
      grep: selected.grep ?? undefined,
      specPath: selected.specPath,
      caseTitle: selected.title,
    });
  };

  const handleRunSuite = (suite: TestSuite) => {
    handleRun({
      grep: suite.grep ?? undefined,
      specPaths: suite.specPaths,
      caseTitle: `묶음: ${suite.name}`,
      sequential: suite.sequential,
    });
  };

  const handleCancelExecution = async (id: number) => {
    const ok = confirm(`실행 #${id}을(를) 중단하시겠습니까?`);
    if (!ok) return;
    try {
      const cancelled = await api.cancelExecution(id);
      setExecutions((prev) => prev.map((execution) =>
        execution.id === id ? cancelled : execution
      ));
      await loadExecutions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '실행 중단 실패');
    }
  };

  const handleDeleteExecution = async (id: number) => {
    const ok = confirm([
      `실행 #${id} 이력을 삭제하시겠습니까?`,
      '',
      'DB 이력, 실행 로그, 리포트, 비디오/스크린샷/trace 파일이 함께 삭제됩니다.',
    ].join('\n'));
    if (!ok) return;
    try {
      await api.deleteExecution(id);
      if (selectedExecutionId === id) {
        setSelectedExecutionId(null);
        setExecutionDetail(null);
      }
      await loadExecutions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '실행 이력 삭제 실패');
    }
  };

  const handleResetExecutions = async () => {
    if (!projectId) return;
    const ok = confirm([
      `${project?.projectName ?? projectId}의 실행 이력을 모두 초기화하시겠습니까?`,
      '',
      'DB 이력, 실행 로그, 리포트, 비디오/스크린샷/trace 파일이 모두 삭제됩니다.',
      '이 작업은 되돌릴 수 없습니다.',
    ].join('\n'));
    if (!ok) return;
    try {
      await api.resetExecutions(projectId);
      setActiveExecutionId(null);
      setSelectedExecutionId(null);
      setExecutionDetail(null);
      await loadExecutions();
    } catch (err) {
      alert(err instanceof Error ? err.message : '실행 이력 초기화 실패');
    }
  };

  const handleSelectExecution = (id: number) => {
    setSelectedExecutionId(id);
    goTab('results');
  };

  const handleOpenFile = (path: string) => {
    setOpenFilePath(path);
    goTab('source');
  };

  if (loading || !project || !projectId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentTabMeta = PROJECT_WORKSPACE_TABS.find((t) => t.id === activeTab);
  const dockerRunning = project.dockerStatus === 'RUNNING';
  const canAutoStartRunner = project.dockerEnabled && project.runnerLifecycle === 'EPHEMERAL';
  const persistentRunner = project.runnerLifecycle === 'PERSISTENT';
  const canStartPersistentRunner = project.dockerEnabled && persistentRunner;
  const hasActiveExecutions = executions.some(isActiveExecution);
  const runnerActivity: RunnerActivity = dockerRunning
    ? hasActiveExecutions ? 'TESTING' : project.runnerActivity ?? 'IDLE'
    : 'UNAVAILABLE';
  const runnerBadgeLabel = dockerRunning
    ? `Runner ${runnerActivityLabel[runnerActivity]}`
    : canAutoStartRunner
      ? 'Runner 없음'
      : 'Runner 중지';
  const hasVisibleSourceFiles = files.some((file) => !isHiddenSourcePath(file));
  const envState = envButtonState(project);
  const missingRequiredEnv = envState === 'required-missing';
  const canRunTests = (dockerRunning || canAutoStartRunner || canStartPersistentRunner) && !missingRequiredEnv && !running;

  const handleScaffold = async () => {
    if (hasVisibleSourceFiles) {
      const ok = confirm('이미 소스 파일이 있습니다. 템플릿을 생성하면 기존 테스트 코드와 충돌할 수 있습니다. 계속하시겠습니까?');
      if (!ok) return;
    }
    setScaffolding(true);
    try {
      await api.scaffoldProject(projectId, scaffoldTemplateId, hasVisibleSourceFiles);
      await loadFiles();
      await loadScenarios();
    } finally {
      setScaffolding(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-foreground">{project.projectName}</h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{project.projectId}</span>
            {currentTabMeta && (
              <span className="text-muted-foreground"> · {currentTabMeta.label} — {currentTabMeta.description}</span>
            )}
          </p>
          <span className={cn('mt-2 inline-flex px-2 py-0.5 rounded-full text-xs font-medium', runnerActivityColor[runnerActivity])}>
            {runnerBadgeLabel}
          </span>
          {projectId && runningAnalyses[projectId] && (
            <AnalysisProgress
              className="ml-2 mt-2"
              screenCount={runningAnalyses[projectId].screenCount}
              processedCount={runningAnalyses[projectId].processedCount}
              etaSeconds={runningAnalyses[projectId].etaSeconds}
            />
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => requestScenarioAction('pick')}
          title="실행할 케이스를 골라 묶어서 실행합니다"
        >
          <ListChecks className="h-4 w-4" />
          선택 실행
        </Button>
        <Button
          variant="secondary"
          onClick={() => requestScenarioAction('generate')}
          title="테스트하고 싶은 내용을 문장으로 적으면 AI가 테스트 코드를 만듭니다"
        >
          <Sparkles className="h-4 w-4" />
          AI로 만들기
        </Button>
        <Button
          onClick={() => handleRun()}
          disabled={!canRunTests}
          title={
            missingRequiredEnv
              ? '필수 환경변수 입력 후 실행할 수 있습니다'
              : dockerRunning || canAutoStartRunner
                ? undefined
                : canStartPersistentRunner
                  ? '상주 Docker Runner를 시작한 뒤 실행합니다'
                  : '설정에서 Docker Runner를 먼저 시작하세요'
          }
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          전체 실행
        </Button>
        </div>
      </div>

      {!dockerRunning && !canAutoStartRunner && !canStartPersistentRunner && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="truncate">테스트 실행 전 Docker Runner를 시작해야 합니다.</span>
          </div>
          <Button size="sm" variant="outline" onClick={() => goTab('settings')}>
            설정으로 이동
          </Button>
        </div>
      )}

      {missingRequiredEnv && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="truncate">테스트 계정 환경변수가 필요합니다.</span>
          </div>
          <Button size="sm" variant="outline" onClick={() => setEnvDialogOpen(true)}>
            환경변수 입력
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {activeTab === 'source' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {!hasVisibleSourceFiles && (
                  <>
                    <select
                      className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground"
                      value={scaffoldTemplateId}
                      onChange={(e) => setScaffoldTemplateId(e.target.value)}
                    >
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <Button size="sm" variant="outline" disabled={scaffolding} onClick={handleScaffold}>
                      템플릿 생성
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEnvDialogOpen(true)}
                  className={cn(
                    envState === 'required-missing' && 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20',
                    envState === 'required-configured' && 'border-success/30 bg-success/10 text-success hover:bg-success/20',
                    envState === 'optional-configured' && 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'
                  )}
                  title={envButtonTitle(project)}
                >
                  <Settings2 className="h-3 w-3 mr-1" />
                  환경변수
                </Button>
                <label className="cursor-pointer">
                  <input type="file" accept=".zip" className="hidden" onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploading(true);
                    try {
                      await api.uploadZip(projectId, file);
                      await loadFiles();
                      await loadScenarios();
                    } finally { setUploading(false); e.target.value = ''; }
                  }} />
                  <span className="inline-flex items-center gap-1 h-8 px-3 text-xs rounded-md bg-primary text-primary-foreground">
                    {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                    ZIP
                  </span>
                </label>
              </div>
              <SourceExplorerTab
                projectId={projectId}
                project={project}
                files={files}
                initialPath={openFilePath}
                onFilesChange={async () => { await loadFiles(); await loadScenarios(); }}
              />
            </div>
          )}

          {activeTab === 'dashboard' && (
            <ProjectDashboardTab
              project={project}
              executions={executions}
              onRun={() => handleRun()}
              onOpenSource={() => goTab('source')}
              onOpenRuns={() => goTab('runs')}
              onOpenResults={() => goTab('results')}
            />
          )}

          {activeTab === 'scenarios' && projectId && (
            <ScenarioTab
              projectId={projectId}
              tree={scenarios}
              executions={executions}
              loading={scenariosLoading}
              onRefresh={loadScenarios}
              onRunCase={handleRunCase}
              onRunCases={handleRunCases}
              onRunScenario={handleRunScenario}
              onRunSuite={handleRunSuite}
              onOpenFile={handleOpenFile}
              onViewExecution={handleSelectExecution}
            />
          )}

          {activeTab === 'runs' && (
            <ExecutionsTab
              executions={executions}
              loading={executionsLoading}
              activeExecutionId={activeExecutionId}
              onRefresh={loadExecutions}
              onSelect={handleSelectExecution}
              onCancel={handleCancelExecution}
              onDelete={handleDeleteExecution}
              onReset={handleResetExecutions}
              selectedId={selectedExecutionId}
            />
          )}

          {activeTab === 'results' && (
            <div className="space-y-4">
              {executions.length > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-medium text-foreground">최종 결과</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      기본으로 가장 최근 실행 결과를 표시합니다.
                    </p>
                  </div>
                  <select
                    className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground"
                    value={selectedExecutionId ?? executions[0].id}
                    onChange={(e) => setSelectedExecutionId(Number(e.target.value))}
                  >
                    {executions.map((ex) => (
                      <option key={ex.id} value={ex.id}>
                        #{ex.id} · {ex.caseTitle ?? ex.grepFilter ?? '전체'} · {ex.status}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <ExecutionLogPanel executionId={selectedExecutionId} />
              <ResultsTab detail={executionDetail} loading={detailLoading} />
            </div>
          )}

          {activeTab === 'ai-analysis' && (
            <AiAnalysisTab
              projectId={projectId}
              executions={executions}
              selectedExecutionId={selectedExecutionId}
              onSelectExecution={handleSelectExecution}
            />
          )}

          {activeTab === 'structure' && projectId && (
            <StructureTab projectId={projectId} />
          )}

          {activeTab === 'schedules' && projectId && (
            <SchedulesTab projectId={projectId} />
          )}

          {activeTab === 'settings' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="font-medium">환경 정보</h3>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEnvDialogOpen(true)}
                    className={cn(
                      envState === 'required-missing' && 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20',
                      envState === 'required-configured' && 'border-success/30 bg-success/10 text-success hover:bg-success/20',
                      envState === 'optional-configured' && 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'
                    )}
                    title={envButtonTitle(project)}
                  >
                    <KeyRound className="h-4 w-4" />
                    환경변수
                  </Button>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ['순번', String(project.displayOrder ?? 0)],
                    ['서버 구분', project.serverType === 'PROD' ? '운영' : project.serverType === 'TEST' ? '테스트' : '개발'],
                    ['프로젝트 설명', project.description ?? '-'],
                    ['테스트 목적', project.testPurpose ?? '-'],
                    ['관리자', project.managerName ?? '-'],
                    ['연락처', project.managerContact ?? '-'],
                    ['Node', project.nodeVersion],
                    ['Playwright', project.playwrightVersion],
                    ['PM', project.packageManager],
                    ['Test', project.testCommand],
                    ['Base URL', project.baseUrl ?? '-'],
                    ['Runner lifecycle', project.runnerLifecycle === 'EPHEMERAL' ? 'Ephemeral' : 'Persistent'],
                    ['테스트 계정 env', project.loginEnvRequired ? '필수' : '선택'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-muted-foreground text-xs">{k}</dt>
                      <dd className="font-medium truncate">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">
                  AI-TestOps 일반 실행은 <span className="font-mono">playwright test</span> 명령에
                  <span className="font-mono"> --project=chromium --retries=0</span>을 기본 적용합니다.
                </p>
                <Button className="mt-4" variant="outline" onClick={() => setEditOpen(true)}>설정 수정</Button>
              </div>
              <div>
                <h3 className="font-medium mb-3">Docker Runner</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  {persistentRunner
                    ? '상주 러너는 미리 시작해두고 테스트 실행 시 재사용합니다.'
                    : '일회용 러너는 테스트 실행 시 자동 생성되고 종료 후 삭제됩니다.'}
                </p>
                {persistentRunner && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    <Button size="sm" disabled={dockerLoading || dockerRunning} onClick={async () => {
                      setDockerLoading(true);
                      setRunnerLogOpen(true);
                      setRunnerLog({ projectId, output: '[playops] Docker Runner 시작 요청...', lineCount: 1 });
                      try {
                        if (!(await confirmPlaywrightVersion(project, 'Docker Runner 시작'))) {
                          return;
                        }
                        loadRunnerLog().catch(() => undefined);
                        setProject(await api.startDocker(projectId));
                        await loadRunnerLog();
                      } catch (err) {
                        loadRunnerLog().catch(() => undefined);
                        alert(err instanceof Error ? err.message : 'Docker Runner 시작 실패');
                      } finally {
                        setDockerLoading(false);
                      }
                    }}>
                      {dockerLoading && !dockerRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      시작
                    </Button>
                    <Button size="sm" variant="outline" disabled={dockerLoading || !dockerRunning} onClick={async () => {
                      setDockerLoading(true);
                      setRunnerLogOpen(true);
                      setRunnerLog({ projectId, output: '[playops] Docker Runner 중지 요청...', lineCount: 1 });
                      try {
                        loadRunnerLog().catch(() => undefined);
                        setProject(await api.stopDocker(projectId));
                        await loadRunnerLog();
                      } catch (err) {
                        loadRunnerLog().catch(() => undefined);
                        alert(err instanceof Error ? err.message : 'Docker Runner 중지 실패');
                      } finally {
                        setDockerLoading(false);
                      }
                    }}>
                      {dockerLoading && dockerRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
                      중지
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      const nextOpen = !runnerLogOpen;
                      setRunnerLogOpen(nextOpen);
                      if (nextOpen) loadRunnerLog().catch(() => undefined);
                    }}>
                      <Terminal className="h-3 w-3" />
                      로그보기
                    </Button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  상태: {dockerStatusLabel[project.dockerStatus]}
                  {dockerRunning && <span> · {runnerActivityLabel[runnerActivity]}</span>}
                </p>
                {project.dockerContainerId && (
                  <p className="text-xs text-muted-foreground mt-1">컨테이너: {project.dockerContainerId}</p>
                )}
                {persistentRunner && runnerLogOpen && (
                  <div className="mt-3 overflow-hidden rounded-md border border-sidebar-active bg-sidebar">
                    <div className="flex items-center justify-between border-b border-sidebar-active px-3 py-2 text-xs text-sidebar-foreground">
                      <span>Runner 로그</span>
                      {dockerLoading && (
                        <span className="inline-flex items-center gap-1 text-primary">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          갱신 중
                        </span>
                      )}
                    </div>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-xs leading-5 text-sidebar-foreground">
                      {runnerLog?.output?.trim() || '아직 표시할 로그가 없습니다.'}
                    </pre>
                  </div>
                )}
              </div>

              <div>
                <h3 className="font-medium mb-3">로그인 선행 시나리오</h3>
                {!project.loginSetupSpecPath ? (
                  <p className="text-sm text-muted-foreground">
                    설정되지 않았습니다. "설정 수정"에서 로그인 선행 spec을 지정하면 매 실행마다 로그인하지 않도록
                    세션(storageState)을 재사용할 수 있습니다.
                  </p>
                ) : (
                  <div className="space-y-2 text-sm">
                    <dl className="grid grid-cols-2 gap-3">
                      <div>
                        <dt className="text-muted-foreground text-xs">대상 spec</dt>
                        <dd className="font-medium font-mono text-xs truncate">{project.loginSetupSpecPath}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground text-xs">세션 유효 시간</dt>
                        <dd className="font-medium">{project.storageStateMaxAgeMinutes ?? 720}분</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground text-xs">세션 상태</dt>
                        <dd className="font-medium">
                          {authStateLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          ) : authState?.exists ? (
                            <span className="text-success">
                              사용 중{authState.expiresAt && ` (~${new Date(authState.expiresAt).toLocaleString('ko-KR')})`}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">없음 (다음 실행 때 생성)</span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground text-xs">마지막 생성</dt>
                        <dd className="font-medium">
                          {authState?.updatedAt ? new Date(authState.updatedAt).toLocaleString('ko-KR') : '-'}
                        </dd>
                      </div>
                    </dl>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={authStateLoading}
                        onClick={loadAuthState}
                      >
                        <RefreshCw className={cn('h-3.5 w-3.5', authStateLoading && 'animate-spin')} />
                        새로고침
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={authStateLoading || !authState?.exists}
                        onClick={async () => {
                          await api.clearAuthState(projectId);
                          await loadAuthState();
                        }}
                      >
                        <LogIn className="h-3.5 w-3.5" />
                        지금 재생성 (세션 삭제)
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ProjectFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        onSubmit={async (data) => { setProject(await api.updateProject(projectId, data)); setEditOpen(false); }}
        title="프로젝트 설정 수정"
        initial={project}
      />

      <EnvVariablesDialog
        open={envDialogOpen}
        onOpenChange={setEnvDialogOpen}
        project={project}
        onSaved={setProject}
      />
    </div>
  );
}
