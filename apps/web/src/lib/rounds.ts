import type {
  CoverageFlow,
  ExecutionSchedule,
  RoundChange,
  ScenarioCaseNode,
  ScenarioSpecFile,
  SiteMapNode,
  TestRound,
  TestRoundCase,
  TestRoundDetail,
} from '@/types';
import { screenName } from '@/lib/coverage';

type Tone = 'success' | 'destructive' | 'warning' | 'primary' | 'muted';

/** 지난번 대비 변화. 비전공자가 읽는 말로 적는다. */
export const CHANGE_META: Record<RoundChange, { label: string; hint: string; tone: Tone }> = {
  NEW_FAIL: { label: '새로 실패', hint: '지난번엔 통과했는데 이번에 실패했어요', tone: 'destructive' },
  STILL_FAIL: { label: '계속 실패', hint: '지난번에도 이번에도 실패했어요', tone: 'warning' },
  FIXED: { label: '고쳐짐', hint: '지난번엔 실패했는데 이번에 통과했어요', tone: 'success' },
  STILL_PASS: { label: '계속 통과', hint: '지난번에도 이번에도 통과했어요', tone: 'muted' },
  FIRST_RUN: { label: '처음 실행', hint: '이번에 처음 돌린 케이스예요', tone: 'primary' },
  SKIPPED: { label: '건너뜀', hint: '이번 차수에서 돌리지 않고 넘어갔어요', tone: 'muted' },
};

export type CaseState = 'PASSED' | 'FAILED' | 'SKIPPED' | 'NOT_RUN';

export const CASE_STATE_META: Record<CaseState, { label: string; color: string; tone: Tone }> = {
  PASSED: { label: '통과', color: '#10b981', tone: 'success' },
  FAILED: { label: '실패', color: '#ef4444', tone: 'destructive' },
  SKIPPED: { label: '건너뜀', color: '#94a3b8', tone: 'muted' },
  NOT_RUN: { label: '이번에 안 돌림', color: '#cbd5e1', tone: 'muted' },
};

const RUNNING_STATUSES = ['PENDING', 'RUNNING', 'CANCEL_REQUESTED'];

export function isRoundRunning(round: Pick<TestRound, 'status'>) {
  return RUNNING_STATUSES.includes(round.status);
}

/** 콤보박스 항목: "3차 테스트 · 11. 10. 오후 02:20 · 실패 2" */
export function roundOptionLabel(round: TestRound): string {
  const when = new Date(round.startedAt ?? round.finishedAt ?? Date.now()).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const result = isRoundRunning(round)
    ? '실행 중'
    : round.status === 'CANCELLED'
      ? '중단됨'
      : round.failed > 0
        ? `실패 ${round.failed}`
        : round.status === 'PASSED'
          ? '모두 통과'
          : '결과 없음';
  return `${round.round}차 테스트 · ${when} · ${result}`;
}

/** 대시보드 맨 위에 놓는 한 문장 요약. */
export function roundSentence(detail: TestRoundDetail): string {
  const name = `${detail.round.round}차 테스트`;
  if (isRoundRunning(detail.round)) return `${name}가 아직 돌고 있어요.`;
  const total = detail.cases.length;
  if (total === 0) return `${name}는 케이스를 하나도 끝내지 못했어요. 실행 결과 화면에서 로그를 확인해 주세요.`;

  const passed = detail.cases.filter((c) => c.status === 'PASSED').length;
  const parts = [`${name}에서 ${total}개 중 ${passed}개가 통과했어요.`];
  const { NEW_FAIL: newFail, FIXED: fixed, STILL_FAIL: stillFail } = detail.changes;
  const compared = detail.cases.some((c) => c.change !== 'FIRST_RUN' && c.change !== 'SKIPPED');
  if (newFail || fixed) {
    const changes = [newFail ? `${newFail}개가 새로 실패했고` : '', fixed ? `${fixed}개가 고쳐졌어요` : '']
      .filter(Boolean)
      .join(', ');
    parts.push(`지난번보다 ${changes.endsWith('했고') ? changes.replace(/했고$/, '했어요') : changes}.`);
  } else if (compared && !stillFail) {
    parts.push('지난번과 달라진 케이스는 없어요.');
  }
  if (stillFail) parts.push(`계속 실패하는 케이스가 ${stillFail}개 있어요.`);
  // 처음 돌린 케이스는 비교할 지난번이 없으니 실패를 따로 말한다.
  const firstRun = detail.changes.FIRST_RUN;
  const firstRunFailed = detail.cases.filter((c) => c.change === 'FIRST_RUN' && c.status === 'FAILED').length;
  if (compared && firstRun) {
    parts.push(
      `이번에 처음 돌린 케이스도 ${firstRun}개 있어요${firstRunFailed ? `. 그중 ${firstRunFailed}개가 실패했어요.` : '.'}`
    );
  } else if (firstRunFailed) {
    parts.push(`실패한 케이스가 ${firstRunFailed}개 있어요.`);
  }
  return parts.join(' ');
}

const DAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** 켜진 예약 중 가장 가까운 다음 실행. 예약의 시각은 브라우저 로컬 시간으로 본다. */
export function nextScheduledRun(
  schedules: ExecutionSchedule[],
  now: Date = new Date()
): { at: Date; schedule: ExecutionSchedule } | null {
  let best: { at: Date; schedule: ExecutionSchedule } | null = null;
  for (const schedule of schedules) {
    if (!schedule.enabled) continue;
    const days = !schedule.daysOfWeek || schedule.daysOfWeek === '*' ? DAY_CODES : schedule.daysOfWeek.split(',');
    for (let offset = 0; offset <= 7; offset++) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, schedule.hour, schedule.minute);
      if (at <= now || !days.includes(DAY_CODES[at.getDay()])) continue;
      if (!best || at < best.at) best = { at, schedule };
      break;
    }
  }
  return best;
}

/** 결과의 spec 경로는 실행 폴더 기준이라 앞부분이 빠질 수 있다. 경로 끝이 '/' 경계에서 같으면 같은 파일로 본다. */
export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/** "spec > 묶음 > 케이스" 에서 케이스 이름만 */
export function caseLeaf(title: string | null | undefined): string {
  if (!title) return '';
  const parts = title.split(' > ');
  return parts[parts.length - 1].trim();
}

export interface ScreenCase {
  specPath: string;
  title: string;
  state: CaseState;
  change: RoundChange | null;
  errorMessage: string | null;
}

export interface ScreenCases {
  /** null 이면 지나는 화면을 모르는 테스트 묶음 */
  routeKey: string | null;
  name: string;
  cases: ScreenCase[];
  counts: { passed: number; failed: number; skipped: number; notRun: number };
}

function testsOf(nodes: ScenarioCaseNode[]): string[] {
  return nodes.flatMap((node) => (node.type === 'TEST' ? [node.title] : testsOf(node.children ?? [])));
}

function countsOf(cases: ScreenCase[]): ScreenCases['counts'] {
  return {
    passed: cases.filter((c) => c.state === 'PASSED').length,
    failed: cases.filter((c) => c.state === 'FAILED').length,
    skipped: cases.filter((c) => c.state === 'SKIPPED').length,
    notRun: cases.filter((c) => c.state === 'NOT_RUN').length,
  };
}

/**
 * 화면 기준 케이스 목록. 화면마다 그 화면을 지나는 테스트(구조 탭의 흐름)의 케이스를 모으고,
 * 고른 차수의 결과로 상태를 칠한다. 한 테스트가 여러 화면을 지나면 각 화면에 모두 나온다.
 * 지나는 화면을 모르는 테스트는 마지막 묶음으로 모은다.
 */
export function casesByScreen(input: {
  nodes: SiteMapNode[];
  flows: CoverageFlow[];
  specs: ScenarioSpecFile[];
  results: TestRoundCase[];
}): ScreenCases[] {
  const caseList = (spec: ScenarioSpecFile): ScreenCase[] =>
    testsOf(spec.cases).map((title) => {
      const result = input.results.find((r) => samePath(r.specPath, spec.path) && caseLeaf(r.caseTitle) === title);
      return {
        specPath: spec.path,
        title,
        state: (result?.status ?? 'NOT_RUN') as CaseState,
        change: result?.change ?? null,
        errorMessage: result?.errorMessage ?? null,
      };
    });
  const routesOf = (spec: ScenarioSpecFile) =>
    new Set(input.flows.filter((f) => samePath(f.specPath, spec.path)).flatMap((f) => f.steps.map((s) => s.routeKey)));

  const specRoutes = input.specs.map((spec) => ({ spec, routes: routesOf(spec), cases: caseList(spec) }));
  const groups: ScreenCases[] = input.nodes
    .filter((node) => !node.stale && !node.excluded)
    .map((node) => {
      const cases = specRoutes.filter((s) => s.routes.has(node.routeKey)).flatMap((s) => s.cases);
      return { routeKey: node.routeKey, name: screenName(node, node.routeKey), cases, counts: countsOf(cases) };
    });
  const known = new Set(groups.map((g) => g.routeKey));
  const unmapped = specRoutes.filter((s) => ![...s.routes].some((r) => known.has(r))).flatMap((s) => s.cases);
  if (unmapped.length) {
    groups.push({ routeKey: null, name: '화면을 모르는 테스트', cases: unmapped, counts: countsOf(unmapped) });
  }
  return groups;
}

/** 지도에 있는 화면 중 테스트가 하나라도 지나는 화면 수 */
export function mappingStats(groups: ScreenCases[]): { screens: number; mapped: number } {
  const screens = groups.filter((g) => g.routeKey !== null);
  return { screens: screens.length, mapped: screens.filter((g) => g.cases.length > 0).length };
}
