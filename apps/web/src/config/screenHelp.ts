import type { ProjectTabId } from '@/config/projectWorkspace';

/**
 * ? 버튼이 보여주는 "지금 이 화면" 설명.
 * AI에게 묻지 않고도 항상 같은 안내가 나오도록 화면마다 문구를 고정해 둔다.
 */
export type ScreenHelp = {
  title: string;
  body: string;
};

const PROJECT_TAB_HELP: Record<ProjectTabId, ScreenHelp> = {
  input: {
    title: '입력',
    body: '사이트 주소나 저장소를 연결하고, 어떤 화면이 있는지 찾는 첫 단계예요. 찾은 화면은 계획 › 화면 지도에서 볼 수 있어요.',
  },
  plan: {
    title: '계획',
    body: '테스트 하나하나를 계획 항목으로 보고 담당자·마감일·우선순위를 정하는 표예요. 체크한 항목만 실행돼요.',
  },
  dashboard: {
    title: '대시보드',
    body: '이 프로젝트의 최근 실행 결과와 성공률 추이를 한눈에 보는 곳이에요. 숫자가 이상하면 실행 탭에서 해당 실행의 로그를 열어보세요.',
  },
  'ai-generate': {
    title: 'AI로 만들기',
    body: '테스트하고 싶은 내용을 문장으로 적으면 AI가 테스트 코드를 생성합니다. 만들어진 코드는 AI 검토 탭에서 승인해야 실제 파일에 반영돼요.',
  },
  'ai-analysis': {
    title: 'AI 분석',
    body: 'AI 탭에서 실행 결과를 수준별로 풀어서 설명해 줍니다. AI를 켜면 오른쪽 아래 AI 채팅으로도 짧게 질문할 수 있어요.',
  },
  'ai-review': {
    title: 'AI 검토',
    body: 'AI가 제안한 코드 수정을 사람이 승인하거나 거부하는 곳입니다. 승인 전에는 아무것도 실제 파일에 반영되지 않아요.',
  },
  source: {
    title: '코드 편집기',
    body: '설정 아래에서 테스트 코드를 직접 열고 고치는 편집기입니다. AI를 켜면 오른쪽 아래 AI 채팅으로 파일 이름과 함께 수정을 요청할 수 있어요.',
  },
  structure: {
    title: '화면 지도',
    body: '입력 단계에서 찾은 화면과, 테스트가 어떤 화면을 지나가는지 지도로 보는 곳이에요. 화면을 다시 찾으려면 입력 단계로 가세요.',
  },
  scenarios: {
    title: '시나리오',
    body: 'spec 파일을 분석해 테스트 케이스 목록을 보여주는 곳이에요. 케이스를 골라 바로 실행할 수 있습니다.',
  },
  recorder: {
    title: '클릭으로 만들기',
    body: '사이트를 화면에서 직접 클릭 · 입력하면 그 흐름이 Playwright 테스트 파일로 저장돼요. 확인할 곳을 눌러 "보이는지 · 글자" 확인도 넣을 수 있고, AI 없이 동작합니다. 비밀번호는 값을 저장하지 않고 환경변수로 넣어요.',
  },
  runs: {
    title: '실행 이력',
    body: '지금까지 돌린 테스트 목록입니다. 실행을 누르면 진행 로그가 실시간으로 흐르고, 끝난 실행은 결과 탭에서 리포트로 볼 수 있어요.',
  },
  defects: {
    title: '결함',
    body: '계획 항목 중 최근 실행이 실패한 케이스를 모아 보는 곳이에요. 골라서 다시 실행하고, 성공하면 해결로 바뀝니다. 케이스 이름을 누르면 실패한 실행 결과로 가요.',
  },
  results: {
    title: '결과',
    body: '끝난 실행의 리포트와 스크린샷 · 동영상 같은 아티팩트를 보는 곳입니다. AI를 켜면 오른쪽 아래 AI 채팅으로 실패 원인을 물어볼 수 있어요.',
  },
  schedules: {
    title: '예약 실행',
    body: '정해진 시간에 테스트가 자동으로 돌도록 예약합니다. 매일 아침 회귀 테스트 같은 용도예요.',
  },
  settings: {
    title: '프로젝트 설정',
    body: '대상 사이트 주소, 환경 변수, Docker 러너 설정을 관리합니다. 값이 바뀌면 다음 실행부터 적용돼요.',
  },
  members: {
    title: '팀원',
    body: '이 프로젝트의 PM과 팀원입니다. PM은 사용자를 찾아 팀원으로 넣거나 빼고, PM 지정은 관리자가 합니다.',
  },
  'code-auto-fix': {
    title: '코드 자동 수정',
    body: '팀원은 자동 수정 사용권을 PM에게 요청하고, PM · 관리자는 범위를 골라 부여 · 거절 · 회수합니다. 실행 · PR 연동은 아직 준비 전이라 지금은 사용권만 관리해요.',
  },
};

const ROUTE_HELP: { prefix: string; help: ScreenHelp }[] = [
  {
    prefix: '/projects',
    help: {
      title: '프로젝트 목록',
      body: '사이트를 프로젝트 단위로 등록해 두는 곳입니다. 프로젝트를 열면 위쪽 탭으로 작업 화면이 바뀝니다.',
    },
  },
  {
    prefix: '/runners',
    help: {
      title: 'Runner 컨테이너',
      body: '테스트를 실제로 돌리는 Docker 컨테이너 상태를 보고 정리하는 곳이에요. 실행이 멈춰 있으면 여기부터 확인하세요.',
    },
  },
  {
    prefix: '/templates',
    help: {
      title: 'Playwright 템플릿',
      body: '새 프로젝트를 만들 때 기본으로 깔리는 테스트 코드 묶음입니다.',
    },
  },
  {
    prefix: '/ai-settings',
    help: {
      title: 'AI 설정 · 사용량',
      body: '어떤 AI(Claude · GPT)를 쓸지 고르고, 토큰을 얼마나 썼는지 봅니다. 실제 청구액은 각 공급자 콘솔에서 확인하세요.',
    },
  },
  {
    prefix: '/users',
    help: {
      title: '사용자 관리',
      body: '계정과 권한을 관리합니다. 관리자만 들어올 수 있어요.',
    },
  },
];

const FALLBACK: ScreenHelp = {
  title: 'AI-TestOps',
  body: '왼쪽 줄은 전체 메뉴, 위쪽 탭은 지금 프로젝트의 작업 화면입니다. AI를 켜면 오른쪽 아래 AI 채팅으로 무엇을 해야 할지 물어볼 수 있어요.',
};

export function screenHelpFor(pathname: string, projectTab?: ProjectTabId): ScreenHelp {
  if (projectTab) return PROJECT_TAB_HELP[projectTab];
  return ROUTE_HELP.find((item) => pathname.startsWith(item.prefix))?.help ?? FALLBACK;
}

/** ? 메뉴에 나열하는 단축키. 실제로 Layout에서 처리하는 것만 적는다. */
export const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: 'Ctrl + /', description: 'AI 채팅 열기 · 닫기' },
  { keys: 'Ctrl + K', description: '프로젝트 전환' },
];
