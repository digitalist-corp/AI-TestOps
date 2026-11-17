import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@/types';
import type { ScreenCase, ScreenCases } from '@/lib/rounds';
import { failingScreens, inSuite, planAsResults, planCounts, screenNameByCase } from '@/lib/plan';

const counts = { passed: 0, failed: 0, skipped: 0, notRun: 0 };
const c = (specPath: string, title: string): ScreenCase => ({ specPath, title, state: 'NOT_RUN', change: null, errorMessage: null });
const item = (over: Partial<PlanItem>): PlanItem => ({
  specPath: 'a.spec.ts', grep: '가입', title: '가입', describePath: '', line: 1, enabled: true, parentEnabled: true, sortOrder: null,
  assignee: null, dueDate: null, priority: null, lastStatus: null, lastRunAt: null, ...over,
});

describe('screenNameByCase', () => {
  it('여러 화면을 지나는 케이스는 "첫 화면 외 N"', () => {
    const groups: ScreenCases[] = [
      { routeKey: '/login', name: '로그인', cases: [c('a.spec.ts', '가입')], counts },
      { routeKey: '/home', name: '홈', cases: [c('a.spec.ts', '가입')], counts },
    ];
    expect(screenNameByCase(groups).get('a.spec.ts\n가입')).toBe('로그인 외 1');
  });

  it('화면을 모르는 묶음(routeKey null)은 이름을 주지 않는다', () => {
    const groups: ScreenCases[] = [{ routeKey: null, name: '화면을 모르는 테스트', cases: [c('a.spec.ts', '가입')], counts }];
    expect(screenNameByCase(groups).get('a.spec.ts\n가입')).toBeUndefined();
  });
});

describe('planAsResults', () => {
  it('결과 없는 항목은 빠지고, 있는 항목은 차수 결과 모양이 된다', () => {
    expect(planAsResults([item({ lastStatus: null }), item({ title: '탈퇴', lastStatus: 'FAILED' })])).toEqual([
      { specPath: 'a.spec.ts', caseTitle: '탈퇴', status: 'FAILED', errorMessage: null, change: 'FIRST_RUN', previousRound: null },
    ]);
  });
});

describe('failingScreens', () => {
  const g = (name: string, failed: number, routeKey: string | null = `/${name}`): ScreenCases => ({
    routeKey, name, cases: [], counts: { ...counts, failed },
  });

  it('실패가 있는 화면만 많은 순으로, 같으면 이름순', () => {
    expect(failingScreens([g('홈', 1), g('로그인', 3), g('설정', 0), g('결제', 1)])).toEqual([
      { name: '로그인', failed: 3 },
      { name: '결제', failed: 1 },
      { name: '홈', failed: 1 },
    ]);
  });

  it('화면을 모르는 묶음도 실패가 있으면 넣는다', () => {
    expect(failingScreens([g('화면을 모르는 테스트', 2, null)])).toEqual([{ name: '화면을 모르는 테스트', failed: 2 }]);
  });
});

describe('inSuite', () => {
  const suite = (grep: string | null) => ({ specPaths: ['tests/a.spec.ts'], grep });

  it('스위트 파일 목록에 있는 항목만 포함한다', () => {
    expect(inSuite(suite(null), item({ specPath: 'tests/a.spec.ts' }))).toBe(true);
    expect(inSuite(suite(null), item({ specPath: 'tests/b.spec.ts' }))).toBe(false);
  });

  it('필터가 있으면 파일 · 묶음 · 제목이 맞는 항목만', () => {
    expect(inSuite(suite('로그인'), item({ specPath: 'tests/a.spec.ts', title: '로그인된다' }))).toBe(true);
    expect(inSuite(suite('로그인'), item({ specPath: 'tests/a.spec.ts', title: '가입' }))).toBe(false);
    expect(inSuite(suite('회원'), item({ specPath: 'tests/a.spec.ts', describePath: '회원', title: '가입' }))).toBe(true);
  });

  it('invalidGrepFallsBackToContains', () => {
    expect(inSuite(suite('[가입'), item({ specPath: 'tests/a.spec.ts', title: '[가입 확인' }))).toBe(true);
    expect(inSuite(suite('[가입'), item({ specPath: 'tests/a.spec.ts', title: '로그인' }))).toBe(false);
  });
});

describe('planCounts', () => {
  it('성공 · 실패 · 미수행은 사용 중 항목만, 미사용은 따로 센다', () => {
    expect(
      planCounts([item({ lastStatus: 'PASSED' }), item({ lastStatus: null }), item({ enabled: false, lastStatus: 'FAILED' })])
    ).toEqual({ passed: 1, failed: 0, notRun: 1, disabled: 1 });
  });
});
