import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ResourceStatusBar } from '@/components/ResourceStatusBar';
import { AppRail } from '@/components/shell/AppRail';
import { AiPanel, AI_PANEL_DEFAULT_WIDTH, AI_PANEL_MAX_WIDTH, AI_PANEL_MIN_WIDTH } from '@/components/shell/AiPanel';
import { HelpMenu } from '@/components/shell/HelpMenu';
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
const AI_WIDTH_KEY = 'playops.aiPanel.width';
const AI_COLLAPSED_KEY = 'playops.aiPanel.collapsed';
const RAIL_WIDTH = 56;
/** 이 폭 아래에서는 AI 패널이 캔버스를 밀지 않고 겹쳐 뜬다. */
const OVERLAY_BREAKPOINT = 1024;
/** 캔버스가 이보다 좁아지지 않도록 패널 폭을 깎는다. */
const CANVAS_MIN_WIDTH = 460;

function activeWorkspaceTab(pathname: string): ProjectTabId {
  const tab = pathname.match(/^\/projects\/[^/]+\/([^/]+)/)?.[1];
  return PROJECT_WORKSPACE_TABS.some((item) => item.id === tab) ? (tab as ProjectTabId) : DEFAULT_PROJECT_TAB;
}

function readStoredWidth(): number {
  try {
    const raw = Number(window.localStorage.getItem(AI_WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= AI_PANEL_MIN_WIDTH && raw <= AI_PANEL_MAX_WIDTH) return raw;
  } catch {
    // localStorage 접근 불가 시 기본값 사용
  }
  return AI_PANEL_DEFAULT_WIDTH;
}

function readStoredCollapsed(): boolean {
  try {
    return window.localStorage.getItem(AI_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * 앱 셸.
 *
 *   [레일] [ AI 패널 ] [ 상단바 + 보조 탭 + 본문 ]
 *
 * - 레일: 프로젝트와 무관한 전역 메뉴
 * - AI 패널: 항상 열려 있고 폭 조절 · 접기 가능 (Ctrl+/)
 * - 상단바: 프로젝트 전환 + 작업 탭 5개
 * - 오른쪽 아래 ?: 화면별 사용 안내
 */
export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId } = useParams<{ projectId: string }>();
  const auth = getStoredAuth();
  const admin = auth?.role === 'ADMIN';

  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const [aiWidth, setAiWidth] = useState(readStoredWidth);
  const [aiCollapsed, setAiCollapsed] = useState(readStoredCollapsed);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [overlayOpen, setOverlayOpen] = useState(false);

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

  // 창 크기가 바뀌면 패널 · 캔버스 배분을 다시 계산한다.
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleWidthChange = useCallback((width: number) => {
    setAiWidth(width);
    try {
      window.localStorage.setItem(AI_WIDTH_KEY, String(width));
    } catch {
      // 저장 실패는 무시한다.
    }
  }, []);

  const toggleAiPanel = useCallback(() => {
    setAiCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(AI_COLLAPSED_KEY, String(next));
      } catch {
        // 저장 실패는 무시한다.
      }
      return next;
    });
  }, []);

  // Ctrl+/ : AI 패널, Ctrl+K : 프로젝트 전환 (? 메뉴의 단축키 목록과 같아야 한다)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key === '/') {
        event.preventDefault();
        if (window.innerWidth < OVERLAY_BREAKPOINT) {
          setOverlayOpen((prev) => !prev);
        } else {
          toggleAiPanel();
        }
      } else if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setProjectSwitcherOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleAiPanel]);

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

  // 좁은 화면에서는 패널이 캔버스를 밀지 않고 겹쳐 뜬다.
  const overlayMode = viewport < OVERLAY_BREAKPOINT;
  const panelOpen = overlayMode ? overlayOpen : !aiCollapsed;
  // 넓은 화면에서도 캔버스가 너무 좁아지면 패널 폭을 깎는다.
  const panelWidth = overlayMode
    ? Math.min(aiWidth, Math.max(AI_PANEL_MIN_WIDTH, viewport - RAIL_WIDTH - 24))
    : Math.min(aiWidth, Math.max(AI_PANEL_MIN_WIDTH, viewport - RAIL_WIDTH - CANVAS_MIN_WIDTH));
  const handleTogglePanel = overlayMode
    ? () => setOverlayOpen((prev) => !prev)
    : toggleAiPanel;

  // 하단 리소스 바가 캔버스 영역에만 걸리도록 왼쪽 여백을 셸이 알려준다.
  const shellLeft = RAIL_WIDTH + (overlayMode || aiCollapsed ? 0 : panelWidth);

  return (
    <div
      className="relative flex h-screen overflow-hidden"
      style={{ '--shell-left': `${shellLeft}px` } as React.CSSProperties}
    >
      <AppRail admin={admin} aiCollapsed={!panelOpen} onToggleAi={handleTogglePanel} />

      {overlayMode && panelOpen && (
        <button
          type="button"
          aria-label="AI 패널 닫기"
          className="absolute inset-0 z-30 bg-foreground/30"
          onClick={() => setOverlayOpen(false)}
        />
      )}

      {panelOpen && (
        <AiPanel
          width={panelWidth}
          onWidthChange={handleWidthChange}
          onCollapse={handleTogglePanel}
          contextLabel={contextLabel}
          projectId={activeProjectId}
          overlay={overlayMode}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          pathname={location.pathname}
          activeProjectId={activeProjectId}
          activeProject={activeProject}
          currentTab={currentTab}
          auth={auth}
          onOpenProjectSwitcher={() => setProjectSwitcherOpen(true)}
          onLogout={handleLogout}
        />
        {inProjectWorkspace && activeProjectId && (
          <SubTabBar projectId={activeProjectId} currentTab={currentTab} />
        )}
        {/* @container — 아래 화면들은 창 폭이 아니라 이 캔버스 폭을 기준으로 배치된다 */}
        <main className="@container flex-1 overflow-auto pb-16">
          <Outlet />
        </main>
      </div>

      <ResourceStatusBar />
      <HelpMenu pathname={location.pathname} projectTab={inProjectWorkspace ? currentTab : undefined} />
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
