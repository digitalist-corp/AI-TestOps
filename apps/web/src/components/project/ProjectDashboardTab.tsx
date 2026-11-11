import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Clock3, FileCode, GitCompare, Loader2, Network, Play } from 'lucide-react';
import { api } from '@/api/client';
import type {
  Coverage,
  Execution,
  ExecutionSchedule,
  Project,
  ScenarioTree,
  SiteMap,
  TestRound,
  TestRoundDetail,
} from '@/types';
import { Button } from '@/components/ui/Button';
import { SummaryCards } from '@/components/dashboard/SummaryCards';
import { RoundChanges, RoundTrend } from '@/components/dashboard/RoundView';
import { CaseTree } from '@/components/dashboard/CaseTree';
import { casesByScreen, isRoundRunning, roundOptionLabel, roundSentence } from '@/lib/rounds';

function formatDuration(durationMs: number | null) {
  if (durationMs == null) return null;
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}초`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}분 ${seconds}초` : `${minutes}분`;
}

/**
 * 프로젝트 대시보드. 비전공자도 한눈에 보도록
 * 요약 4칸(계획 · 매핑 · 맵 · 언제) → 차수 고르기와 한 문장 결과 → 지난번 대비 변화 → 화면별 케이스 트리 순으로 놓는다.
 * 차수(N차 테스트)는 사용자가 돌린 실행을 순서대로 센 것이다.
 */
export function ProjectDashboardTab({
  project,
  executions,
  onRun,
  onOpenSource,
  onOpenRuns,
  onOpenResults,
}: {
  project: Project;
  executions: Execution[];
  onRun: () => void;
  onOpenSource: () => void;
  onOpenRuns: () => void;
  onOpenResults: () => void;
}) {
  const projectId = project.projectId;
  const [rounds, setRounds] = useState<TestRound[] | null>(null);
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TestRoundDetail | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioTree | null>(null);
  const [siteMap, setSiteMap] = useState<SiteMap | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [schedules, setSchedules] = useState<ExecutionSchedule[] | null>(null);

  // 실행 목록은 화면이 자주 다시 읽는다. 실행이 생기거나 상태가 바뀔 때만 차수와 지도를 다시 읽는다.
  const runKey = executions.map((e) => `${e.id}:${e.status}`).join(',');

  useEffect(() => {
    let alive = true;
    api.rounds.list(projectId).then((list) => alive && setRounds(list)).catch(() => alive && setRounds([]));
    api.getSiteMapCoverage(projectId).then((c) => alive && setCoverage(c)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId, runKey]);

  useEffect(() => {
    let alive = true;
    api.getScenarios(projectId).then((s) => alive && setScenarios(s)).catch(() => {});
    api.getSiteMap(projectId).then((m) => alive && setSiteMap(m)).catch(() => {});
    api.schedules.listByProject(projectId).then((s) => alive && setSchedules(s)).catch(() => alive && setSchedules([]));
    return () => {
      alive = false;
    };
  }, [projectId]);

  // 고르지 않았으면 가장 최근 차수를 따라간다.
  const selected = rounds?.find((r) => r.executionId === pickedId) ?? rounds?.[0] ?? null;
  const selectedKey = selected ? `${selected.executionId}:${selected.status}` : null;

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let alive = true;
    api.rounds
      .get(projectId, selected.executionId)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail(null));
    return () => {
      alive = false;
    };
    // selectedKey 가 바뀔 때(다른 차수 · 상태 변화)만 다시 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selectedKey]);

  const screens = useMemo(
    () =>
      scenarios
        ? casesByScreen({
            nodes: siteMap?.nodes ?? [],
            flows: coverage?.flows ?? [],
            specs: scenarios.specs,
            results: detail && detail.round.executionId === selected?.executionId ? detail.cases : [],
          })
        : null,
    [scenarios, siteMap, coverage, detail, selected?.executionId]
  );

  const detailMatches = detail && selected && detail.round.executionId === selected.executionId;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 @5xl:flex-row @5xl:items-center @5xl:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">프로젝트 대시보드</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {project.projectName}를 무엇을 · 어느 화면에서 · 언제 테스트했는지 한눈에 봅니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onRun}>
            <Play className="h-4 w-4" />
            전체 실행
          </Button>
          <Button size="sm" variant="outline" onClick={onOpenSource}>
            <FileCode className="h-4 w-4" />
            소스
          </Button>
          <Button size="sm" variant="outline" onClick={onOpenRuns}>
            <Clock3 className="h-4 w-4" />
            이력
          </Button>
        </div>
      </div>

      <SummaryCards
        projectId={projectId}
        scenarios={scenarios}
        screens={screens}
        coverage={coverage}
        latestRound={rounds?.[0] ?? null}
        schedules={schedules}
      />

      <section className="rounded-lg border border-border bg-card p-4" aria-label="차수별 결과">
        <div className="flex flex-col gap-3 @3xl:flex-row @3xl:items-end @3xl:justify-between">
          <div className="min-w-0">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <BarChart3 className="h-4 w-4 text-primary" />
              차수별 결과
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              테스트를 돌린 순서대로 1차, 2차…로 부릅니다. 차수를 고르면 아래 내용이 모두 그 차수 기준으로 바뀌어요.
            </p>
          </div>
          {rounds && rounds.length > 0 && (
            <div className="flex shrink-0 flex-col gap-1">
              <label htmlFor="round-picker" className="text-xs font-semibold text-muted-foreground">
                차수 고르기
              </label>
              <select
                id="round-picker"
                value={selected?.executionId ?? ''}
                onChange={(e) => setPickedId(Number(e.target.value))}
                className="h-10 w-full min-w-0 rounded-sm border border-border bg-card px-3 text-sm text-foreground hover:border-border-strong @3xl:w-[320px]"
              >
                {rounds.map((r) => (
                  <option key={r.executionId} value={r.executionId}>
                    {roundOptionLabel(r)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {rounds === null ? (
          <Loading />
        ) : rounds.length === 0 ? (
          <p className="mt-4 rounded-md bg-muted px-4 py-10 text-center text-sm text-muted-foreground">
            아직 돌린 테스트가 없어요. 위의 ‘전체 실행’을 누르면 1차 테스트가 시작돼요.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {selected && (
              <div className="rounded-md border border-primary/20 bg-primary/5 px-4 py-3">
                <p className="text-[15px] font-medium leading-relaxed text-foreground">
                  {detailMatches ? roundSentence(detail) : `${selected.round}차 테스트 결과를 불러오는 중이에요.`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selected.title}
                  {formatDuration(selected.durationMs) && ` · ${formatDuration(selected.durationMs)} 걸림`}
                  {' · '}
                  <button type="button" onClick={onOpenResults} className="font-medium text-primary hover:underline">
                    로그와 화면 기록 보기
                  </button>
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 @7xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <h5 className="mb-1 text-xs font-semibold text-muted-foreground">최근 차수 흐름 (막대를 누르면 그 차수로)</h5>
                <RoundTrend rounds={rounds} selectedId={selected?.executionId ?? null} onSelect={setPickedId} />
              </div>
              <div>
                <h5 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <GitCompare className="h-3.5 w-3.5" />
                  지난번과 비교
                </h5>
                {detailMatches && detail ? (
                  isRoundRunning(detail.round) ? (
                    <p className="text-sm text-muted-foreground">끝나면 지난번과 비교해 보여 줄게요.</p>
                  ) : (
                    <RoundChanges detail={detail} />
                  )
                ) : (
                  <Loading />
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4" aria-label="화면별 케이스">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Network className="h-4 w-4 text-primary" />
          화면별 케이스
        </h4>
        <p className="mb-3 mt-1 text-xs text-muted-foreground">
          화면마다 어떤 기능을 테스트하는지 펼쳐 봅니다.
          {selected ? ` 색은 ${selected.round}차 테스트 결과예요.` : ''} 화면을 누르면 오른쪽에 케이스 목록이 나와요.
        </p>
        {screens ? (
          <CaseTree
            projectName={project.projectName}
            groups={screens}
            roundLabel={selected ? `${selected.round}차 테스트` : '아직 돌리지 않은'}
          />
        ) : (
          <Loading />
        )}
      </section>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      불러오는 중...
    </div>
  );
}
