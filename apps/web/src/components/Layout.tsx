import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowUpRight,
  ChevronsUpDown,
  Container,
  FileCode,
  FolderKanban,
  LogOut,
  MessageSquareText,
  Moon,
  Rows3,
  Search,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { ResourceStatusBar } from '@/components/ResourceStatusBar';
import { GlobalAiChatWidget } from '@/components/GlobalAiChatWidget';
import { BrandLogo } from '@/components/BrandLogo';
import { api, clearStoredAuth, getStoredAuth } from '@/api/client';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme';
import type { Project } from '@/types';
import { DEFAULT_PROJECT_TAB, PROJECT_WORKSPACE_TABS, projectTabPath, type ProjectTabId } from '@/config/projectWorkspace';

const webNavItems = [
  { to: '/projects', label: '프로젝트 목록', icon: Rows3, hint: '목록 · 등록' },
  { to: '/runners', label: 'Runner 컨테이너', icon: Container, hint: 'Docker 상태 · 정리' },
  { to: '/board', label: '공지 / 게시판', icon: MessageSquareText, hint: '공지 노출 · 문의' },
  { to: '/templates', label: 'Playwright 템플릿', icon: FileCode, hint: '기본 소스 템플릿' },
  { to: '/ai-jobs', label: 'AI 검토', icon: Sparkles, hint: 'CODE_FIX 검토 (ADMIN)', adminOnly: true },
  { to: '/users', label: '사용자 관리', icon: Users, hint: '계정 (ADMIN)', adminOnly: true },
];

const serverTypeLabel: Record<Project['serverType'], string> = {
  DEV: '개발',
  TEST: '테스트',
  PROD: '운영',
};

const RECENT_PROJECT_KEY = 'playops.recentProjectId';

function matchesProject(project: Project, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    project.projectId,
    project.projectName,
    project.managerName ?? '',
    project.baseUrl ?? '',
  ].some((value) => value.toLowerCase().includes(q));
}

function activeWorkspaceTab(pathname: string): ProjectTabId {
  const tab = pathname.match(/^\/projects\/[^/]+\/([^/]+)/)?.[1];
  return PROJECT_WORKSPACE_TABS.some((item) => item.id === tab) ? tab as ProjectTabId : DEFAULT_PROJECT_TAB;
}

function ProjectSelectDialog({
  open,
  onOpenChange,
  activeProjectId,
  currentTab,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProjectId?: string;
  currentTab: ProjectTabId;
  onSelect: (projectId: string) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.getProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, [open]);

  const filteredProjects = useMemo(
    () => projects.filter((project) => matchesProject(project, query)),
    [projects, query]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0">
        <DialogHeader className="border-b border-border px-5 py-4 mb-0">
          <DialogTitle>프로젝트 선택</DialogTitle>
          <DialogDescription>선택한 프로젝트의 작업 화면으로 이동합니다.</DialogDescription>
        </DialogHeader>
        <div className="p-5">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="프로젝트명, ID, 관리자, URL 검색"
              autoFocus
            />
          </div>
          <div className="max-h-[420px] overflow-y-auto rounded-lg border border-border">
            {loading ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">프로젝트를 불러오는 중...</p>
            ) : filteredProjects.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">선택할 프로젝트가 없습니다.</p>
            ) : (
              <ul className="divide-y divide-border">
                {filteredProjects.map((project) => {
                  const active = project.projectId === activeProjectId;
                  return (
                    <li key={project.projectId}>
                      <button
                        type="button"
                        className={cn(
                          'flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent',
                          active && 'bg-accent'
                        )}
                        onClick={() => onSelect(project.projectId)}
                      >
                        <FolderKanban className="h-4 w-4 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-foreground">
                            {project.projectName}
                          </span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {project.projectId}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {serverTypeLabel[project.serverType]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            이동 탭: {PROJECT_WORKSPACE_TABS.find((item) => item.id === currentTab)?.label ?? '대시보드'}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId } = useParams<{ projectId: string }>();
  const auth = getStoredAuth();
  const admin = auth?.role === 'ADMIN';
  const [projectSelectOpen, setProjectSelectOpen] = useState(false);

  const projectWorkspaceMatch = location.pathname.match(/^\/projects\/([^/]+)/);
  const activeProjectId = projectId ?? projectWorkspaceMatch?.[1];
  const inProjectWorkspace = Boolean(activeProjectId);
  const currentWorkspaceTab = activeWorkspaceTab(location.pathname);
  const [recentProjectId, setRecentProjectId] = useState<string | undefined>(() =>
    activeProjectId ?? localStorage.getItem(RECENT_PROJECT_KEY) ?? undefined
  );
  const [recentProject, setRecentProject] = useState<Project | null>(null);

  useEffect(() => {
    if (!activeProjectId) return;
    localStorage.setItem(RECENT_PROJECT_KEY, activeProjectId);
    setRecentProjectId(activeProjectId);
    setRecentProject(null);
  }, [activeProjectId]);

  useEffect(() => {
    if (inProjectWorkspace || !recentProjectId) return;
    let ignore = false;

    api.getProject(recentProjectId)
      .then((project) => {
        if (!ignore) setRecentProject(project);
      })
      .catch(() => {
        if (ignore) return;
        localStorage.removeItem(RECENT_PROJECT_KEY);
        setRecentProjectId(undefined);
        setRecentProject(null);
      });

    return () => {
      ignore = true;
    };
  }, [inProjectWorkspace, recentProjectId]);

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      clearStoredAuth();
      navigate('/login');
    }
  };

  const handleSelectProject = (nextProjectId: string) => {
    setProjectSelectOpen(false);
    navigate(projectTabPath(nextProjectId, inProjectWorkspace ? currentWorkspaceTab : DEFAULT_PROJECT_TAB));
  };

  const { theme, toggleTheme } = useTheme();

  return (
    <div className="flex min-h-screen">
      <aside className="w-72 bg-sidebar text-sidebar-foreground flex flex-col shrink-0">
        <div className="flex items-start justify-between gap-3 border-b border-sidebar-active px-5 py-5">
          <NavLink
            to="/projects"
            className="min-w-0 hover:opacity-90 transition-opacity"
          >
            <BrandLogo size={32} showText tone="light" subtitle="테스트 관리 플랫폼" />
          </NavLink>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-sidebar-foreground/70 hover:text-white hover:bg-sidebar-active"
              onClick={toggleTheme}
              title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
            >
              {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </Button>
            <div
              className="flex min-w-0 max-w-[7.25rem] items-center justify-between gap-1 rounded-md border border-sidebar-active bg-white/5 px-1.5 py-1.5"
              title={`${auth?.username ?? ''} (${auth?.role ?? ''})`}
            >
              <span className="min-w-0 truncate text-[11px] font-medium text-sidebar-foreground">
                {auth?.username}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 shrink-0 p-0 text-sidebar-foreground/70 hover:text-white hover:bg-sidebar-active"
                onClick={handleLogout}
                title="로그아웃"
              >
                <LogOut className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {!inProjectWorkspace && (
            <div className="mb-4 rounded-lg border border-success/25 bg-success/10 px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-success">
                    Recent Workspace
                  </p>
                  {recentProjectId ? (
                    <>
                      <p
                        className="mt-1 truncate text-sm font-semibold text-white"
                        title={recentProject?.projectName ?? recentProjectId}
                      >
                        {recentProject?.projectName ?? recentProjectId}
                      </p>
                      {recentProject && (
                        <p className="mt-0.5 truncate font-mono text-[11px] text-sidebar-foreground/60" title={recentProject.projectId}>
                          {recentProject.projectId}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-1 text-sm font-semibold text-white">최근 프로젝트 없음</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={() => recentProjectId && navigate(projectTabPath(recentProjectId, DEFAULT_PROJECT_TAB))}
                    disabled={!recentProjectId}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-success/25 bg-sidebar/30 text-success hover:border-success/60 hover:bg-success/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    title="프로젝트로 이동"
                  >
                    <ArrowUpRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled
                    className="inline-flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-md border border-success/20 bg-success/10 text-success opacity-40"
                    title="프로젝트 선택"
                  >
                    <ChevronsUpDown className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="mt-1 text-[11px] text-sidebar-foreground/60">
                {recentProjectId ? '최근 작업한 프로젝트로 바로 이어갈 수 있습니다.' : '프로젝트를 선택하면 작업 영역이 유지됩니다.'}
              </p>
            </div>
          )}

          {!inProjectWorkspace && (
            <>
              <p className="px-3 pt-1 pb-2 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                Web
              </p>
              {webNavItems.map(({ to, label, icon: Icon, hint, adminOnly }) => {
                const disabled = Boolean(adminOnly && !admin);
                if (disabled) {
                  return (
                    <div
                      key={to}
                      className="flex flex-col gap-0.5 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/50 opacity-60"
                      title="관리자만 사용할 수 있습니다"
                    >
                      <span className="flex items-center gap-3 font-medium">
                        <Icon className="h-4 w-4 shrink-0" />
                        {label}
                      </span>
                      <span className="pl-7 text-[10px] text-sidebar-foreground/50">{hint}</span>
                    </div>
                  );
                }

                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/projects'}
                    className={({ isActive }) =>
                      cn(
                        'flex flex-col gap-0.5 px-3 py-2.5 rounded-lg text-sm transition-colors',
                        isActive
                          ? 'bg-primary/20 text-primary-foreground ring-1 ring-primary/30'
                          : 'text-sidebar-foreground/70 hover:bg-sidebar-active/60 hover:text-sidebar-foreground'
                      )
                    }
                  >
                    <span className="flex items-center gap-3 font-medium">
                      <Icon className="h-4 w-4 shrink-0" />
                      {label}
                    </span>
                    <span className="pl-7 text-[10px] text-sidebar-foreground/50">{hint}</span>
                  </NavLink>
                );
              })}
            </>
          )}

          {inProjectWorkspace && activeProjectId && (
            <>
              <div className="mb-4 rounded-lg border border-primary/20 bg-primary/10 px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                      Project Workspace
                    </p>
                    <p className="mt-1 truncate font-mono text-sm font-semibold text-white" title={activeProjectId}>
                      {activeProjectId}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <button
                      type="button"
                      onClick={() => navigate('/projects')}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-primary/20 bg-sidebar/30 text-primary hover:border-primary/50 hover:bg-primary/20 hover:text-white"
                      title="프로젝트 목록"
                    >
                      <FolderKanban className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setProjectSelectOpen(true)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-primary/30 bg-primary/15 text-primary hover:border-primary/60 hover:bg-primary/25 hover:text-white"
                      title="프로젝트 선택"
                    >
                      <ChevronsUpDown className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-sidebar-foreground/60">선택한 프로젝트 작업에 집중합니다.</p>
              </div>

              {PROJECT_WORKSPACE_TABS.map(({ id, label, description, icon: Icon }) => (
                <NavLink
                  key={id}
                  to={projectTabPath(activeProjectId, id)}
                  className={({ isActive }) =>
                    cn(
                      'flex flex-col gap-0.5 px-3 py-2.5 rounded-lg text-sm transition-colors mb-0.5',
                      isActive
                        ? 'bg-primary/20 text-primary-foreground ring-1 ring-primary/40'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-active/60 hover:text-sidebar-foreground'
                    )
                  }
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                  </span>
                  <span className="pl-6 text-[10px] text-sidebar-foreground/50">{description}</span>
                </NavLink>
              ))}
            </>
          )}
        </nav>

      </aside>

      <main className="flex-1 overflow-auto pb-24">
        <Outlet />
      </main>
      <ResourceStatusBar />
      <GlobalAiChatWidget />
      <ProjectSelectDialog
        open={projectSelectOpen}
        onOpenChange={setProjectSelectOpen}
        activeProjectId={activeProjectId}
        currentTab={currentWorkspaceTab}
        onSelect={handleSelectProject}
      />
    </div>
  );
}
