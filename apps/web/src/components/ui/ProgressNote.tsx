import { useEffect, useState } from 'react';
import { Hourglass, Loader2 } from 'lucide-react';
import { progressText } from '@/lib/eta';
import { cn } from '@/lib/utils';

/**
 * 진행 중 표시: 도는 동안 스피너 + 경과 · 남은 예상 시간(이력이 있을 때), 1초마다 갱신.
 * waiting 은 사람 차례(승인 대기 등) — 스피너 대신 모래시계, 남은 시간은 보이지 않는다.
 * 이미 스피너가 있는 줄에는 label 없이 icon={false} 로 시간 글자만 붙인다.
 */
export function ProgressNote({
  label,
  startedAt,
  estimateMs,
  waiting = false,
  icon = true,
  className,
}: {
  label?: string;
  startedAt?: string | null;
  estimateMs?: number | null;
  waiting?: boolean;
  icon?: boolean;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const start = startedAt ? Date.parse(startedAt) : NaN;

  return (
    <span role="status" className={cn('inline-flex items-center gap-1.5 text-xs', className)}>
      {icon &&
        (waiting ? (
          <Hourglass className="h-3.5 w-3.5 shrink-0 text-warning" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        ))}
      {label && <span className="font-medium text-foreground">{label}</span>}
      {Number.isFinite(start) && (
        <span className="text-muted-foreground">
          {label && '· '}
          {progressText(Math.max(0, now - start), waiting ? null : estimateMs)}
        </span>
      )}
    </span>
  );
}
