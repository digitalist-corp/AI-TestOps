import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { caseRun, groupRun, ranCase } from './caseRun';

/** 테스트 탭에서 고른 케이스 실행 (3차 2번): 화면은 키만 보내고 서버가 #135 정확 일치 패턴을 만든다. */
describe('고른 케이스 실행 옵션', () => {
  it('케이스는 키(파일 · grep)를 TEST 로 보내고 정규식을 만들지 않는다', () => {
    const options = caseRun([
      { specPath: 'tests/a.spec.ts', grep: '로그인(성공)', title: '로그인(성공)' },
      { specPath: 'tests/b.spec.ts', grep: '결제', title: '결제' },
    ]);
    expect(options).toEqual({
      cases: [
        { specPath: 'tests/a.spec.ts', grep: '로그인(성공)', nodeType: 'TEST' },
        { specPath: 'tests/b.spec.ts', grep: '결제', nodeType: 'TEST' },
      ],
      caseTitle: '선택 케이스 2건',
    });
    expect(caseRun([{ specPath: 'tests/a.spec.ts', grep: '로그인', title: '로그인' }]).caseTitle).toBe('로그인');
  });

  it('묶음은 DESCRIBE 로, 파일 전체(grep 없음)는 파일로만', () => {
    expect(groupRun({ specPath: 'tests/a.spec.ts', grep: '결제', title: '결제' })).toEqual({
      cases: [{ specPath: 'tests/a.spec.ts', grep: '결제', nodeType: 'DESCRIBE' }],
      caseTitle: '결제',
    });
    expect(groupRun({ specPath: 'tests/a.spec.ts', grep: null, title: 'a.spec.ts' })).toEqual({
      specPath: 'tests/a.spec.ts',
      caseTitle: 'a.spec.ts',
    });
  });
});

describe('api.runTests', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('고른 케이스를 본문의 cases 로 보낸다', async () => {
    await api.runTests('p1', caseRun([{ specPath: 'tests/a.spec.ts', grep: '로그인', title: '로그인' }]));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.cases).toEqual([{ specPath: 'tests/a.spec.ts', grep: '로그인', nodeType: 'TEST' }]);
    expect(body.grep).toBeNull();
  });
});

/** 코드 리뷰 1번: 정확 일치 패턴(파일 + 묶음 + 제목)으로 저장된 실행도 테스트 탭의 케이스 상태 · 이력에 잡혀야 한다 */
describe('이 케이스가 그 실행에 들어갔나', () => {
  const anchored = '(?:^| )(?:tests/demo\\.spec\\.ts|demo\\.spec\\.ts) 시연(?: @\\S+)* 확인(?: @\\S+)* 로그인(?: @\\S+)*$';

  it('정확 일치 패턴으로 돌린 실행은 그 케이스에 잡히고 비슷한 제목에는 안 잡힌다', () => {
    expect(ranCase(anchored, 'tests/demo.spec.ts', '시연 확인 로그인')).toBe(true);
    expect(ranCase(anchored, 'tests/demo.spec.ts', '시연 확인 관리자 로그인')).toBe(false);
    expect(ranCase(anchored, 'tests/other.spec.ts', '시연 확인 로그인')).toBe(false);
  });

  it('예전 방식(이름 그대로 · 부분 일치 정규식)으로 돌린 실행도 그대로 잡힌다', () => {
    expect(ranCase('시연 확인 로그인', 'tests/demo.spec.ts', '시연 확인 로그인')).toBe(true);
    expect(ranCase('(?:로그인|결제)', 'tests/demo.spec.ts', '결제')).toBe(true);
    expect(ranCase(null, 'tests/demo.spec.ts', '결제')).toBe(false);
    expect(ranCase('(', 'tests/demo.spec.ts', '결제')).toBe(false);
  });
});
