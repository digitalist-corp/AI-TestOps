export interface RunProgress {
  total: number;
  done: number;
  passed: number;
  failed: number;
}

/**
 * Playwright line 리포터 로그에서 진척도를 읽는다. 서버는 끝난 뒤에야 건수를 저장하므로 실행 중에는 로그가 유일한 근거다.
 * ponytail: [N/M] 은 N번째가 "시작됐다"는 뜻이라 완료 = N-1 로 어림한다. 워커가 여럿이면 실제보다 조금 적게 보인다.
 */
export function parseRunProgress(log: string): RunProgress | null {
  const totals = [...log.matchAll(/^Running (\d+) tests? using/gm)];
  if (totals.length === 0) return null;
  const total = Number(totals[totals.length - 1][1]);
  const started = [...log.matchAll(/^\[(\d+)\/\d+\]/gm)].reduce((max, m) => Math.max(max, Number(m[1])), 0);
  const failed = new Set([...log.matchAll(/^\s+(\d+)\) \[/gm)].map((m) => m[1])).size;
  const finished = /^\s+\d+ (passed|failed|skipped|flaky|did not run)\b/m.test(log);
  const done = finished ? total : Math.max(started - 1, failed);
  return { total, done, passed: Math.max(done - failed, 0), failed };
}
