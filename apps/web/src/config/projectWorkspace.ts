import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  ClipboardList,
  Download,
  CalendarClock,
  Container,
  LayoutDashboard,
  Network,
  FolderTree,
  GitBranch,
  MousePointerClick,
  Play,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';

export type ProjectTabId =
  | 'input'
  | 'plan'
  | 'dashboard'
  | 'source'
  | 'structure'
  | 'scenarios'
  | 'recorder'
  | 'runs'
  | 'results'
  | 'ai-generate'
  | 'ai-analysis'
  | 'ai-review'
  | 'schedules'
  | 'settings'
  | 'members';

export const PROJECT_WORKSPACE_TABS: {
  id: ProjectTabId;
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    id: 'input',
    label: '입력',
    description: '저장소를 연결하고 코드·사이트에서 화면을 찾기',
    icon: Download,
  },
  {
    id: 'plan',
    label: '계획',
    description: '테스트 계획 표 — 담당자·마감일·우선순위·실행 대상',
    icon: ClipboardList,
  },
  {
    id: 'dashboard',
    label: '대시보드',
    description: '요약 · 추이 · 최근 실행',
    icon: LayoutDashboard,
  },
  {
    id: 'source',
    label: '코드 편집기',
    description: '직접 편집 · AI 수정 도움',
    icon: FolderTree,
  },
  {
    id: 'structure',
    label: '화면 지도',
    description: '찾은 화면과 테스트가 지나는 길',
    icon: Network,
  },
  {
    id: 'scenarios',
    label: '테스트',
    description: '케이스 선택 · 묶음 · 실행',
    icon: GitBranch,
  },
  {
    id: 'recorder',
    label: '클릭으로 만들기',
    description: '사이트를 직접 눌러 테스트 녹화',
    icon: MousePointerClick,
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
    id: 'ai-generate',
    label: 'AI로 만들기',
    description: '문장으로 테스트 생성',
    icon: Sparkles,
  },
  {
    id: 'ai-analysis',
    label: 'AI 분석',
    description: '수준별 맞춤 AI 진단 · 해설',
    icon: Sparkles,
  },
  {
    id: 'ai-review',
    label: 'AI 검토',
    description: 'AI가 만든 변경 승인 · 거부',
    icon: ShieldCheck,
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
  {
    id: 'members',
    label: '팀원',
    description: '프로젝트 멤버 · PM 지정',
    icon: Users,
  },
];

export const DEFAULT_PROJECT_TAB: ProjectTabId = 'dashboard';

export function isValidProjectTab(tab: string | undefined): tab is ProjectTabId {
  return PROJECT_WORKSPACE_TABS.some((t) => t.id === tab);
}

export function projectTabPath(projectId: string, tab: ProjectTabId = DEFAULT_PROJECT_TAB) {
  return `/projects/${projectId}/${tab}`;
}
