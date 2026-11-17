import { Link } from 'react-router-dom';
import { CalendarClock, ClipboardList, Map as MapIcon, Network } from 'lucide-react';
import type { Coverage, ExecutionSchedule, ScenarioTree, TestRound } from '@/types';
import { NODE_STATE_META, progressSegments, summarySentence, timeAgo } from '@/lib/coverage';
import { mappingStats, nextScheduledRun, type ScreenCases } from '@/lib/rounds';
import { cn } from '@/lib/utils';

/**
 * 대시보드 맨 위 요약 4칸. 계획(무엇을) · 매핑(어느 화면에) · 맵(어디까지) · 언제(최근 · 다음 실행).
 * 값을 못 불러온 칸은 무엇을 하면 채워지는지 안내한다.
 */
export function SummaryCards({
  projectId,
  scenarios,
  screens,
  coverage,
  latestRound,
  schedules,
}: {
  projectId: string;
  scenarios: ScenarioTree | null;
  screens: ScreenCases[] | null;
  coverage: Coverage | null;
  latestRound: TestRound | null;
  schedules: ExecutionSchedule[] | null;
}) {
  const base = `/projects/${projectId}`;
  const mapping = screens ? mappingStats(screens) : null;
  const next = schedules ? nextScheduledRun(schedules) : null;
  const hasMap = Boolean(coverage && coverage.summary.screens > 0);

  return (
    <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2 @7xl:grid-cols-4">
      <Card icon={ClipboardList} title="계획" to={`${base}/scenarios`} linkLabel="테스트 보기">
        {scenarios ? (
          <>
            <Big>테스트 {scenarios.totalCases}개</Big>
            <Sub>파일 {scenarios.totalSpecs}개에 나눠 준비되어 있어요</Sub>
          </>
        ) : (
          <Sub>테스트 목록을 불러오는 중이에요</Sub>
        )}
      </Card>

      <Card icon={Network} title="매핑" to={`${base}/structure`} linkLabel="구조에서 보기">
        {mapping && mapping.screens > 0 ? (
          <>
            <Big>
              화면 {mapping.screens}개 중 {mapping.mapped}개
            </Big>
            <Bar percent={(mapping.mapped / mapping.screens) * 100} />
            <Sub>테스트가 지나가는 화면이에요</Sub>
          </>
        ) : (
          <Sub>구조 탭에서 화면을 찾으면 테스트가 어느 화면을 지나는지 보여 줘요</Sub>
        )}
      </Card>

      <Card icon={MapIcon} title="맵" to={`${base}/structure`} linkLabel="지도 열기">
        {hasMap && coverage ? (
          <>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
              {progressSegments(coverage.summary)
                .filter((s) => s.count > 0)
                .map((s) => (
                  <span key={s.state} className={NODE_STATE_META[s.state].bar} style={{ width: `${s.percent}%` }} />
                ))}
            </div>
            <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {progressSegments(coverage.summary).map((s) => (
                <li key={s.state} className="flex items-center gap-1.5" title={NODE_STATE_META[s.state].hint}>
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', NODE_STATE_META[s.state].bar)} />
                  <span className="truncate">{NODE_STATE_META[s.state].label}</span>
                  <span className="ml-auto font-semibold text-foreground">{s.count}</span>
                </li>
              ))}
            </ul>
            <Sub>{summarySentence(coverage.summary)}</Sub>
          </>
        ) : (
          <Sub>아직 지도에 화면이 없어요. 구조 탭에서 사이트를 분석해 보세요</Sub>
        )}
      </Card>

      <Card icon={CalendarClock} title="언제" to={`${base}/schedules`} linkLabel="예약 관리">
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-muted-foreground">최근</dt>
            <dd className="text-right font-semibold text-foreground">
              {latestRound
                ? `${latestRound.round}차 · ${timeAgo(latestRound.startedAt ?? latestRound.finishedAt) || '방금 전'}`
                : '아직 없음'}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-muted-foreground">다음 예약</dt>
            <dd className="text-right font-semibold text-foreground">
              {next
                ? next.at.toLocaleString('ko-KR', {
                    month: 'long',
                    day: 'numeric',
                    weekday: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '없음'}
            </dd>
          </div>
        </dl>
        {next?.schedule.name && <Sub>{next.schedule.name}</Sub>}
      </Card>
    </div>
  );
}

function Card({
  icon: Icon,
  title,
  to,
  linkLabel,
  children,
}: {
  icon: typeof ClipboardList;
  title: string;
  to: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-lg border border-border bg-card p-4" aria-label={title}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5 text-primary" />
          {title}
        </h4>
        <Link to={to} className="text-xs font-medium text-primary hover:underline">
          {linkLabel}
        </Link>
      </div>
      <div className="flex-1 space-y-1.5">{children}</div>
    </section>
  );
}

function Big({ children }: { children: React.ReactNode }) {
  return <p className="text-xl font-semibold text-foreground">{children}</p>;
}

function Sub({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

function Bar({ percent }: { percent: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(percent)}%` }} />
    </div>
  );
}
