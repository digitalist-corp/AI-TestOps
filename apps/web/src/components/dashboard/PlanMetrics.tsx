import { AlertTriangle, ClipboardList } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { PlanSummary } from '@/types';
import { cn } from '@/lib/utils';

/**
 * 대시보드 첫 줄. 계획 표 기준 지표와 오류 난 화면.
 * 완료율 = 최근 성공 ÷ 사용 중 항목 (미사용은 분모에서 빼고 건수만 보여 준다).
 */
export function PlanMetrics({
  projectId,
  summary,
  failing,
}: {
  projectId: string;
  summary: PlanSummary | null;
  failing: { name: string; failed: number }[] | null;
}) {
  return (
    <section
      aria-label="품질 현황"
      className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-card p-4 @5xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ClipboardList className="h-4 w-4 text-primary" />
            품질 현황 (계획 기준)
          </h4>
          <Link to={`/projects/${projectId}/plan`} className="text-xs font-medium text-primary hover:underline">
            계획 표 열기 →
          </Link>
        </div>
        {summary ? (
          <>
            <div className="mt-3 flex items-end gap-3">
              <span className="text-4xl font-bold tabular-nums text-foreground">
                {Math.round(summary.completionRate * 100)}%
              </span>
              <span className="pb-1 text-sm text-muted-foreground">완료율 · 사용 중 {summary.enabled}건 중 {summary.passed}건 성공</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className="block h-full bg-success" style={{ width: `${summary.completionRate * 100}%` }} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm @3xl:grid-cols-5">
              <Metric label="전체 계획" value={`${summary.total}`} />
              <Metric label="사용 / 미사용" value={`사용 ${summary.enabled} · 미사용 ${summary.disabled}`} />
              <Metric label="성공" value={`${summary.passed}`} tone="text-success" />
              <Metric label="실패" value={`${summary.failed}`} tone="text-destructive" />
              <Metric label="미수행" value={`${summary.notRun}`} />
            </dl>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">계획 표를 불러오는 중이에요.</p>
        )}
      </div>

      <div>
        <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          오류 난 화면
        </h4>
        {failing === null ? (
          <p className="mt-3 text-sm text-muted-foreground">불러오는 중이에요.</p>
        ) : failing.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">오류 난 화면이 없어요.</p>
        ) : (
          <ul aria-label="오류 난 화면" className="mt-2 space-y-1">
            {failing.map((f) => (
              <li key={f.name}>
                <a
                  href="#screen-cases"
                  className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
                >
                  <span className="truncate text-foreground">{f.name}</span>
                  <span className="shrink-0 font-semibold text-destructive">실패 {f.failed}건</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md bg-muted px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('font-semibold text-foreground', tone)}>{value}</dd>
    </div>
  );
}
