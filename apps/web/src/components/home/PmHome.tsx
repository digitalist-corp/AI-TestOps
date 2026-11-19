import { Link } from 'react-router-dom';
import type { AiJob, PlanItem, Project } from '@/types';
import { projectTabPath } from '@/config/projectWorkspace';
import { assigneeLabel, byAssignee, overdue, planCounts } from '@/lib/plan';
import { OpenDefects, ProgressBar, Section, StatusAndPeriod, daysSince, progressOf, today } from './parts';

/** 승인 대기 n · 최장 n일. 3일 넘게 기다리면 강조 (설계 2-4) */
function waiting(jobs: AiJob[]) {
  const longest = Math.max(0, ...jobs.map((j) => daysSince(j.updatedAt) ?? 0));
  return { count: jobs.length, longest, label: jobs.length ? `승인 대기 ${jobs.length} · 최장 ${longest}일` : '승인 대기 0' };
}

function Chip({ to, label, alert }: { to?: string; label: string; alert?: boolean }) {
  const cls = `rounded-full border px-3 py-1 text-sm ${alert ? 'border-destructive/40 bg-destructive/10 font-medium text-destructive' : 'border-border bg-card text-foreground'}`;
  return to ? <Link to={to} className={`${cls} hover:underline`}>{label}</Link> : <span className={cls}>{label}</span>;
}

/**
 * PM 홈 (A7, 설계 4-2): 확인할 것 칩 줄 → 프로젝트 카드(위험순). 제목 · '진척률' 낱말은 시연 리허설이 본다.
 */
export function PmHome({ projects, plans, defects, needsReview, aiJobs }: {
  projects: Project[];
  plans: Record<string, PlanItem[]>;
  defects: Record<string, number>;
  /** 서버가 내 프로젝트로 거른 NEEDS_REVIEW 작업 */
  needsReview: AiJob[];
  aiJobs: Record<string, AiJob[]>;
}) {
  const day = today();
  const reviewOf = (pid: string) => needsReview.filter((j) => j.projectId === pid);
  const allReview = projects.flatMap((p) => reviewOf(p.projectId));
  const oldest = [...allReview].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
  const review = waiting(allReview);
  const lateCount = projects.reduce((n, p) => n + overdue(plans[p.projectId] ?? [], day).length, 0);
  const unassigned = projects.reduce((n, p) => n + (plans[p.projectId] ?? []).filter((i) => i.enabled && !assigneeLabel(i)).length, 0);
  // 위험순: 기한 지남 → 미해결 결함 → 진척률 낮은 순
  const sorted = [...projects].sort((a, b) => {
    const ia = plans[a.projectId] ?? [], ib = plans[b.projectId] ?? [];
    return overdue(ib, day).length - overdue(ia, day).length
      || (defects[b.projectId] ?? 0) - (defects[a.projectId] ?? 0)
      || progressOf(ia) - progressOf(ib);
  });

  return (
    <Section title="내가 맡은 프로젝트">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">확인할 것</span>
        <Chip label={review.label} alert={review.longest >= 3}
              to={projectTabPath(oldest?.projectId ?? sorted[0].projectId, 'ai-review')} />
        <Chip label={`기한 지남 ${lateCount}`} alert={lateCount > 0} />
        <Chip label={`담당자 없음 ${unassigned}`} alert={unassigned > 0} />
      </div>

      {sorted.map((p) => {
        const items = plans[p.projectId] ?? [];
        const late = overdue(items, day);
        const counts = planCounts(items);
        const pReview = waiting(reviewOf(p.projectId));
        const jobs = aiJobs[p.projectId] ?? [];
        const healed = jobs.filter((j) => j.status === 'APPLIED' && j.postApplyVerificationStatus === 'PASSED').length;
        const reverted = jobs.filter((j) => j.revertedAt).length;
        return (
          <div key={p.projectId} className="space-y-4 rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <Link to={projectTabPath(p.projectId, 'plan')} className="truncate text-[17px] font-bold text-foreground hover:underline">
                  {p.projectName}
                </Link>
                <StatusAndPeriod project={p} />
              </div>
              <span className="flex shrink-0 items-center gap-4">
                <OpenDefects projectId={p.projectId} count={defects[p.projectId]} />
                <span className="text-sm font-medium text-foreground">진척률 {progressOf(items)}%</span>
              </span>
            </div>
            <ProgressBar value={progressOf(items)} />
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">아직 계획 항목이 없습니다. 계획 탭에서 테스트를 정해 주세요.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">통과 {counts.passed} · 실패 {counts.failed} · 미수행 {counts.notRun}</p>
                <div className="grid grid-cols-1 gap-4 @min-[56rem]:grid-cols-2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="py-1 font-medium">담당자</th>
                        <th className="py-1 text-right font-medium">배정</th>
                        <th className="py-1 text-right font-medium">통과</th>
                        <th className="py-1 text-right font-medium">실패</th>
                        <th className="py-1 text-right font-medium">미수행</th>
                        <th className="py-1 text-right font-medium">진척률</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byAssignee(items).map((row) => (
                        <tr key={row.key} className="border-t border-border">
                          <td className="py-1.5 text-foreground">{row.assignee}</td>
                          <td className="py-1.5 text-right">{row.total}</td>
                          <td className="py-1.5 text-right">{row.passed}</td>
                          <td className="py-1.5 text-right text-destructive">{row.failed || ''}</td>
                          <td className="py-1.5 text-right">{row.notRun || ''}</td>
                          <td className="py-1.5 text-right">{row.rate}%</td>
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
              </>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-sm text-muted-foreground">
              <span className="font-semibold text-primary">AI</span>
              <Link to={projectTabPath(p.projectId, 'ai-review')} className={`hover:underline ${pReview.longest >= 3 ? 'font-medium text-destructive' : ''}`}>
                {pReview.label} · 검토 →
              </Link>
              <span>치유됨 {healed} · 되돌림 {reverted}</span>
            </div>
          </div>
        );
      })}
    </Section>
  );
}
