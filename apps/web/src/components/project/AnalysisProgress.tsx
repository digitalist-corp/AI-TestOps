import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** "약 40초 남음". 화면을 하나도 읽기 전에는 추정할 근거가 없어 서버가 null 을 준다. */
export function formatEta(etaSeconds: number | null): string {
  if (etaSeconds == null) return '';
  if (etaSeconds < 60) return `약 ${Math.max(5, Math.ceil(etaSeconds / 5) * 5)}초 남음`;
  return `약 ${Math.ceil(etaSeconds / 60)}분 남음`;
}

export function analysisProgressLabel(screenCount: number, processedCount: number): string {
  return screenCount > 0 ? `구조 분석 중 ${processedCount}/${screenCount}` : '구조 분석 중 · 저장소 받는 중';
}

/** 구조 분석이 뒤에서 돌고 있음을 알리는 작은 배지. */
export function AnalysisProgress({
  screenCount,
  processedCount,
  etaSeconds,
  className,
}: {
  screenCount: number;
  processedCount: number;
  etaSeconds: number | null;
  className?: string;
}) {
  const eta = formatEta(etaSeconds);
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary',
        className
      )}
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      {analysisProgressLabel(screenCount, processedCount)}
      {eta && <span className="font-normal"> · {eta}</span>}
    </span>
  );
}
