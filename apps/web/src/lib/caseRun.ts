import type { RunTestOptions } from '@/types';

type Picked = { specPath: string; grep: string; title: string };

/** 테스트 탭에서 고른 케이스: 키만 보내고 서버가 #135 정확 일치 패턴을 만든다 (비슷한 제목이 같이 돌지 않게). */
export function caseRun(picked: Picked[]): RunTestOptions {
  return {
    cases: picked.map(({ specPath, grep }) => ({ specPath, grep, nodeType: 'TEST' as const })),
    caseTitle: picked.length === 1 ? picked[0].title : `선택 케이스 ${picked.length}건`,
  };
}

/** 묶음 하나(그 아래 케이스 전부). grep 이 없으면 파일 전체. */
export function groupRun(picked: Omit<Picked, 'grep'> & { grep: string | null }): RunTestOptions {
  if (!picked.grep) return { specPath: picked.specPath, caseTitle: picked.title };
  return { cases: [{ specPath: picked.specPath, grep: picked.grep, nodeType: 'DESCRIBE' }], caseTitle: picked.title };
}

/**
 * 이 케이스(파일 · 키)가 그 실행의 grep 에 들어갔나 — 테스트 탭의 케이스 상태 · 묶음 상태용.
 * 정확 일치 패턴은 Playwright 처럼 "파일 키" 문자열에 맞춰 보고, 예전 실행(이름 그대로 · 부분 일치)은 키에 맞춰 본다.
 */
export function ranCase(grepFilter: string | null, specPath: string, grep: string): boolean {
  if (!grepFilter) return false;
  if (grepFilter === grep) return true;
  try {
    const re = new RegExp(grepFilter);
    return re.test(`${specPath} ${grep}`) || re.test(grep);
  } catch {
    return false;
  }
}
