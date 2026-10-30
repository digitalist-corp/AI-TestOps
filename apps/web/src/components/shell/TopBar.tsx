import { NavLink } from 'react-router-dom';
import { ChevronsUpDown, LogOut, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { HelpMenu } from '@/components/shell/HelpMenu';
import { NotificationBell } from '@/components/shell/NotificationBell';
import { LiveClock } from '@/components/console/ConsoleText';
import { THEME_LABEL, useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { Project } from '@/types';
import { projectTabPath, type ProjectTabId } from '@/config/projectWorkspace';
import { WORKSPACE_GROUPS, groupOfTab, railLabelOf, tabLabel } from '@/config/shellNav';

/**
 * 상단바: 프로젝트 전환 + 작업 탭 5개 + 계정.
 * 프로젝트 밖(목록 · Runner · 템플릿 등)에서는 탭 대신 화면 이름만 보여준다.
 */
export function TopBar({
  pathname,
  activeProjectId,
  activeProject,
  currentTab,
  auth,
  projectTab,
  onOpenProjectSwitcher,
  onLogout,
}: {
  pathname: string;
  activeProjectId?: string;
  activeProject: Project | null;
  currentTab: ProjectTabId;
  auth: { username: string; role: string } | null;
  /** 프로젝트 안에 있을 때만 — ? 메뉴가 탭별 안내를 고른다. */
  projectTab?: ProjectTabId;
  onOpenProjectSwitcher: () => void;
  onLogout: () => void;
}) {
  const { theme, toggleTheme } = useTheme();
  const inProject = Boolean(activeProjectId);
  const activeGroup = groupOfTab(currentTab);
  const projectLabel = activeProject?.projectName ?? activeProjectId;

  return (
    <header className="@container relative flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
      {/* 콘솔 테마: 상단바 아랫선을 따라 신호가 천천히 지나간다 */}
      <span aria-hidden="true" className="console-sweep pointer-events-none absolute inset-x-0 -bottom-px hidden h-px dark:block" />
      <button
        type="button"
        onClick={onOpenProjectSwitcher}
        className={cn(
          'flex h-9 min-w-0 max-w-[15rem] items-center gap-2 rounded-lg border px-2.5 text-sm transition-colors',
          inProject
            ? 'border-border bg-background hover:bg-accent'
            : 'border-dashed border-border text-muted-foreground hover:bg-accent hover:text-foreground'
        )}
        title="프로젝트 전환 (Ctrl+K)"
      >
        <span className="min-w-0 truncate font-semibold">{projectLabel ?? '프로젝트 선택'}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      <span className="h-6 w-px shrink-0 bg-border" />

      {inProject && activeProjectId ? (
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {WORKSPACE_GROUPS.map(({ id, label, icon: Icon, tabs }) => {
            const active = activeGroup.id === id;
            return (
              <NavLink
                key={id}
                to={projectTabPath(activeProjectId, tabs[0])}
                aria-label={label}
                title={label}
                className={cn(
                  'flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary/10 text-primary ring-1 ring-primary/25 dark:shadow-[inset_0_-2px_0_var(--color-primary)] dark:ring-primary/30'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {/* 상단 바가 좁으면 탭 이름이 잘려 보이므로, 지금 탭만 이름을 남기고 나머지는 아이콘만 둔다 */}
                <span className={active ? undefined : 'hidden @min-[56rem]:inline'}>{label}</span>
              </NavLink>
            );
          })}
        </nav>
      ) : (
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {railLabelOf(pathname) ?? 'AI-TestOps'}
        </p>
      )}

      <div className="console-label hidden shrink-0 items-center gap-2 border-r border-border pr-3 @min-[64rem]:dark:flex" aria-hidden="true">
        <span className="console-live h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_8px_var(--color-success)]" />
        <span className="text-success">LIVE</span>
        <span className="text-muted-foreground">
          <LiveClock />
        </span>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground"
        onClick={toggleTheme}
        title={`${THEME_LABEL[theme === 'dark' ? 'light' : 'dark']} 테마로 전환`}
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>

      <HelpMenu pathname={pathname} projectTab={projectTab} />
      <NotificationBell />

      <div
        className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-border bg-background pl-2.5 pr-1"
        title={`${auth?.username ?? ''} (${auth?.role ?? ''})`}
      >
        <span className="max-w-[7rem] truncate text-xs font-medium text-foreground">{auth?.username}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          onClick={onLogout}
          title="로그아웃"
        >
          <LogOut className="h-3.5 w-3.5" />
        </Button>
      </div>
    </header>
  );
}

/**
 * 상단바 아래 보조 탭 줄.
 * 한 그룹에 탭이 둘 이상일 때만 나온다(실행 = 실행 이력 · 결과, 설정 = 설정 · 예약 실행).
 */
export function SubTabBar({
  projectId,
  currentTab,
}: {
  projectId: string;
  currentTab: ProjectTabId;
}) {
  const group = groupOfTab(currentTab);
  if (group.tabs.length < 2) return null;

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-card/60 px-3">
      {group.tabs.map((tab) => (
        <NavLink
          key={tab}
          to={projectTabPath(projectId, tab)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            currentTab === tab
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
          )}
        >
          {tabLabel(tab)}
        </NavLink>
      ))}
    </div>
  );
}
