import type { AiJob, AiJobType, Execution } from '@/types';

/**
 * 진행 중인 일의 경과 · 남은 예상 시간. 예상은 최근 같은 종류의 끝난 일이 걸린 시간의 중앙값이다.
 * 이력이 없으면 null — 그때는 경과 시간만 보인다.
 */
const SAMPLES = 10;

function median(values: number[]): number | null {
  const sorted = values.filter((v) => v > 0).slice(0, SAMPLES).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
  if (m > 0) return s > 0 ? `${m}분 ${s}초` : `${m}분`;
  return `${s}초`;
}

/** 테스트 실행: 같은 범위(전체 · 같은 spec · 같은 케이스)로 끝난 최근 실행. 목록은 최신순 */
export function runEstimateMs(executions: Execution[], active: Execution): number | null {
  const sameScope = (e: Execution) => (e.specPath ?? null) === (active.specPath ?? null) && (e.grepFilter ?? null) === (active.grepFilter ?? null);
  return median(
    executions
      .filter((e) => e.id !== active.id && (e.status === 'PASSED' || e.status === 'FAILED') && sameScope(e))
      .map((e) => e.durationMs ?? 0)
  );
}

/**
 * AI 작업: 같은 종류로 끝난 최근 작업의 만든 시각 → 마지막 변경 시각.
 * APPLIED 는 사람이 승인한 시각에 바뀌어 러너 시간이 아니므로 뺀다. 목록은 최신순
 */
export function jobEstimateMs(jobs: AiJob[], type: AiJobType): number | null {
  return median(
    jobs
      .filter((j) => j.jobType === type && ['NEEDS_REVIEW', 'REJECTED', 'FAILED', 'ERROR'].includes(j.status))
      .map((j) => Date.parse(j.updatedAt) - Date.parse(j.createdAt))
  );
}

export function progressText(elapsedMs: number, estimateMs: number | null | undefined): string {
  const elapsed = `${formatDuration(elapsedMs)} 경과`;
  if (!estimateMs) return elapsed;
  if (elapsedMs > estimateMs) return `${elapsed} · 예상(${formatDuration(estimateMs)})보다 오래 걸리는 중`;
  return `${elapsed} · 약 ${formatDuration(Math.max(estimateMs - elapsedMs, 1000))} 남음`;
}
