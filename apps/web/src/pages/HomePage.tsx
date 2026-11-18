import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Pin, RotateCcw } from 'lucide-react';
import { api } from '@/api/client';
import type { Notice, PlanItem, Project } from '@/types';
import { Button } from '@/components/ui/Button';
import { ConsoleEyebrow } from '@/components/console/ConsoleText';
import { ProjectStatusChip, isRunnerReady, projectPeriod } from '@/components/project/ProjectCard';
import { projectTabPath } from '@/config/projectWorkspace';
import { useAccess } from '@/lib/access';
import { assigneeLabel, byAssignee, failedRerun, overdue, planCounts } from '@/lib/plan';
import { formatRelative } from '@/lib/utils';

const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD (현지 날짜)

/** 진척률 = 성공 ÷ 사용 중 계획 항목 */
function progressOf(items: PlanItem[]) {
  const enabled = items.filter((i) => i.enabled).length;
  return enabled === 0 ? 0 : Math.round((planCounts(items).passed / enabled) * 100);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[19px] font-bold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Tile({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-card px-5 py-4 text-[17px] font-bold text-foreground">{children}</div>;
}

/** 상태 배지 + 기간 (#117) */
function StatusAndPeriod({ project }: { project: Project }) {
  return (
    <span className="flex shrink-0 items-center gap-2 text-[13px] text-muted-foreground">
      <ProjectStatusChip status={project.status ?? 'PLANNED'} />
      {projectPeriod(project) && <span>{projectPeriod(project)}</span>}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-primary" style={{ width: `${value}%` }} />
    </div>
  );
}

/**
 * 첫 화면 — 역할마다 다르다 (#107).
 * 팀원: 내 프로젝트의 성공 · 실패 · 미수행과 실패 재실행 / PM: 진척률 · 팀원별 진행 · 기한 지난 항목 /
 * 관리자: 전체 프로젝트 · 사용자 수 · 러너 상태. 모두에게 맨 위에 최근 공지 3개 (#116). 한 사람이 프로젝트마다 PM · 팀원일 수 있어 두 묶음이 같이 보일 수 있다.
 */
export function HomePage() {
  const navigate = useNavigate();
  const { admin, me, roleIn } = useAccess();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [plans, setPlans] = useState<Record<string, PlanItem[]>>({});
  const [userCount, setUserCount] = useState<number | null>(null);
  const [runners, setRunners] = useState<{ running: number; total: number } | null>(null);
  const [rerunId, setRerunId] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    let alive = true;
    api.getProjects()
      .then((list) => {
        if (!alive) return;
        setProjects(list);
        for (const p of list) {
          api.plan.get(p.projectId)
            .then((plan) => alive && setPlans((prev) => ({ ...prev, [p.projectId]: plan.items })))
            .catch(() => {});
        }
      })
      .catch(() => alive && setProjects([]));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    api.notices.list().then((list) => setNotices(list.slice(0, 3))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!admin) return;
    api.getUsers().then((users) => setUserCount(users.length)).catch(() => {});
    api.getRunnerContainers()
      .then((list) => {
        const own = list.filter((c) => c.containerType === 'RUNNER');
        setRunners({ running: own.filter((c) => c.dockerStatus === 'RUNNING').length, total: own.length });
      })
      .catch(() => {});
  }, [admin]);

  const rerunFailed = async (project: Project, items: PlanItem[]) => {
    const options = failedRerun(items);
    if (!options) return;
    if (!window.confirm(`'${project.projectName}'의 실패 ${planCounts(items).failed}건을 다시 실행할까요?`)) return;
    setRerunId(project.projectId);
    try {
      if (!isRunnerReady(project)) {
        if (!(project.dockerEnabled && project.runnerLifecycle === 'PERSISTENT')) {
          alert('Docker Runner를 사용할 수 없습니다. PM에게 프로젝트 설정 확인을 요청하세요.');
          return;
        }
        await api.startDocker(project.projectId);
      }
      await api.runTests(project.projectId, options);
      navigate(projectTabPath(project.projectId, 'runs'));
    } catch (err) {
      alert(err instanceof Error ? err.message : '다시 실행하지 못했습니다.');
    } finally {
      setRerunId(null);
    }
  };

  if (!projects) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pmProjects = admin ? [] : projects.filter((p) => roleIn(p.projectId) === 'PM');
  const memberProjects = admin ? [] : projects.filter((p) => roleIn(p.projectId) === 'MEMBER');
  // 팀원 홈: 내 계정이 담당자인 사용 중 항목 (#119)
  const mine = memberProjects.flatMap((p) => (plans[p.projectId] ?? [])
    .filter((i) => i.enabled && me?.id != null && i.assigneeUserId === me.id)
    .map((item) => ({ project: p, item })));

  return (
    <div className="@container space-y-8 p-6">
      <div>
        <ConsoleEyebrow>WORKSPACE // HOME</ConsoleEyebrow>
        <h2 className="text-[24px] font-bold leading-tight text-foreground">홈</h2>
      </div>

      {notices.length > 0 && (
        <Section title="공지사항">
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {notices.map((n) => (
              <li key={n.id}>
                <Link to={`/notices/${n.id}`} className="flex items-center gap-2 px-5 py-3 hover:bg-muted">
                  {n.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="고정" />}
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">{n.title}</span>
                  <span className="shrink-0 text-sm text-muted-foreground">{formatRelative(n.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/notices" className="inline-block text-sm text-muted-foreground hover:underline">공지 전체 보기</Link>
        </Section>
      )}

      {admin && (
        <Section title="전체 현황">
          <div className="grid grid-cols-1 gap-3 @min-[48rem]:grid-cols-3">
            <Tile>프로젝트 {projects.length}개</Tile>
            <Tile>{userCount === null ? '사용자 -' : `사용자 ${userCount}명`}</Tile>
            <Tile>{runners === null ? '러너 -' : `러너 ${runners.running} / ${runners.total} 실행 중`}</Tile>
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {projects.map((p) => {
              const items = plans[p.projectId];
              return (
                <li key={p.projectId} className="grid grid-cols-[minmax(0,1fr)_200px_80px] items-center gap-4 px-5 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Link to={projectTabPath(p.projectId, 'dashboard')} className="truncate font-medium text-foreground hover:underline">
                      {p.projectName}
                    </Link>
                    <StatusAndPeriod project={p} />
                  </div>
                  <ProgressBar value={items ? progressOf(items) : 0} />
                  <span className="text-right text-sm text-muted-foreground">{items ? `${progressOf(items)}%` : '-'}</span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {pmProjects.length > 0 && (
        <Section title="내가 맡은 프로젝트">
          {pmProjects.map((p) => {
            const items = plans[p.projectId] ?? [];
            const late = overdue(items, today());
            return (
              <div key={p.projectId} className="space-y-4 rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Link to={projectTabPath(p.projectId, 'plan')} className="truncate text-[17px] font-bold text-foreground hover:underline">
                      {p.projectName}
                    </Link>
                    <StatusAndPeriod project={p} />
                  </div>
                  <span className="text-sm font-medium text-foreground">진척률 {progressOf(items)}%</span>
                </div>
                <ProgressBar value={progressOf(items)} />
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">아직 계획 항목이 없습니다. 계획 탭에서 테스트를 정해 주세요.</p>
                ) : (
                <div className="grid grid-cols-1 gap-4 @min-[56rem]:grid-cols-2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="py-1 font-medium">담당자</th>
                        <th className="py-1 text-right font-medium">성공 / 계획</th>
                        <th className="py-1 text-right font-medium">실패</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byAssignee(items).map((row) => (
                        <tr key={row.key} className="border-t border-border">
                          <td className="py-1.5 text-foreground">{row.assignee}</td>
                          <td className="py-1.5 text-right">{row.passed} / {row.total}</td>
                          <td className="py-1.5 text-right text-destructive">{row.failed || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div>
                    <p className="text-sm font-medium text-foreground">기한 지남 {late.length}건</p>
                    <ul className="mt-1 space-y-1 text-sm">
                      {late.slice(0, 5).map((i) => (
                        <li key={`${i.specPath}\n${i.grep}`} className="flex justify-between gap-3">
                          <span className="truncate text-foreground">{i.title}</span>
                          <span className="shrink-0 text-destructive">{i.dueDate} · {assigneeLabel(i) || '미지정'}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                )}
              </div>
            );
          })}
        </Section>
      )}

      {memberProjects.length > 0 && (
        <Section title="내 프로젝트">
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {memberProjects.map((p) => {
              const items = plans[p.projectId] ?? [];
              const counts = planCounts(items);
              return (
                <li key={p.projectId} className="flex items-center gap-4 px-5 py-3">
                  <Link to={projectTabPath(p.projectId, 'plan')} className="min-w-0 truncate font-medium text-foreground hover:underline">
                    {p.projectName}
                  </Link>
                  <span className="flex-1"><StatusAndPeriod project={p} /></span>
                  <span className="text-sm text-muted-foreground">
                    성공 {counts.passed} · 실패 {counts.failed} · 미수행 {counts.notRun}
                  </span>
                  {counts.failed > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`${p.projectName} 실패 ${counts.failed}건 다시 실행`}
                      disabled={rerunId === p.projectId || ['PENDING', 'RUNNING', 'CANCEL_REQUESTED'].includes(p.latestExecutionStatus ?? '')}
                      onClick={() => rerunFailed(p, items)}
                    >
                      {rerunId === p.projectId ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      실패 {counts.failed}건 다시 실행
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {mine.length > 0 && (
        <Section title="나에게 배정된 항목">
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {mine.map(({ project: p, item: i }) => (
              <li key={`${p.projectId}\n${i.specPath}\n${i.grep}`} className="flex items-center gap-4 px-5 py-3 text-sm">
                <Link to={projectTabPath(p.projectId, 'plan')} className="min-w-0 flex-1 truncate font-medium text-foreground hover:underline">
                  {p.projectName} · {i.title}
                </Link>
                {i.dueDate && <span className="shrink-0 text-muted-foreground">마감 {i.dueDate}</span>}
                <span className="shrink-0 text-muted-foreground">
                  {i.lastStatus === 'PASSED' ? '성공' : i.lastStatus === 'FAILED' ? '실패' : '미수행'}
                </span>
              </li>
            ))}
          </ul>
        </Section>
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
