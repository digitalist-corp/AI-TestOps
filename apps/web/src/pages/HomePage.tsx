import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import type { AiJob, AiUsageSummary, AppNotification, Notice, PlanItem, PlanSummary, Project, RunnerContainer, User } from '@/types';
import { ConsoleEyebrow } from '@/components/console/ConsoleText';
import { isRunnerReady } from '@/components/project/ProjectCard';
import { projectTabPath } from '@/config/projectWorkspace';
import { useAccess } from '@/lib/access';
import { planCounts } from '@/lib/plan';
import { NoticeStrip } from '@/components/home/NoticeStrip';
import { AdminHome } from '@/components/home/AdminHome';
import { PmHome } from '@/components/home/PmHome';
import { MemberHome } from '@/components/home/MemberHome';

/**
 * 첫 화면 — 역할마다 다르다 (#107, 설계 docs/superpowers/specs/2026-11-19-role-dashboards-design.md 4절).
 * 관리자: 확인 필요 · KPI · 프로젝트 표 / PM: 확인할 것 칩 · 완료율 · 퍼널 · 담당자별 · 승인 대기 / 팀원: 내 할 일 → 바로 실행.
 * 공지는 맨 위 한 줄 띠. 한 사람이 프로젝트마다 PM · 팀원일 수 있어 두 구역이 같이 보일 수 있다.
 * 홈은 보기 · 이동 · 실행만 한다. 승인 · 판정 고치기는 각 탭에서.
 */
export function HomePage() {
  const navigate = useNavigate();
  const { admin, me, roleIn } = useAccess();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [plans, setPlans] = useState<Record<string, PlanItem[]>>({});
  const [summaries, setSummaries] = useState<Record<string, PlanSummary>>({});
  const [defects, setDefects] = useState<Record<string, number>>({});
  const [needsReview, setNeedsReview] = useState<AiJob[]>([]);
  const [aiJobs, setAiJobs] = useState<Record<string, AiJob[]>>({});
  const [users, setUsers] = useState<User[] | null>(null);
  const [runners, setRunners] = useState<RunnerContainer[] | null>(null);
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.getProjects()
      .then((list) => {
        if (!alive) return;
        setProjects(list);
        for (const p of list) {
          api.plan.get(p.projectId)
            .then((plan) => {
              if (!alive) return;
              setPlans((prev) => ({ ...prev, [p.projectId]: plan.items }));
              setSummaries((prev) => ({ ...prev, [p.projectId]: plan.summary }));
            })
            .catch(() => {});
          api.defects.list(p.projectId)
            .then((d) => alive && setDefects((prev) => ({ ...prev, [p.projectId]: d.open })))
            .catch(() => {});
        }
      })
      .catch(() => alive && setProjects([]));
    api.notices.list().then((list) => alive && setNotices(list)).catch(() => {});
    // 서버가 내 프로젝트(관리자는 전체)로 거른다
    api.aiJobs.needsReview().then((list) => alive && setNeedsReview(list)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const pmProjects = !projects || admin ? [] : projects.filter((p) => roleIn(p.projectId) === 'PM');
  const memberProjects = !projects || admin ? [] : projects.filter((p) => roleIn(p.projectId) === 'MEMBER');
  const pmIds = pmProjects.map((p) => p.projectId).join(',');

  // PM 카드의 '치유됨 · 되돌림' — 맡은 프로젝트만 부른다
  useEffect(() => {
    let alive = true;
    for (const pid of pmIds ? pmIds.split(',') : []) {
      api.aiJobs.listByProject(pid).then((list) => alive && setAiJobs((prev) => ({ ...prev, [pid]: list }))).catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [pmIds]);

  useEffect(() => {
    if (!admin) return;
    api.getUsers().then(setUsers).catch(() => {});
    api.getRunnerContainers().then(setRunners).catch(() => {});
    api.getAiUsage(30).then(setUsage).catch(() => {});
    api.getNotifications().then(setNotifications).catch(() => {});
  }, [admin]);

  /** 러너가 꺼져 있으면 상주 러너만 켜고, 그 밖은 안내 */
  const ensureRunner = async (project: Project) => {
    if (isRunnerReady(project)) return true;
    if (!(project.dockerEnabled && project.runnerLifecycle === 'PERSISTENT')) {
      alert('Docker Runner를 사용할 수 없습니다. PM에게 프로젝트 설정 확인을 요청하세요.');
      return false;
    }
    await api.startDocker(project.projectId);
    return true;
  };

  const act = async (key: string, project: Project, run: () => Promise<unknown>) => {
    setBusyKey(key);
    try {
      if (!(await ensureRunner(project))) return;
      await run();
      navigate(projectTabPath(project.projectId, 'runs'));
    } catch (err) {
      alert(err instanceof Error ? err.message : '실행하지 못했습니다.');
    } finally {
      setBusyKey(null);
    }
  };

  /** 미해결 결함 전부를 결함 다시 실행 API로 — 새 실행이 실패했던 실행에 이어진다 (#83) */
  const rerunFailed = (project: Project, items: PlanItem[]) => {
    const failed = planCounts(items).failed;
    if (failed === 0 || !window.confirm(`'${project.projectName}'의 실패 ${failed}건을 다시 실행할까요?`)) return;
    void act(project.projectId, project, () => api.defects.rerun(project.projectId, []));
  };
  const caseKey = (project: Project, item: PlanItem) => `${project.projectId}\n${item.specPath}\n${item.grep}`;
  /** 케이스 하나 실행 — 서버가 정확 일치 패턴을 만든다 */
  const runCase = (project: Project, item: PlanItem) =>
    void act(caseKey(project, item), project, () =>
      api.runTests(project.projectId, { cases: [{ specPath: item.specPath, grep: item.grep, nodeType: 'TEST' }] }));
  /** 실패한 케이스 하나 다시 실행 — 실패했던 실행에 이어진다 */
  const rerunCase = (project: Project, item: PlanItem) =>
    void act(caseKey(project, item), project, () => api.defects.rerun(project.projectId, [{ specPath: item.specPath, grep: item.grep }]));

  if (!projects) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="@container space-y-8 p-6">
      <div className="space-y-3">
        <div>
          <ConsoleEyebrow>WORKSPACE // HOME</ConsoleEyebrow>
          <h2 className="text-[24px] font-bold leading-tight text-foreground">홈</h2>
        </div>
        <NoticeStrip notices={notices} />
      </div>

      {admin && (
        <AdminHome projects={projects} plans={plans} defects={defects} needsReview={needsReview}
                   users={users} runners={runners} usage={usage} notifications={notifications} />
      )}

      {pmProjects.length > 0 && (
        <PmHome projects={pmProjects} plans={plans} summaries={summaries} defects={defects} needsReview={needsReview} aiJobs={aiJobs} />
      )}

      {memberProjects.length > 0 && me?.id != null && (
        <MemberHome projects={memberProjects} plans={plans} defects={defects} userId={me.id}
                    onRunCase={runCase} onRerunCase={rerunCase} onRerunFailed={rerunFailed} busyKey={busyKey} />
      )}

      {!admin && pmProjects.length === 0 && memberProjects.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-12 text-center">
          <h3 className="text-[19px] font-bold text-foreground">소속된 프로젝트가 없습니다</h3>
          <p className="mt-2 text-[15px] text-muted-foreground">PM에게 초대를 요청하세요.</p>
        </div>
      )}
    </div>
  );
}
