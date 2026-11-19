import { describe, expect, it } from 'vitest';
import type { AiJob, Execution } from '@/types';
import { formatDuration, jobEstimateMs, progressText, runEstimateMs } from './eta';

const run = (over: Partial<Execution>) => ({ id: 1, status: 'PASSED', durationMs: 60_000, specPath: null, grepFilter: null, ...over }) as Execution;
const job = (over: Partial<AiJob>) =>
  ({ id: 1, jobType: 'CODE_FIX', status: 'NEEDS_REVIEW', createdAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:02:00Z', ...over }) as AiJob;

describe('남은 시간', () => {
  it('짧게 읽히는 시간 글자', () => {
    expect(formatDuration(5_000)).toBe('5초');
    expect(formatDuration(65_000)).toBe('1분 5초');
    expect(formatDuration(120_000)).toBe('2분');
    expect(formatDuration(3_720_000)).toBe('1시간 2분');
  });

  it('같은 범위의 최근 실행 시간 중앙값으로 예상한다. 이력이 없으면 null', () => {
    const active = run({ id: 9, status: 'RUNNING', durationMs: null });
    const history = [run({ durationMs: 30_000 }), run({ durationMs: 90_000 }), run({ durationMs: 60_000 }),
      run({ durationMs: 999_000, specPath: 'a.spec.ts' }), run({ status: 'CANCELLED', durationMs: 1_000 })];
    expect(runEstimateMs([...history, active], active)).toBe(60_000);
    expect(runEstimateMs([active], active)).toBeNull();
  });

  it('같은 종류의 끝난 AI 작업 시간으로 예상한다. 승인으로 늦게 바뀐 APPLIED 는 빼고', () => {
    const jobs = [job({}), job({ updatedAt: '2026-11-19T00:04:00Z' }), job({ status: 'APPLIED', updatedAt: '2026-11-19T05:00:00Z' }),
      job({ jobType: 'TEMPLATE_GENERATE', updatedAt: '2026-11-19T00:00:10Z' })];
    expect(jobEstimateMs(jobs, 'CODE_FIX')).toBe(180_000);
    expect(jobEstimateMs([], 'CODE_FIX')).toBeNull();
  });

  it('경과 · 남은 시간, 예상을 넘기면 그렇게 말한다', () => {
    expect(progressText(42_000, null)).toBe('42초 경과');
    expect(progressText(30_000, 90_000)).toBe('30초 경과 · 약 1분 남음');
    expect(progressText(100_000, 90_000)).toBe('1분 40초 경과 · 예상(1분 30초)보다 오래 걸리는 중');
  });
});
