import { Link } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import type { PlanDailyResponse } from '@/types';
import { hasScheduledRuns, percent, shortDate } from '@/lib/planDaily';

/**
 * 대시보드 ③ 추세. 일자별 정기 실행 통과율(계획 표의 "정기 실행" 칸과 같은 데이터) 막대와 다음 정기 실행.
 * 막대 위에 값을 직접 쓰고, 그날 결과가 없으면 점선 빈칸이다. 정기 실행 기록이 없으면 안내만 보인다.
 */
export function PassRateTrend({
  daily,
  nextRun,
  settingsPath,
}: {
  /** null = 아직 못 받음 */
  daily: PlanDailyResponse | null;
  /** 다음 정기 실행 문장. null = 아직 모름, '' = 켜진 정기 실행이 없음 */
  nextRun: string | null;
  /** 정기 실행 설정으로 가는 주소. PM · 관리자에게만 준다 */
  settingsPath?: string;
}) {
  return (
    <section aria-label="추세" className="space-y-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <TrendingUp className="h-4 w-4 text-primary" />
        추세
        <span className="text-xs font-normal text-muted-foreground">정기 실행 통과율 · 최근 {daily?.days.length ?? 7}일</span>
      </h4>

      {daily === null ? (
        <p className="text-sm text-muted-foreground">불러오는 중이에요.</p>
      ) : !hasScheduledRuns(daily) ? (
        <p className="rounded-md bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
          정기 실행을 켜면 여기에 쌓여요.
          {settingsPath && (
            <>
              {' '}
              <Link to={settingsPath} className="font-medium text-primary hover:underline">
                정기 실행 설정 →
              </Link>
            </>
          )}
        </p>
      ) : (
        <ul aria-label="일자별 정기 실행 통과율" className="flex items-end gap-2">
          {daily.totals.map((t) => (
            <li
              key={t.date}
              className="flex min-w-0 flex-1 flex-col items-center gap-1"
              title={
                t.passRate === null
                  ? `${shortDate(t.date)} · 정기 실행 없음`
                  : `${shortDate(t.date)} · 통과 ${t.passed} · 실패 ${t.failed} · ${percent(t.passRate)}`
              }
              aria-label={`${shortDate(t.date)} 통과율 ${percent(t.passRate)}`}
            >
              <span className="text-xs font-semibold tabular-nums text-foreground">{percent(t.passRate)}</span>
              <span className="flex h-20 w-full items-end justify-center">
                {t.passRate === null ? (
                  <span className="w-full max-w-7 border-b border-dashed border-border-strong" />
                ) : (
                  <span
                    className="w-full max-w-7 rounded-t-[4px] bg-primary"
                    style={{ height: `max(2px, ${t.passRate * 100}%)` }}
                  />
                )}
              </span>
              <span className="text-[11px] text-muted-foreground">{shortDate(t.date)}</span>
            </li>
          ))}
        </ul>
      )}

      {nextRun !== null && (
        <p className="text-sm text-muted-foreground">
          다음 정기 실행: <span className="font-semibold text-foreground">{nextRun || '없음'}</span>
        </p>
      )}
    </section>
  );
}
