import { describe, expect, it } from 'vitest';
import { parseRunProgress } from '@/lib/runProgress';

const head = '[install] 시작\n[test] 시작\n\nRunning 6 tests using 1 worker\n\n';

describe('parseRunProgress', () => {
  it('테스트가 시작되기 전이면 null', () => {
    expect(parseRunProgress('[install] 시작\n')).toBeNull();
  });

  it('[N/M] 줄로 완료 수를, 1) 2) 실패 블록으로 실패 수를 센다', () => {
    const log = head
      + '[1/6] [chromium] › a.spec.ts:1:1 › 로그인\n'
      + '[2/6] [chromium] › a.spec.ts:9:1 › 목록\n'
      + '  1) [chromium] › a.spec.ts:9:1 › 목록 \n\n    Error: 못 찾음\n'
      + '[3/6] [chromium] › a.spec.ts:20:1 › 등록\n';
    expect(parseRunProgress(log)).toEqual({ total: 6, done: 2, passed: 1, failed: 1 });
  });

  it('끝 요약이 나오면 전부 완료로 본다', () => {
    const log = head + '[6/6] [chromium] › a.spec.ts:1:1 › 마지막\n  6 passed (40.5s)\n';
    expect(parseRunProgress(log)).toEqual({ total: 6, done: 6, passed: 6, failed: 0 });
  });

  it('테스트가 1개면 "1 test" 로 나온다', () => {
    expect(parseRunProgress('Running 1 test using 1 worker\n')).toEqual({ total: 1, done: 0, passed: 0, failed: 0 });
  });
});
