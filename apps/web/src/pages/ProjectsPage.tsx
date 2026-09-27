import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderKanban, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { api } from '@/api/client';
import { projectTabPath } from '@/config/projectWorkspace';
import type { Project, ProjectFormData } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ProjectFormDialog } from '@/components/ProjectFormDialog';
import { AiBootstrapProgressDialog } from '@/components/AiBootstrapProgressDialog';
import { EnvVariablesDialog } from '@/components/project/EnvVariablesDialog';
import { ProjectCard, isRunnerReady } from '@/components/project/ProjectCard';
import { isRequiredEnvMissing } from '@/lib/envVariables';
import { confirmPlaywrightVersion } from '@/lib/projectRuntime';
import { cn } from '@/lib/utils';

type ProjectFilter = 'ALL' | 'RUNNING' | 'TESTING' | 'ERROR' | 'EPHEMERAL';

/** 등록 직후 카드를 강조해 두는 시간 */
const JUST_CREATED_MS = 60_000;

function matchesQuery(project: Project, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    project.projectId,
    project.projectName,
    project.managerName,
    project.managerContact,
    project.baseUrl,
    project.testPurpose,
  ].some((value) => value?.toLowerCase().includes(normalized));
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ProjectFilter>('ALL');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [aiBootstrap, setAiBootstrap] = useState<{ projectId: string; instruction: string } | null>(null);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [envProject, setEnvProject] = useState<Project | null>(null);
  const [testLoadingId, setTestLoadingId] = useState<string | null>(null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

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

  const stats = useMemo(() => ({
    total: projects.length,
    ready: projects.filter(isRunnerReady).length,
    testing: projects.filter((project) => project.runnerActivity === 'TESTING').length,
    failed: projects.filter((project) =>
      project.latestExecutionStatus === 'FAILED' || project.latestExecutionStatus === 'ERROR'
    ).length,
    ephemeral: projects.filter((project) => project.runnerLifecycle === 'EPHEMERAL').length,
  }), [projects]);

  const filteredProjects = useMemo(() => projects
    .filter((project) => {
      if (!matchesQuery(project, query)) return false;
      if (filter === 'RUNNING') return isRunnerReady(project);
      if (filter === 'TESTING') return project.runnerActivity === 'TESTING';
      if (filter === 'ERROR') return project.dockerStatus === 'ERROR'
        || project.latestExecutionStatus === 'FAILED'
        || project.latestExecutionStatus === 'ERROR';
      if (filter === 'EPHEMERAL') return project.runnerLifecycle === 'EPHEMERAL';
      return true;
    })
    // 방금 등록한 프로젝트를 맨 앞에, 그다음은 지정한 순서대로
    .sort((a, b) => {
      if (a.projectId === justCreatedId) return -1;
      if (b.projectId === justCreatedId) return 1;
      return (a.displayOrder ?? 0) - (b.displayOrder ?? 0)
        || a.projectName.localeCompare(b.projectName, 'ko');
    }), [projects, query, filter, justCreatedId]);

  const handleCreate = async (data: ProjectFormData, aiBootstrapInstruction?: string) => {
    await api.createProject(data);
    setDialogOpen(false);
    setJustCreatedId(data.projectId);
    setFilter('ALL');
    setQuery('');
    loadProjects();
    if (aiBootstrapInstruction) {
      setAiBootstrap({ projectId: data.projectId, instruction: aiBootstrapInstruction });
    }
  };

  const handleUpdate = async (data: ProjectFormData) => {
    if (!editProject) return;
    await api.updateProject(editProject.projectId, data);
    setEditProject(null);
    loadProjects();
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

  const handleDelete = async (projectId: string) => {
    const ok = confirm([
      `프로젝트 "${projectId}"를 삭제하시겠습니까?`,
      '',
      '프로젝트 설정, 테스트 파일, 실행 이력과 리포트가 함께 삭제됩니다.',
    ].join('\n'));
    if (!ok) return;
    await api.deleteProject(projectId);
    loadProjects();
  };

  const handleRunProject = async (project: Project) => {
    if (isRequiredEnvMissing(project.loginEnvRequired, project.envVariables)) {
      alert('테스트 계정 환경변수가 필요합니다. 환경변수를 먼저 입력하세요.');
      setEnvProject(project);
      return;
    }

    setTestLoadingId(project.projectId);
    try {
      if (!(await confirmPlaywrightVersion(project, '테스트 실행'))) {
        return;
      }
      let runnableProject = project;
      if (!isRunnerReady(runnableProject)) {
        if (runnableProject.dockerEnabled && runnableProject.runnerLifecycle === 'PERSISTENT') {
          runnableProject = await api.startDocker(runnableProject.projectId);
          replaceProject(runnableProject);
        } else {
          alert('Docker Runner를 사용할 수 없습니다. 프로젝트 설정을 확인하세요.');
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

  const filterButtons: Array<{ id: ProjectFilter; label: string; count: number }> = [
    { id: 'ALL', label: '전체', count: stats.total },
    { id: 'RUNNING', label: '실행 가능', count: stats.ready },
    { id: 'TESTING', label: '테스트 중', count: stats.testing },
    { id: 'ERROR', label: '오류 · 실패', count: stats.failed },
    { id: 'EPHEMERAL', label: '일회용', count: stats.ephemeral },
  ];

  const emptyReason = projects.length === 0
    ? { title: '등록된 프로젝트가 없습니다', desc: '테스트할 사이트 주소만 있으면 바로 시작할 수 있습니다.' }
    : { title: '조건에 맞는 프로젝트가 없습니다', desc: '검색어나 필터를 바꿔보세요.' };

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-[24px] font-bold leading-tight text-foreground">프로젝트</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">
            테스트할 사이트마다 프로젝트를 하나씩 둡니다. 카드를 열면 작업 화면으로 들어갑니다.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => loadProjects()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            새로고침
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            프로젝트 등록
          </Button>
        </div>
      </div>

      {/* 검색 + 필터 — 개수는 필터 칩에만 두어 같은 숫자를 두 번 보여주지 않는다 */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="프로젝트명, 주소, 담당자 검색"
            className="h-10 pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1 rounded-sm border border-border bg-muted p-1">
          {filterButtons.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={cn(
                'h-8 rounded-sm px-3 text-[13px] font-bold transition-colors',
                filter === item.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-card hover:text-foreground'
              )}
            >
              {item.label} {item.count}
            </button>
          ))}
        </div>
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
            {projects.length === 0 && (
              <Button className="mt-4" onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4" />
                프로젝트 등록
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.projectId}
              project={project}
              running={testLoadingId === project.projectId}
              justCreated={project.projectId === justCreatedId}
              onOpen={() => navigate(projectTabPath(project.projectId, 'dashboard'))}
              onRun={() => handleRunProject(project)}
              onEnv={() => setEnvProject(project)}
              onEdit={() => setEditProject(project)}
              onDelete={() => handleDelete(project.projectId)}
              onGo={(tab) => navigate(projectTabPath(project.projectId, tab))}
            />
          ))}
        </div>
      )}

      <ProjectFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleCreate}
        title="프로젝트 등록"
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

      {editProject && (
        <ProjectFormDialog
          open={!!editProject}
          onOpenChange={(open) => !open && setEditProject(null)}
          onSubmit={handleUpdate}
          title="프로젝트 수정"
          initial={editProject}
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
