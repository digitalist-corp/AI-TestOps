import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  CalendarClock,
  Container,
  LayoutDashboard,
  Network,
  FolderTree,
  GitBranch,
  Play,
  Sparkles,
} from 'lucide-react';

export type ProjectTabId = 'dashboard' | 'source' | 'structure' | 'scenarios' | 'runs' | 'results' | 'ai-analysis' | 'schedules' | 'settings';

export const PROJECT_WORKSPACE_TABS: {
  id: ProjectTabId;
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    id: 'dashboard',
    label: '대시보드',
    description: '요약 · 추이 · 최근 실행',
    icon: LayoutDashboard,
  },
  {
    id: 'source',
    label: '코드',
    description: '직접 편집 · AI 수정 도움',
    icon: FolderTree,
  },
  {
    id: 'structure',
    label: '구조',
    description: '저장소 코드에서 찾은 화면',
    icon: Network,
  },
  {
    id: 'scenarios',
    label: '테스트',
    description: '케이스 선택 · 묶음 · AI 생성',
    icon: GitBranch,
  },
  {
    id: 'runs',
    label: '실행 이력',
    description: '실행 목록 · 로그 스트리밍',
    icon: Play,
  },
  {
    id: 'results',
    label: '결과',
    description: '리포트 · 아티팩트',
    icon: BarChart3,
  },
  {
    id: 'ai-analysis',
    label: 'AI 분석',
    description: '수준별 맞춤 AI 진단 · 해설',
    icon: Sparkles,
  },
  {
    id: 'schedules',
    label: '예약 실행',
    description: '반복 자동 실행 관리',
    icon: CalendarClock,
  },
  {
    id: 'settings',
    label: '설정',
    description: '환경 · Docker Runner',
    icon: Container,
  },
];

export const DEFAULT_PROJECT_TAB: ProjectTabId = 'dashboard';

export function isValidProjectTab(tab: string | undefined): tab is ProjectTabId {
  return PROJECT_WORKSPACE_TABS.some((t) => t.id === tab);
}

export function projectTabPath(projectId: string, tab: ProjectTabId = DEFAULT_PROJECT_TAB) {
  return `/projects/${projectId}/${tab}`;
}
