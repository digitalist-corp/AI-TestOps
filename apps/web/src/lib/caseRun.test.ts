import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { caseRun, groupRun } from './caseRun';

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
