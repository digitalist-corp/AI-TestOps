import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Play, RotateCcw } from 'lucide-react';
import type { PlanItem, Project } from '@/types';
import { Button } from '@/components/ui/Button';
import { projectTabPath } from '@/config/projectWorkspace';
import { PRIORITY_LABEL, myTodo, planCounts, todoSummary } from '@/lib/plan';
import { formatRelative } from '@/lib/utils';
import { OpenDefects, Section, StatusAndPeriod, progressOf, today, verdictLabel } from './parts';

const RUNNING = ['PENDING', 'RUNNING', 'CANCEL_REQUESTED'];
const busy = (p: Project) => RUNNING.includes(p.latestExecutionStatus ?? '');

type Row = { project: Project; item: PlanItem };

/**
 * 팀원 홈 (A8, 설계 4-3): '내 할 일' — 내 배정 → 한 번에 실행 · 다시 실행 · 결과로.
 * 판정을 고치는 일은 계획(런) 표에서 한다. 홈은 보고 · 실행만.
 */
export function MemberHome({ projects, plans, defects, userId, onRunCase, onRerunCase, onRerunFailed, busyKey }: {
  projects: Project[];
  plans: Record<string, PlanItem[]>;
  defects: Record<string, number>;
  userId: number;
  onRunCase: (project: Project, item: PlanItem) => void;
  onRerunCase: (project: Project, item: PlanItem) => void;
  onRerunFailed: (project: Project, items: PlanItem[]) => void;
  /** 지금 요청 중인 행(`${projectId}\n${specPath}\n${grep}`) 또는 프로젝트 id */
  busyKey: string | null;
}) {
  const [showPassed, setShowPassed] = useState(false);
  const day = today();
  const todo: Row[] = projects.flatMap((p) => myTodo(plans[p.projectId] ?? [], userId, day).map((item) => ({ project: p, item })));
  const summary = todoSummary(todo.map((r) => r.item), day);
  const passedCount = todo.length - summary.remaining;
  const shown = showPassed ? todo : todo.filter((r) => r.item.lastStatus !== 'PASSED');

  return (
    <>
      <Section
        title="내 할 일"
        aside={<span className="text-sm text-muted-foreground">
          배정 {summary.assigned} · 남음 {summary.remaining} · 오늘 마감 {summary.dueToday} · 기한 지남 {summary.overdue} · 실패 {summary.failed}
        </span>}
      >
        {todo.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card px-5 py-6 text-sm text-muted-foreground">
            나에게 배정된 항목이 없습니다. PM이 계획 표에서 담당자를 정하면 여기에 보여요.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">프로젝트</th>
                  <th className="px-4 py-2 font-medium">케이스명</th>
                  <th className="px-4 py-2 font-medium">판정</th>
                  <th className="px-4 py-2 font-medium">마감</th>
                  <th className="px-4 py-2 font-medium">우선순위</th>
                  <th className="px-4 py-2 font-medium">최근 실행</th>
                  <th className="px-4 py-2 text-right font-medium">동작</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ project: p, item: i }) => {
                  const key = `${p.projectId}\n${i.specPath}\n${i.grep}`;
                  const late = i.lastStatus !== 'PASSED' && i.dueDate && i.dueDate < day;
                  const due = !i.dueDate ? '—' : late ? `${i.dueDate} 지남` : i.dueDate === day ? '오늘' : i.dueDate;
                  const locked = busy(p) || busyKey === key;
                  return (
                    <tr key={key} className="border-t border-border">
                      <td className="px-4 py-2 text-muted-foreground">{p.projectName}</td>
                      <td className="px-4 py-2">
                        <Link to={projectTabPath(p.projectId, 'plan')} className="font-medium text-foreground hover:underline">{i.title}</Link>
                      </td>
                      <td className={`px-4 py-2 ${i.lastStatus === 'FAILED' ? 'text-destructive' : i.lastStatus === 'PASSED' ? 'text-success' : 'text-muted-foreground'}`}>
                        {verdictLabel(i.lastStatus)}{i.lastStatus && <span className="ml-1 text-[12px] text-muted-foreground">· 자동</span>}
                      </td>
                      <td className={`px-4 py-2 ${late ? 'text-destructive' : 'text-muted-foreground'}`}>{due}</td>
                      <td className="px-4 py-2 text-muted-foreground">{i.priority ? PRIORITY_LABEL[i.priority] : '—'}</td>
                      <td className="px-4 py-2 text-muted-foreground">{i.lastRunAt ? formatRelative(i.lastRunAt) : '—'}</td>
                      <td className="px-4 py-2 text-right">
                        {i.lastStatus === 'FAILED' ? (
                          <Button size="sm" variant="outline" aria-label={`${p.projectName} ${i.title} 다시 실행`} disabled={locked}
                                  onClick={() => onRerunCase(p, i)}>
                            {busyKey === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                            다시 실행
                          </Button>
                        ) : i.lastStatus !== 'PASSED' && (
                          <Button size="sm" variant="outline" aria-label={`${p.projectName} ${i.title} 실행`} disabled={locked}
                                  onClick={() => onRunCase(p, i)}>
                            {busyKey === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                            실행
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {passedCount > 0 && (
              <button type="button" className="w-full border-t border-border px-4 py-2 text-left text-sm text-muted-foreground hover:bg-muted"
                      onClick={() => setShowPassed((v) => !v)}>
                {showPassed ? '통과 항목 접기' : `통과 ${passedCount}건 보기`}
              </button>
            )}
          </div>
        )}
      </Section>

      <Section title="내 프로젝트">
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {projects.map((p) => {
            const items = plans[p.projectId] ?? [];
            const counts = planCounts(items);
            return (
              <li key={p.projectId} className="flex flex-wrap items-center gap-4 px-5 py-3">
                <Link to={projectTabPath(p.projectId, 'plan')} className="min-w-0 truncate font-medium text-foreground hover:underline">
                  {p.projectName}
                </Link>
                <span className="flex-1"><StatusAndPeriod project={p} /></span>
                <span className="text-sm text-muted-foreground">통과 {counts.passed} · 실패 {counts.failed} · 미수행 {counts.notRun}</span>
                <span className="text-sm text-muted-foreground">완료율 {progressOf(items)}%</span>
                <OpenDefects projectId={p.projectId} count={defects[p.projectId]} />
                {counts.failed > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`${p.projectName} 실패 ${counts.failed}건 다시 실행`}
                    disabled={busyKey === p.projectId || busy(p)}
                    onClick={() => onRerunFailed(p, items)}
                  >
                    {busyKey === p.projectId ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    실패 {counts.failed}건 다시 실행
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}
