import { Link } from 'react-router-dom';
import type { AiJob, AiUsageSummary, AppNotification, PlanItem, Project, RunnerContainer, User } from '@/types';
import { projectTabPath } from '@/config/projectWorkspace';
import { planCounts } from '@/lib/plan';
import { formatRelative, projectStatusLabel } from '@/lib/utils';
import { OpenDefects, Section, StatusAndPeriod, VerdictBar, daysSince, progressOf } from './parts';

type Check = { level: 0 | 1 | 2; text: string; to: string };
const LEVEL = [
  { mark: '●', word: '긴급', className: 'text-destructive' },
  { mark: '▲', word: '주의', className: 'text-warning' },
  { mark: '■', word: '알림', className: 'text-muted-foreground' },
];
const MAX_CHECKS = 5;

function Kpi({ label, value, sub, alert }: { label: string; value: string; sub?: string; alert?: boolean }) {
  return (
    <div role="group" aria-label={`${label}: ${value}`} className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={`text-[19px] font-bold ${alert ? 'text-destructive' : 'text-foreground'}`}>{value}</p>
      {sub && <p className="text-[12px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/**
 * 관리자 홈 (A6, 설계 4-1): 확인 필요 → KPI 6칸 → 프로젝트 표(위험순) → 사용자 · 러너.
 * 보기 전용이다. 행을 누르면 각 관리 화면으로 간다. 'PM 없음' 규칙은 프로젝트마다 멤버를 불러야 해서 뺐다.
 */
export function AdminHome({ projects, plans, defects, needsReview, users, runners, usage, notifications }: {
  projects: Project[];
  plans: Record<string, PlanItem[]>;
  defects: Record<string, number>;
  needsReview: AiJob[];
  users: User[] | null;
  runners: RunnerContainer[] | null;
  usage: AiUsageSummary | null;
  notifications: AppNotification[];
}) {
  const nameOf = (pid: string) => projects.find((p) => p.projectId === pid)?.projectName ?? pid;
  const own = (runners ?? []).filter((c) => c.containerType === 'RUNNER');
  const runnerErrors = own.filter((c) => c.dockerStatus === 'ERROR');
  const notRun = projects.reduce((n, p) => n + planCounts(plans[p.projectId] ?? []).notRun, 0);
  const openDefects = projects.reduce((n, p) => n + (defects[p.projectId] ?? 0), 0);
  const longest = Math.max(0, ...needsReview.map((j) => daysSince(j.updatedAt) ?? 0));
  const byStatus = (s: Project['status']) => projects.filter((p) => (p.status ?? 'PLANNED') === s).length;

  const checks: Check[] = [
    ...runnerErrors.map((c) => ({ level: 0 as const, text: `러너 오류 · ${c.projectId} 러너가 ${c.dockerStatus}`, to: '/runners' })),
    ...(runners ?? []).filter((c) => c.removable && !c.knownProject)
      .map((c) => ({ level: 1 as const, text: `고아 러너 · ${c.name}`, to: '/runners' })),
    ...projects.filter((p) => p.latestExecutionStatus === 'ERROR')
      .map((p) => ({ level: 1 as const, text: `실행 오류 · ${p.projectName}`, to: projectTabPath(p.projectId, 'runs') })),
    ...projects.filter((p) => (p.status ?? 'PLANNED') === 'PLANNED' && p.latestExecutionAt)
      .map((p) => ({ level: 1 as const, text: `상태 불일치 · ${p.projectName}는 '계획'인데 실행 기록이 있음`, to: projectTabPath(p.projectId, 'settings') })),
    ...needsReview.filter((j) => (daysSince(j.updatedAt) ?? 0) >= 3)
      .map((j) => ({ level: 1 as const, text: `승인 정체 · ${nameOf(j.projectId)} #${j.id} (${daysSince(j.updatedAt)}일)`, to: projectTabPath(j.projectId, 'ai-review') })),
    ...notifications.filter((n) => n.kind === 'SCHEDULE_FAILED')
      .map((n) => ({ level: 2 as const, text: `예약 실행 실패 · ${n.message}`, to: n.link ?? '/notices' })),
    ...(usage && !usage.priceConfigured && usage.totalCalls > 0
      ? [{ level: 2 as const, text: 'AI 단가 미설정 · 비용을 계산할 수 없음', to: '/ai-settings' }] : []),
  ].sort((a, b) => a.level - b.level);

  // 위험순: 미해결 결함 → 진척률 낮은 순
  const sorted = [...projects].sort((a, b) =>
    (defects[b.projectId] ?? 0) - (defects[a.projectId] ?? 0) || progressOf(plans[a.projectId] ?? []) - progressOf(plans[b.projectId] ?? []));

  return (
    <Section title="전체 현황">
      {checks.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <p className="border-b border-border px-4 py-2 text-sm font-semibold text-foreground">확인 필요</p>
          <ul className="divide-y divide-border">
            {checks.slice(0, MAX_CHECKS).map((c) => (
              <li key={c.text} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className={`shrink-0 font-medium ${LEVEL[c.level].className}`}>{LEVEL[c.level].mark} {LEVEL[c.level].word}</span>
                <span className="min-w-0 flex-1 truncate text-foreground">{c.text}</span>
                <Link to={c.to} className="shrink-0 text-muted-foreground hover:underline">보기 →</Link>
              </li>
            ))}
          </ul>
          {checks.length > MAX_CHECKS && <p className="px-4 py-2 text-[13px] text-muted-foreground">외 {checks.length - MAX_CHECKS}건</p>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 @min-[48rem]:grid-cols-3 @min-[72rem]:grid-cols-6">
        <Kpi label="프로젝트" value={`${projects.length}`}
             sub={`${projectStatusLabel.RUNNING} ${byStatus('RUNNING')} · ${projectStatusLabel.PLANNED} ${byStatus('PLANNED')} · ${projectStatusLabel.CLOSED} ${byStatus('CLOSED')}`} />
        <Kpi label="미수행" value={`${notRun}건`} />
        <Kpi label="미해결 결함" value={`${openDefects}`} alert={openDefects > 0} />
        <Kpi label="승인 대기" value={needsReview.length ? `${needsReview.length} · 최장 ${longest}일` : '0'} alert={longest >= 3} />
        <Kpi label="러너" alert={runnerErrors.length > 0}
             value={runners === null ? '-' : `${own.filter((c) => c.dockerStatus === 'RUNNING').length}/${own.length} 실행 중${runnerErrors.length ? ` · 오류 ${runnerErrors.length}` : ''}`} />
        <Kpi label="AI 비용(30일)"
             value={!usage ? '-' : usage.priceConfigured ? `$${usage.estimatedCostUsd.toFixed(2)} · 호출 ${usage.totalCalls}` : `단가 미설정 · 호출 ${usage.totalCalls}`} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">프로젝트</th>
              <th className="px-4 py-2 font-medium">상태 · 기간</th>
              <th className="px-4 py-2 font-medium">판정 분포</th>
              <th className="px-4 py-2 text-right font-medium">완료율</th>
              <th className="px-4 py-2 font-medium">결함</th>
              <th className="px-4 py-2 text-right font-medium">승인 대기</th>
              <th className="px-4 py-2 font-medium">최근 실행</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const items = plans[p.projectId];
              const review = needsReview.filter((j) => j.projectId === p.projectId).length;
              return (
                <tr key={p.projectId} className="border-t border-border">
                  <td className="px-4 py-2">
                    <Link to={projectTabPath(p.projectId, 'dashboard')} className="font-medium text-foreground hover:underline">{p.projectName}</Link>
                  </td>
                  <td className="px-4 py-2"><StatusAndPeriod project={p} /></td>
                  <td className="px-4 py-2">{items ? <VerdictBar items={items} /> : '-'}</td>
                  <td className="px-4 py-2 text-right">{items ? `${progressOf(items)}%` : '-'}</td>
                  <td className="px-4 py-2"><OpenDefects projectId={p.projectId} count={defects[p.projectId]} /></td>
                  <td className="px-4 py-2 text-right">{review || ''}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {p.latestExecutionId ? `#${p.latestExecutionId} · ${formatRelative(p.latestExecutionAt ?? '')}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-4 @min-[64rem]:grid-cols-2">
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <p className="border-b border-border px-4 py-2 text-sm font-semibold text-foreground">사용자</p>
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr><th className="px-4 py-2 font-medium">이름</th><th className="px-4 py-2 font-medium">역할</th><th className="px-4 py-2 font-medium">최근 로그인</th></tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => {
                const idle = daysSince(u.lastLoginAt);
                return (
                  <tr key={u.id} className="border-t border-border">
                    <td className="px-4 py-2 text-foreground">{u.displayName || u.username}</td>
                    <td className="px-4 py-2 text-muted-foreground">{u.role === 'ADMIN' ? '관리자' : '팀원'}</td>
                    <td className={`px-4 py-2 ${idle === null || idle > 30 ? 'text-warning' : 'text-muted-foreground'}`}>
                      {idle === null ? '▲ 기록 없음' : idle > 30 ? `▲ ${idle}일 전` : formatRelative(u.lastLoginAt ?? '')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <p className="border-b border-border px-4 py-2 text-sm font-semibold text-foreground">러너</p>
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr><th className="px-4 py-2 font-medium">프로젝트</th><th className="px-4 py-2 font-medium">상태</th></tr>
            </thead>
            <tbody>
              {own.map((c) => (
                <tr key={c.name} className="border-t border-border">
                  <td className="px-4 py-2 text-foreground">{nameOf(c.projectId)}</td>
                  <td className={`px-4 py-2 ${c.dockerStatus === 'ERROR' ? 'text-destructive' : 'text-muted-foreground'}`}>{c.dockerStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}
