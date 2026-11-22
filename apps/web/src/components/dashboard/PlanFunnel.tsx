import { Link } from 'react-router-dom';
import type { PlanSummary } from '@/types';
import { planFunnel } from '@/lib/dashboard';
import { cn } from '@/lib/utils';

const pct = (rate: number) => Math.round(rate * 100);

/**
 * 대시보드 ① 계획은 얼마나 됐나. 계획 → 작성 → 실행 → 통과 막대와 완료율.
 * 모두 사용 중 항목 기준이고, 각 숫자는 계획 표로 가는 링크다.
 * 완료율 = 통과 ÷ 계획 (아직 작성하지 않은 항목도 분모에 들어간다).
 */
export function PlanFunnel({
  projectId,
  summary,
  overdueCount,
}: {
  projectId: string;
  summary: PlanSummary | null;
  /** 사용 중 · 통과 아님 · 마감 지난 항목 */
  overdueCount: number | null;
}) {
  const planPath = `/projects/${projectId}/plan`;
  return (
    <section aria-label="계획 진척">
      <h4 className="text-sm font-semibold text-foreground">계획은 얼마나 됐나</h4>
      {summary === null ? (
        <p className="mt-3 text-sm text-muted-foreground">계획 표를 불러오는 중이에요.</p>
      ) : summary.enabled === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          아직 사용 중인 계획이 없어요.{' '}
          <Link to={planPath} className="font-medium text-primary hover:underline">
            계획 표 열기 →
          </Link>
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-1 gap-4 @3xl:grid-cols-[minmax(0,1fr)_auto] @3xl:items-center">
            <ol aria-label="계획 진척 퍼널" className="space-y-1.5">
              {planFunnel(summary).map((step) => (
                <li key={step.key} className="grid grid-cols-[2.5rem_minmax(0,1fr)_7rem] items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{step.label}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span
                      className={cn('block h-full rounded-full', step.key === 'passed' ? 'bg-success' : 'bg-primary')}
                      style={{ width: `${(step.count / summary.enabled) * 100}%` }}
                    />
                  </span>
                  <Link to={planPath} className="font-semibold tabular-nums text-foreground hover:underline">
                    {step.count}
                    {step.key === 'written' && <span className="font-normal text-muted-foreground"> ({pct(summary.writtenRate)}%)</span>}
                  </Link>
                </li>
              ))}
            </ol>
            <div className="@3xl:text-right">
              <p className="text-xs text-muted-foreground">완료율 · 계획 대비 통과</p>
              <p className="text-4xl font-bold tabular-nums text-foreground">{pct(summary.completionRate)}%</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            마감 지난 항목{' '}
            <Link to={planPath} className={cn('font-semibold hover:underline', overdueCount ? 'text-destructive' : 'text-foreground')}>
              {overdueCount ?? '-'}
            </Link>
            {' · '}미사용{' '}
            <Link to={planPath} className="font-semibold text-foreground hover:underline">
              {summary.disabled}
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
