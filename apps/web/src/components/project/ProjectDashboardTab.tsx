import { useEffect, useMemo, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { api } from '@/api/client';
import type { Coverage, Execution, ExecutionSchedule, PlanResponse, Project, ScenarioTree, SiteMap } from '@/types';
import { Button } from '@/components/ui/Button';
import { PlanFunnel } from '@/components/dashboard/PlanFunnel';
import { ProblemSpots } from '@/components/dashboard/ProblemSpots';
import { PassRateTrend } from '@/components/dashboard/PassRateTrend';
import { usePlanDaily } from '@/components/project/planDaily';
import { today } from '@/components/home/parts';
import { failingScreens, overdue, planAsResults } from '@/lib/plan';
import { incompleteByAssignee, nextRunLabel, unplannedScreens } from '@/lib/dashboard';
import { isActiveExecution } from '@/lib/coverage';
import { casesByScreen, nextScheduledRun } from '@/lib/rounds';
import { projectTabPath } from '@/config/projectWorkspace';
import { useAccess } from '@/lib/access';

/**
 * 프로젝트 대시보드. 위에서부터 세 질문에만 답한다.
 * ① 계획은 얼마나 됐나(계획 → 작성 → 실행 → 통과) ② 어디가 문제인가 ③ 추세(정기 실행 통과율).
 * 차수별 결과는 실행 › 실행 이력, 화면별 케이스는 화면 지도 · 계획 표에서 본다.
 */
export function ProjectDashboardTab({
  project,
  executions,
  onRun,
  onStop,
}: {
  project: Project;
  executions: Execution[];
  onRun: () => void;
  /** 실행 중일 때 전체 실행 대신 보이는 중지 */
  onStop?: (executionId: number) => void;
}) {
  const activeRun = executions.find(isActiveExecution);
  const projectId = project.projectId;
  // 정기 실행 설정은 PM (관리 전용 탭)
  const canManage = useAccess().canManage(projectId);
  const [scenarios, setScenarios] = useState<ScenarioTree | null>(null);
  const [siteMap, setSiteMap] = useState<SiteMap | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [schedules, setSchedules] = useState<ExecutionSchedule[] | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [openDefects, setOpenDefects] = useState<number | null>(null);
  const daily = usePlanDaily(projectId);

  // 실행 목록은 화면이 자주 다시 읽는다. 실행이 생기거나 상태가 바뀔 때만 계획 · 결함 · 지도를 다시 읽는다.
  const runKey = executions.map((e) => `${e.id}:${e.status}`).join(',');

  useEffect(() => {
    let alive = true;
    api.plan.get(projectId).then((p) => alive && setPlan(p)).catch(() => {});
    api.defects.list(projectId).then((d) => alive && setOpenDefects(d.open)).catch(() => {});
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

  // 오류 난 화면은 차수가 아니라 계획 항목별 최근 결과로 센다.
  const failing = useMemo(
    () =>
      scenarios && plan
        ? failingScreens(
            casesByScreen({
              nodes: siteMap?.nodes ?? [],
              flows: coverage?.flows ?? [],
              specs: scenarios.specs,
              results: planAsResults(plan.items),
            })
          )
        : plan && plan.items.length === 0
          ? []
          : null,
    [scenarios, siteMap, coverage, plan]
  );

  const unplanned = useMemo(() => (plan && siteMap ? unplannedScreens(siteMap.nodes, plan.screens) : null), [plan, siteMap]);
  const assignees = useMemo(() => (plan ? incompleteByAssignee(plan.items) : null), [plan]);
  const overdueCount = useMemo(() => (plan ? overdue(plan.items, today()).length : null), [plan]);
  const nextRun = useMemo(() => {
    if (!schedules) return null;
    const next = nextScheduledRun(schedules);
    return next ? nextRunLabel(next.at) : '';
  }, [schedules]);

  return (
    <section aria-label="품질 현황" className="space-y-5 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">품질 현황</h3>
          <p className="mt-1 text-sm text-muted-foreground">{project.projectName}의 계획이 어디까지 왔고 어디가 막혀 있는지 봅니다.</p>
        </div>
        {activeRun ? (
          <Button size="sm" variant="outline" disabled={activeRun.status === 'CANCEL_REQUESTED'}
                  onClick={() => onStop?.(activeRun.id)}
                  className="shrink-0 text-destructive hover:border-destructive hover:bg-destructive/10">
            <Square className="h-4 w-4" />
            {activeRun.status === 'CANCEL_REQUESTED' ? '중지 중' : '중지'}
          </Button>
        ) : (
          <Button size="sm" onClick={onRun} className="shrink-0">
            <Play className="h-4 w-4" />
            전체 실행
          </Button>
        )}
      </div>

      <PlanFunnel projectId={projectId} summary={plan?.summary ?? null} overdueCount={overdueCount} />

      <div className="grid grid-cols-1 gap-6 border-t border-border pt-5 @5xl:grid-cols-2">
        <ProblemSpots projectId={projectId} openDefects={openDefects} failing={failing} unplanned={unplanned} assignees={assignees} />
        <PassRateTrend daily={daily} nextRun={nextRun} settingsPath={canManage ? projectTabPath(projectId, 'schedules') : undefined} />
      </div>
    </section>
  );
}
