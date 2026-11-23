import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderKanban, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { api } from '@/api/client';
import { useAccess } from '@/lib/access';
import { useRunningAnalyses } from '@/hooks/useRunningAnalyses';
import { projectTabPath } from '@/config/projectWorkspace';
import type { Project, ProjectFormData, ProjectStatus } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ProjectFormDialog } from '@/components/ProjectFormDialog';
import { AiBootstrapProgressDialog } from '@/components/AiBootstrapProgressDialog';
import { EnvVariablesDialog } from '@/components/project/EnvVariablesDialog';
import { ProjectCard, isRunnerReady } from '@/components/project/ProjectCard';
import { ENV_ASK_PM, isRequiredEnvMissing } from '@/lib/envVariables';
import { confirmPlaywrightVersion, SERVER_RUN_UNAVAILABLE_MESSAGE } from '@/lib/projectRuntime';
import { confirmFullRun } from '@/lib/runConfirm';
import { cn, projectStatusLabel } from '@/lib/utils';
import { ConsoleEyebrow } from '@/components/console/ConsoleText';

/** 등록 직후 카드를 강조해 두는 시간 */
const JUST_CREATED_MS = 60_000;

/** 상태 거르기. 기본은 종료를 뺀 나머지 (#117) */
type StatusFilter = 'OPEN' | 'ALL' | ProjectStatus;

function matchesStatus(project: Project, filter: StatusFilter) {
  const status = project.status ?? 'PLANNED';
  return filter === 'ALL' || (filter === 'OPEN' ? status !== 'CLOSED' : status === filter);
}

function matchesQuery(project: Project, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [project.projectId, project.projectName].some((value) => value.toLowerCase().includes(normalized));
}

export function ProjectsPage() {
  const runningAnalyses = useRunningAnalyses();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN');
  // 계획 완료율(0~100). 홈 화면처럼 프로젝트마다 계획을 받아 온다.
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [aiBootstrap, setAiBootstrap] = useState<{ projectId: string; instruction: string } | null>(null);
  const [envProject, setEnvProject] = useState<Project | null>(null);
  const [testLoadingId, setTestLoadingId] = useState<string | null>(null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  // 프로젝트 등록 · PM 지정은 관리자만 (#106)
  const access = useAccess();
  const { admin } = access;
  const [pmCandidates, setPmCandidates] = useState<{ id: number; label: string }[]>([]);

  useEffect(() => {
    if (!dialogOpen || !admin) return;
    api.getUsers()
      .then((users) => setPmCandidates(users
        .filter((u) => u.role !== 'ADMIN')
        .map((u) => ({ id: u.id, label: u.displayName ? `${u.displayName} (${u.username})` : u.username }))))
      .catch(() => setPmCandidates([]));
  }, [dialogOpen, admin]);

  const loadProjects = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      setProjects(await api.getProjects());
    } catch {
      setProjects([]);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const projectIdsKey = projects.map((p) => p.projectId).join('\n');
  useEffect(() => {
    let alive = true;
    for (const projectId of projectIdsKey ? projectIdsKey.split('\n') : []) {
      api.plan.get(projectId)
        .then((plan) => alive && setProgress((prev) => ({ ...prev, [projectId]: Math.round(plan.summary.completionRate * 100) })))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [projectIdsKey]);

  // 실행 중인 프로젝트가 있으면 짧은 주기로 상태를 새로 받아온다.
  useEffect(() => {
    const hasActiveExecution = projects.some((project) =>
      project.latestExecutionStatus === 'PENDING'
      || project.latestExecutionStatus === 'RUNNING'
      || project.latestExecutionStatus === 'CANCEL_REQUESTED'
      || project.runnerActivity === 'TESTING'
    );
    if (!hasActiveExecution) return;
    const timer = setInterval(() => loadProjects({ silent: true }), 1500);
    return () => clearInterval(timer);
  }, [projects, loadProjects]);

  // 방금 등록한 카드 강조는 잠시 뒤 스스로 걷힌다.
  useEffect(() => {
    if (!justCreatedId) return;
    const timer = setTimeout(() => setJustCreatedId(null), JUST_CREATED_MS);
    return () => clearTimeout(timer);
  }, [justCreatedId]);

  const filteredProjects = useMemo(() => projects
    .filter((project) => matchesQuery(project, query) && matchesStatus(project, statusFilter))
    // 방금 등록한 프로젝트를 맨 앞에, 그다음은 지정한 순서대로
    .sort((a, b) => {
      if (a.projectId === justCreatedId) return -1;
      if (b.projectId === justCreatedId) return 1;
      return (a.displayOrder ?? 0) - (b.displayOrder ?? 0)
        || a.projectName.localeCompare(b.projectName, 'ko');
    }), [projects, query, statusFilter, justCreatedId]);

  const handleCreate = async (data: ProjectFormData, aiBootstrapInstruction?: string) => {
    // 아이디는 서버가 붙인다(#120). 돌려받은 아이디로 강조 · 첫 테스트 생성을 잇는다.
    const created = await api.createProject(data);
    setDialogOpen(false);
    setJustCreatedId(created.projectId);
    setQuery('');
    loadProjects();
    if (aiBootstrapInstruction) {
      setAiBootstrap({ projectId: created.projectId, instruction: aiBootstrapInstruction });
    }
  };

  const replaceProject = (updated: Project) => {
    setProjects((prev) => prev.map((project) =>
      project.projectId === updated.projectId ? updated : project
    ));
  };

  const handleEnvSaved = (updated: Project) => {
    replaceProject(updated);
    setEnvProject(updated);
  };

  const handleStopProject = async (executionId: number) => {
    if (!confirm('실행 중인 테스트를 중지할까요?')) return;
    try {
      await api.cancelExecution(executionId);
    } catch (err) {
      alert(err instanceof Error ? err.message : '실행 중지 실패');
    }
    loadProjects({ silent: true });
  };

  const handleRunProject = async (project: Project) => {
    if (isRequiredEnvMissing(project.loginEnvRequired, project.envVariables)) {
      if (!access.canManage(project.projectId)) {
        alert(ENV_ASK_PM);
        return;
      }
      alert('테스트 계정 환경변수가 필요합니다. 환경변수를 먼저 입력하세요.');
      setEnvProject(project);
      return;
    }

    setTestLoadingId(project.projectId);
    try {
      if (!(await confirmFullRun(project.projectName, () => api.getScenarios(project.projectId)))) return;
      if (!(await confirmPlaywrightVersion(project, '테스트 실행'))) {
        return;
      }
      let runnableProject = project;
      if (!isRunnerReady(runnableProject)) {
        if (runnableProject.dockerEnabled && runnableProject.runnerLifecycle === 'PERSISTENT') {
          runnableProject = await api.startDocker(runnableProject.projectId);
          replaceProject(runnableProject);
        } else {
          alert(runnableProject.dockerEnabled
            ? 'Docker Runner를 사용할 수 없습니다. 프로젝트 설정을 확인하세요.'
            : SERVER_RUN_UNAVAILABLE_MESSAGE);
          return;
        }
      }

      const execution = await api.runTests(runnableProject.projectId);
      setProjects((prev) => prev.map((item) =>
        item.projectId === runnableProject.projectId
          ? {
              ...item,
              runnerActivity: 'TESTING',
              latestExecutionId: execution.id,
              latestExecutionStatus: execution.status,
              latestExecutionAt: execution.startedAt ?? execution.createdAt,
              latestExecutionDurationMs: execution.durationMs,
            }
          : item
      ));
    } catch (err) {
      alert(err instanceof Error ? err.message : '테스트 실행에 실패했습니다.');
    } finally {
      setTestLoadingId(null);
    }
  };

  // 팀원은 PM이 초대한 프로젝트만 보이므로, 빈 목록이면 등록 대신 초대를 안내한다.
  const emptyReason = projects.length > 0
    ? { title: '조건에 맞는 프로젝트가 없습니다', desc: '검색어나 상태를 바꿔보세요.' }
    : admin
      ? { title: '등록된 프로젝트가 없습니다', desc: '사이트 주소만 있으면 바로 시작할 수 있습니다.' }
      : { title: '소속된 프로젝트가 없습니다', desc: 'PM에게 초대를 요청하세요.' };

  return (
    <div className="@container space-y-5 p-6">
      <div className="flex flex-col gap-3 @min-[52rem]:flex-row @min-[52rem]:items-center @min-[52rem]:justify-between">
        <div>
          <ConsoleEyebrow>WORKSPACE // PROJECTS</ConsoleEyebrow>
          <h2 className="text-[24px] font-bold leading-tight text-foreground">프로젝트</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">
            사이트마다 프로젝트를 하나씩 둡니다. 카드를 열면 작업 화면으로 들어갑니다.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => loadProjects()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            새로고침
          </Button>
          {admin && (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              프로젝트 등록
            </Button>
          )}
        </div>
      </div>

      {/* 이름 검색 · 상태 거르기 */}
      <div className="flex flex-col gap-3 @min-[52rem]:flex-row @min-[52rem]:items-center">
        <div className="relative w-full @min-[52rem]:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="프로젝트 이름 검색"
            className="h-10 pl-9"
          />
        </div>
        <select
          aria-label="상태로 거르기"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="h-10 rounded-sm border border-border bg-card px-3 text-[15px] text-foreground"
        >
          <option value="OPEN">종료 빼고 보기</option>
          {(Object.keys(projectStatusLabel) as ProjectStatus[]).map((s) => (
            <option key={s} value={s}>{projectStatusLabel[s]}</option>
          ))}
          <option value="ALL">전체</option>
        </select>
      </div>

      {loading ? (
        <div className="flex min-h-[320px] items-center justify-center rounded-md border border-border bg-card">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="flex min-h-[320px] items-center justify-center rounded-md border border-dashed border-border bg-card">
          <div className="max-w-sm text-center">
            <FolderKanban className="mx-auto h-10 w-10 text-muted-foreground" />
            <h3 className="mt-4 text-[19px] font-bold text-foreground">{emptyReason.title}</h3>
            <p className="mt-2 text-[15px] text-muted-foreground">{emptyReason.desc}</p>
            {projects.length === 0 && admin && (
              <Button className="mt-4" onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4" />
                프로젝트 등록
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 @min-[40rem]:grid-cols-2 @min-[68rem]:grid-cols-3">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.projectId}
              project={project}
              running={testLoadingId === project.projectId}
              justCreated={project.projectId === justCreatedId}
              analysis={runningAnalyses[project.projectId]}
              onOpen={() => navigate(projectTabPath(project.projectId, 'dashboard'))}
              onRun={() => handleRunProject(project)}
              onStop={handleStopProject}
              onEnv={access.canManage(project.projectId) ? () => setEnvProject(project) : undefined}
              onGo={(tab) => navigate(projectTabPath(project.projectId, tab))}
              planProgress={progress[project.projectId]}
            />
          ))}
        </div>
      )}

      <ProjectFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleCreate}
        title="프로젝트 등록"
        pmCandidates={pmCandidates}
      />

      {aiBootstrap && (
        <AiBootstrapProgressDialog
          open
          projectId={aiBootstrap.projectId}
          instruction={aiBootstrap.instruction}
          onClose={() => {
            setAiBootstrap(null);
            loadProjects();
          }}
          onOpenProject={() => {
            const target = aiBootstrap.projectId;
            setAiBootstrap(null);
            navigate(projectTabPath(target, 'source'));
          }}
        />
      )}

      {envProject && (
        <EnvVariablesDialog
          open={!!envProject}
          onOpenChange={(open) => !open && setEnvProject(null)}
          project={envProject}
          onSaved={handleEnvSaved}
        />
      )}
    </div>
  );
}
