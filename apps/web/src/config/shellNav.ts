import type { LucideIcon } from 'lucide-react';
import {
  Container,
  FileCode,
  Gauge,
  GitBranch,
  LayoutDashboard,
  Network,
  Play,
  Rows3,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import { PROJECT_WORKSPACE_TABS, type ProjectTabId } from '@/config/projectWorkspace';

/**
 * 셸(껍데기) 네비게이션 정의.
 *
 * - 레일: 화면 맨 왼쪽 세로 아이콘 줄. 프로젝트를 가리지 않는 전역 메뉴.
 * - 상단 그룹: 프로젝트 안에서 쓰는 작업 탭.
 *   그룹 안에 탭이 둘 이상이면 상단바 아래 보조 탭 줄이 나온다.
 */

export type RailItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

export const RAIL_ITEMS: RailItem[] = [
  { to: '/projects', label: '프로젝트 목록', icon: Rows3 },
  { to: '/runners', label: 'Runner 컨테이너', icon: Container },
  { to: '/templates', label: 'Playwright 템플릿', icon: FileCode },
  { to: '/ai-settings', label: 'AI 설정 · 사용량', icon: Gauge },
  { to: '/users', label: '사용자 관리', icon: Users, adminOnly: true },
];

export type WorkspaceGroupId = 'dashboard' | 'structure' | 'scenarios' | 'runs' | 'settings' | 'ai';

export type WorkspaceGroup = {
  id: WorkspaceGroupId;
  label: string;
  icon: LucideIcon;
  /** 이 그룹에 속한 탭들. 첫 번째가 그룹을 눌렀을 때 가는 기본 탭. */
  tabs: ProjectTabId[];
  /** AI가 켜졌을 때만 보여줄 그룹인지 */
  aiOnly?: boolean;
};

export const WORKSPACE_GROUPS: WorkspaceGroup[] = [
  { id: 'dashboard', label: '대시보드', icon: LayoutDashboard, tabs: ['dashboard'] },
  { id: 'structure', label: '구조', icon: Network, tabs: ['structure'] },
  { id: 'scenarios', label: '테스트', icon: GitBranch, tabs: ['scenarios', 'recorder'] },
  { id: 'runs', label: '실행', icon: Play, tabs: ['runs', 'results'] },
  { id: 'settings', label: '설정', icon: Settings, tabs: ['settings', 'schedules', 'source'] },
  { id: 'ai', label: 'AI', icon: Sparkles, tabs: ['ai-generate', 'ai-analysis', 'ai-review'], aiOnly: true },
];

export function visibleWorkspaceGroups(aiActive: boolean): WorkspaceGroup[] {
  return aiActive ? WORKSPACE_GROUPS : WORKSPACE_GROUPS.filter((group) => !group.aiOnly);
}

export function groupOfTab(tab: ProjectTabId): WorkspaceGroup {
  return WORKSPACE_GROUPS.find((group) => group.tabs.includes(tab)) ?? WORKSPACE_GROUPS[0];
}

export function tabLabel(tab: ProjectTabId): string {
  return PROJECT_WORKSPACE_TABS.find((item) => item.id === tab)?.label ?? tab;
}

/** 프로젝트 밖 화면(레일 메뉴)의 제목. 상단바와 도움말에서 함께 쓴다. */
export function railLabelOf(pathname: string): string | undefined {
  return RAIL_ITEMS.find((item) =>
    item.to === '/projects' ? pathname === '/projects' : pathname.startsWith(item.to)
  )?.label;
}
