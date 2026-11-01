import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ResourceStatusBar } from '@/components/ResourceStatusBar';
import { AppRail } from '@/components/shell/AppRail';
import { AiPanel } from '@/components/shell/AiPanel';
import { ProjectSwitcherDialog } from '@/components/shell/ProjectSwitcherDialog';
import { SubTabBar, TopBar } from '@/components/shell/TopBar';
import { api, clearStoredAuth, getStoredAuth } from '@/api/client';
import { railLabelOf, tabLabel } from '@/config/shellNav';
import type { Project } from '@/types';
import {
  DEFAULT_PROJECT_TAB,
  PROJECT_WORKSPACE_TABS,
  projectTabPath,
  type ProjectTabId,
} from '@/config/projectWorkspace';

const RECENT_PROJECT_KEY = 'playops.recentProjectId';
function activeWorkspaceTab(pathname: string): ProjectTabId {
  const tab = pathname.match(/^\/projects\/[^/]+\/([^/]+)/)?.[1];
  return PROJECT_WORKSPACE_TABS.some((item) => item.id === tab) ? (tab as ProjectTabId) : DEFAULT_PROJECT_TAB;
}

/**
 * 앱 셸.
 *
 *   [레일] [ 상단바 + 보조 탭 + 본문 ]
 *
 * - 레일: 프로젝트와 무관한 전역 메뉴
 * - 상단바: 프로젝트 전환 + 작업 탭, 오른쪽에 도움말 · 알림
 * - 오른쪽 아래 AI 버튼: AI 키가 등록돼 있을 때만 보이고, 누르면 채팅 창이 뜬다 (Ctrl+/)
 */
export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId } = useParams<{ projectId: string }>();
  const auth = getStoredAuth();
  const admin = auth?.role === 'ADMIN';

  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [activeProject, setActiveProject] = useState<Project | null>(null);

  const projectWorkspaceMatch = location.pathname.match(/^\/projects\/([^/]+)/);
  const activeProjectId = projectId ?? projectWorkspaceMatch?.[1];
  const inProjectWorkspace = Boolean(activeProjectId);
  const currentTab = activeWorkspaceTab(location.pathname);

  // 최근 프로젝트는 기억해 두고, 상단바 칩에 쓸 프로젝트 이름을 받아온다.
  useEffect(() => {
    if (!activeProjectId) {
      setActiveProject(null);
      return;
    }
    localStorage.setItem(RECENT_PROJECT_KEY, activeProjectId);

    let ignore = false;
    api.getProject(activeProjectId)
      .then((project) => {
        if (!ignore) setActiveProject(project);
      })
      .catch(() => {
        if (!ignore) setActiveProject(null);
      });

    return () => {
      ignore = true;
    };
  }, [activeProjectId]);

  // 관리자가 AI 설정에서 키를 넣거나 빼면 화면을 옮길 때 반영된다.
  useEffect(() => {
    let ignore = false;
    api.getAiAvailability()
      .then((availability) => {
        if (!ignore) setAiAvailable(availability.anyConfigured);
      })
      .catch(() => {
        if (!ignore) setAiAvailable(false);
      });
    return () => {
      ignore = true;
    };
  }, [location.pathname]);

  // Ctrl+/ : AI 채팅, Ctrl+K : 프로젝트 전환, Esc : AI 채팅 닫기 (? 메뉴의 단축키 목록과 같아야 한다)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAiOpen(false);
        return;
      }
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key === '/') {
        event.preventDefault();
        if (aiAvailable) setAiOpen((prev) => !prev);
      } else if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setProjectSwitcherOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [aiAvailable]);

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      clearStoredAuth();
      navigate('/login');
    }
  };

  const handleSelectProject = (nextProjectId: string) => {
    setProjectSwitcherOpen(false);
    navigate(projectTabPath(nextProjectId, inProjectWorkspace ? currentTab : DEFAULT_PROJECT_TAB));
  };

  const contextLabel = inProjectWorkspace
    ? `${activeProject?.projectName ?? activeProjectId} · ${tabLabel(currentTab)}`
    : `전체 · ${railLabelOf(location.pathname) ?? 'AI-TestOps'}`;

  return (
    <div
      className="relative flex h-screen overflow-hidden"
    >
      <AppRail admin={admin} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          pathname={location.pathname}
          activeProjectId={activeProjectId}
          activeProject={activeProject}
          currentTab={currentTab}
          auth={auth}
          projectTab={inProjectWorkspace ? currentTab : undefined}
          onOpenProjectSwitcher={() => setProjectSwitcherOpen(true)}
          onLogout={handleLogout}
        />
        {inProjectWorkspace && activeProjectId && (
          <SubTabBar projectId={activeProjectId} currentTab={currentTab} />
        )}
        {/* 리소스 바를 본문 아래에 붙여 둔다. AI 버튼 · 채팅 창도 본문 안에 띄워 바를 가리지 않는다 */}
        <div className="relative min-h-0 flex-1">
          {/* @container — 아래 화면들은 창 폭이 아니라 이 캔버스 폭을 기준으로 배치된다 */}
          <main className="@container h-full overflow-auto pb-16">
            <Outlet />
          </main>
          {aiAvailable && (aiOpen ? (
            <AiPanel onClose={() => setAiOpen(false)} contextLabel={contextLabel} projectId={activeProjectId} />
          ) : (
            <button
              type="button"
              onClick={() => setAiOpen(true)}
              className="absolute bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-ai-accent text-ai-accent-foreground shadow-2xl transition-transform hover:scale-105"
              title="AI에게 묻기 (Ctrl+/)"
              aria-label="AI 채팅 열기"
            >
              <Sparkles className="h-5 w-5" />
            </button>
          ))}
        </div>
        <ResourceStatusBar />
      </div>
      <ProjectSwitcherDialog
        open={projectSwitcherOpen}
        onOpenChange={setProjectSwitcherOpen}
        activeProjectId={activeProjectId}
        currentTab={currentTab}
        onSelect={handleSelectProject}
      />
    </div>
  );
}
