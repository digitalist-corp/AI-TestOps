import { Link } from 'react-router-dom';
import type { PlanItem, Project } from '@/types';
import { ProjectStatusChip, projectPeriod } from '@/components/project/ProjectCard';
import { projectTabPath } from '@/config/projectWorkspace';
import { planCounts } from '@/lib/plan';

export const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD (현지 날짜)

/** 진척률 = 통과 ÷ 사용 중 계획 항목. 표준(실행 ÷ 계획)으로 바꾸는 것은 시연 뒤 (설계 2-4) */
export function progressOf(items: PlanItem[]) {
  const enabled = items.filter((i) => i.enabled).length;
  return enabled === 0 ? 0 : Math.round((planCounts(items).passed / enabled) * 100);
}

/** 지금부터 며칠 전인지 (내림) */
export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  return iso ? Math.floor((now - new Date(iso).getTime()) / 86_400_000) : null;
}

/** 판정 표기 — 지금 데이터는 3값 (설계 2-2) */
export function verdictLabel(status: PlanItem['lastStatus']) {
  return status === 'PASSED' ? '통과' : status === 'FAILED' ? '실패' : '미수행';
}

export function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-[19px] font-bold text-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** 상태 배지 + 기간 (#117) */
export function StatusAndPeriod({ project }: { project: Project }) {
  return (
    <span className="flex shrink-0 items-center gap-2 text-[13px] text-muted-foreground">
      <ProjectStatusChip status={project.status ?? 'PLANNED'} />
      {projectPeriod(project) && <span>{projectPeriod(project)}</span>}
    </span>
  );
}

/** 미해결 결함 수 — 결함 리스트와 같은 API (#81). 누르면 결함 탭 */
export function OpenDefects({ projectId, count }: { projectId: string; count: number | undefined }) {
  if (count === undefined) return null;
  return (
    <Link
      to={projectTabPath(projectId, 'defects')}
      className={`shrink-0 text-sm hover:underline ${count > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}`}
    >
      미해결 결함 {count}
    </Link>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-primary" style={{ width: `${value}%` }} />
    </div>
  );
}

/** 판정 분포 막대: 통과 · 실패 · 미수행 (ag-grid 없이 div) */
export function VerdictBar({ items }: { items: PlanItem[] }) {
  const { passed, failed, notRun } = planCounts(items);
  const total = passed + failed + notRun;
  const part = (n: number, className: string) => n > 0 && <div className={className} style={{ width: `${(n / total) * 100}%` }} />;
  return (
    <span className="flex items-center gap-2" title={`통과 ${passed} · 실패 ${failed} · 미수행 ${notRun}`}>
      <span className="flex h-2 w-20 overflow-hidden rounded-full bg-muted">
        {total > 0 && <>{part(passed, 'bg-success')}{part(failed, 'bg-destructive')}{part(notRun, 'bg-muted-foreground/30')}</>}
      </span>
      <span className="text-[13px] text-muted-foreground">{passed}·{failed}·{notRun}</span>
    </span>
  );
}
