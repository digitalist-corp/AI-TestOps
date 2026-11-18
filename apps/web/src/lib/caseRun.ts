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
