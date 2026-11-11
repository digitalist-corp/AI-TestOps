import { describe, expect, it } from 'vitest';
import type { CoverageFlow, ExecutionSchedule, ScenarioSpecFile, SiteMapNode, TestRound, TestRoundCase, TestRoundDetail } from '@/types';
import { casesByScreen, mappingStats, nextScheduledRun, roundOptionLabel, roundSentence } from './rounds';

const round = (over: Partial<TestRound> = {}): TestRound => ({
  round: 3,
  executionId: 30,
  status: 'FAILED',
  title: '전체 실행',
  source: 'MANUAL',
  startedAt: '2026-11-10T05:20:00Z',
  finishedAt: '2026-11-10T05:22:00Z',
  durationMs: 120000,
  total: 5,
  passed: 3,
  failed: 2,
  skipped: 0,
  ...over,
});

const kase = (status: TestRoundCase['status'], change: TestRoundCase['change']): TestRoundCase => ({
  specPath: 'a.spec.ts',
  caseTitle: 'a.spec.ts > x',
  status,
  errorMessage: null,
  change,
  previousRound: null,
});

const detail = (cases: TestRoundCase[], over: Partial<TestRound> = {}, previousRound: number | null = 2): TestRoundDetail => ({
  round: round(over),
  previousRound,
  changes: cases.reduce(
    (acc, c) => ({ ...acc, [c.change]: acc[c.change] + 1 }),
    { NEW_FAIL: 0, STILL_FAIL: 0, FIXED: 0, STILL_PASS: 0, FIRST_RUN: 0, SKIPPED: 0 }
  ),
  cases,
});

describe('roundSentence', () => {
  it('통과 수와 지난번 대비 변화를 한 문장으로 말한다', () => {
    const d = detail([
      kase('PASSED', 'STILL_PASS'),
      kase('PASSED', 'FIXED'),
      kase('FAILED', 'NEW_FAIL'),
      kase('FAILED', 'STILL_FAIL'),
      kase('SKIPPED', 'SKIPPED'),
    ]);
    expect(roundSentence(d)).toBe(
      '3차 테스트에서 5개 중 2개가 통과했어요. 지난번보다 1개가 새로 실패했고, 1개가 고쳐졌어요. 계속 실패하는 케이스가 1개 있어요.'
    );
  });

  it('모두 통과하고 달라진 것이 없으면 그렇게 말한다', () => {
    expect(roundSentence(detail([kase('PASSED', 'STILL_PASS')]))).toBe(
      '3차 테스트에서 1개 중 1개가 통과했어요. 지난번과 달라진 케이스는 없어요.'
    );
  });

  it('지난번과 비교한 케이스 옆에 처음 돌린 케이스가 있으면 함께 말한다', () => {
    expect(roundSentence(detail([kase('PASSED', 'STILL_PASS'), kase('PASSED', 'FIRST_RUN')]))).toBe(
      '3차 테스트에서 2개 중 2개가 통과했어요. 지난번과 달라진 케이스는 없어요. 이번에 처음 돌린 케이스도 1개 있어요.'
    );
  });

  it('첫 차수와 돌고 있는 차수, 결과가 없는 차수', () => {
    expect(roundSentence(detail([kase('PASSED', 'FIRST_RUN')], { round: 1 }, null))).toBe(
      '1차 테스트에서 1개 중 1개가 통과했어요.'
    );
    expect(roundSentence(detail([kase('FAILED', 'FIRST_RUN'), kase('PASSED', 'FIRST_RUN')], { round: 1 }, null))).toBe(
      '1차 테스트에서 2개 중 1개가 통과했어요. 실패한 케이스가 1개 있어요.'
    );
    expect(roundSentence(detail([kase('PASSED', 'STILL_PASS'), kase('FAILED', 'FIRST_RUN')]))).toBe(
      '3차 테스트에서 2개 중 1개가 통과했어요. 지난번과 달라진 케이스는 없어요. 이번에 처음 돌린 케이스도 1개 있어요. 그중 1개가 실패했어요.'
    );
    expect(roundSentence(detail([], { status: 'RUNNING' }))).toBe('3차 테스트가 아직 돌고 있어요.');
    expect(roundSentence(detail([], { status: 'ERROR' }))).toBe(
      '3차 테스트는 케이스를 하나도 끝내지 못했어요. 실행 결과 화면에서 로그를 확인해 주세요.'
    );
  });
});

describe('roundOptionLabel', () => {
  it('차수 · 날짜 · 실패 수', () => {
    expect(roundOptionLabel(round())).toMatch(/^3차 테스트 · 11\. 10\. .+ · 실패 2$/);
    expect(roundOptionLabel(round({ failed: 0, status: 'PASSED' }))).toMatch(/· 모두 통과$/);
    expect(roundOptionLabel(round({ status: 'RUNNING' }))).toMatch(/· 실행 중$/);
  });
});

describe('nextScheduledRun', () => {
  const schedule = (over: Partial<ExecutionSchedule>): ExecutionSchedule => ({
    id: 1,
    projectId: 'p1',
    hour: 9,
    minute: 0,
    daysOfWeek: '*',
    enabled: true,
    createdAt: '',
    updatedAt: '',
    ...over,
  });
  // 2026-11-11 수요일 10:00 (로컬)
  const now = new Date(2026, 10, 11, 10, 0);

  it('켜진 예약 중 가장 가까운 다음 실행 시각', () => {
    const next = nextScheduledRun(
      [
        schedule({ id: 1, hour: 9, daysOfWeek: '*' }), // 내일 09:00
        schedule({ id: 2, hour: 18, daysOfWeek: 'WED' }), // 오늘 18:00
        schedule({ id: 3, hour: 11, enabled: false }),
      ],
      now
    );
    expect(next?.schedule.id).toBe(2);
    expect(next?.at).toEqual(new Date(2026, 10, 11, 18, 0));
  });

  it('요일이 지났으면 다음 주로 넘어가고, 켜진 예약이 없으면 null', () => {
    expect(nextScheduledRun([schedule({ hour: 9, daysOfWeek: 'WED' })], now)?.at).toEqual(new Date(2026, 10, 18, 9, 0));
    expect(nextScheduledRun([schedule({ enabled: false })], now)).toBeNull();
  });
});

describe('casesByScreen', () => {
  const node = (routeKey: string, title: string): SiteMapNode =>
    ({ routeKey, title, sourceFile: null, origin: 'CODE', stale: false, excluded: false }) as SiteMapNode;
  const flow = (specPath: string, routes: string[]): CoverageFlow => ({
    specPath,
    title: specPath,
    source: 'RECORDED',
    lastStatus: 'PASSED',
    lastRunAt: null,
    executionId: null,
    steps: routes.map((routeKey) => ({ routeKey, state: 'PASSED' })),
  });
  const spec = (path: string, titles: string[]): ScenarioSpecFile => ({
    path,
    caseCount: titles.length,
    enabled: true,
    cases: [
      {
        type: 'DESCRIBE',
        title: '묶음',
        line: 1,
        grep: '묶음',
        enabled: true,
        children: titles.map((title, i) => ({ type: 'TEST', title, line: i + 2, grep: title, enabled: true, children: [] })),
      },
    ],
  });

  it('화면마다 그 화면을 지나는 테스트의 케이스를 이번 차수 결과와 함께 모은다', () => {
    const groups = casesByScreen({
      nodes: [node('/login', '로그인'), node('/cart', '장바구니'), node('/admin', '관리자')],
      flows: [flow('tests/login.spec.ts', ['/login']), flow('tests/order.spec.ts', ['/login', '/cart'])],
      specs: [
        spec('tests/login.spec.ts', ['로그인된다']),
        spec('tests/order.spec.ts', ['주문된다', '취소된다']),
        spec('tests/misc.spec.ts', ['기타']),
      ],
      results: [
        { ...kase('PASSED', 'STILL_PASS'), specPath: 'login.spec.ts', caseTitle: 'login.spec.ts > 묶음 > 로그인된다' },
        { ...kase('FAILED', 'NEW_FAIL'), specPath: 'order.spec.ts', caseTitle: 'order.spec.ts > 묶음 > 주문된다' },
      ],
    });

    expect(groups.map((g) => [g.name, g.cases.map((c) => `${c.title}:${c.state}`)])).toEqual([
      ['로그인', ['로그인된다:PASSED', '주문된다:FAILED', '취소된다:NOT_RUN']],
      ['장바구니', ['주문된다:FAILED', '취소된다:NOT_RUN']],
      ['관리자', []],
      ['화면을 모르는 테스트', ['기타:NOT_RUN']],
    ]);
    expect(groups[1].counts).toEqual({ passed: 0, failed: 1, skipped: 0, notRun: 1 });
    expect(groups[0].cases[1].change).toBe('NEW_FAIL');
    expect(mappingStats(groups)).toEqual({ screens: 3, mapped: 2 });
  });
});
