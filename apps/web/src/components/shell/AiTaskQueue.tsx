import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, Inbox, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import type { AiJob, AiJobStatus } from '@/types';
import { FixProposalCard } from '@/components/project/FixProposalCard';
import { useAiTaskEvents } from '@/hooks/useAiTaskEvents';
import { cn } from '@/lib/utils';

const WORKING: AiJobStatus[] = ['PENDING', 'RUNNING', 'DIFF_READY'];
const DONE_LABEL: Partial<Record<AiJobStatus, string>> = {
  APPLIED: '적용됨',
  REJECTED: '거부됨',
  FAILED: '실패',
  ERROR: '오류',
  CANCELED: '닫음',
  TIMEOUT: '시간 초과',
};
const RECENT_DONE = 5;

/**
 * AI Task 큐. (D-04)
 * 대화와 상관없이 생긴 작업을 "할 일 · 진행 중 · 최근 끝남"으로 보여 준다. 작업이 바뀌면 SSE 로 바로 다시 읽는다.
 * 프로젝트 밖에서는 모든 프로젝트의 검토 대기만 보여 준다.
 */
export function AiTaskQueue({ projectId }: { projectId?: string }) {
  const [jobs, setJobs] = useState<AiJob[] | null>(null);

  const load = useCallback(async () => {
    try {
      setJobs(await (projectId ? api.aiJobs.listByProject(projectId) : api.aiJobs.needsReview()));
    } catch {
      setJobs((prev) => prev ?? []);
    }
  }, [projectId]);

  useEffect(() => {
    setJobs(null);
    void load();
  }, [load]);

  useAiTaskEvents((event) => {
    if (event.type === 'ready' || !projectId || event.projectId === projectId) void load();
  });

  if (jobs === null) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-ai-accent" />
        <span>작업을 불러오는 중...</span>
      </div>
    );
  }

  const todo = jobs.filter((j) => j.status === 'PROPOSED' || j.status === 'NEEDS_REVIEW');
  const working = jobs.filter((j) => WORKING.includes(j.status));
  const done = jobs.filter((j) => DONE_LABEL[j.status]).slice(0, RECENT_DONE);

  if (todo.length === 0 && working.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-muted-foreground">
          <Inbox className="h-7 w-7 text-ai-accent/60" />
          <p className="text-[13px]">지금 처리할 AI 작업이 없습니다</p>
          <p className="text-[12px]">테스트가 실패하면 AI가 고칠 방법을 여기에 먼저 올립니다.</p>
        </div>
        <DoneList jobs={done} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {todo.length > 0 && (
        <Section title={`할 일 ${todo.length}`}>
          {todo.map((job) =>
            job.status === 'PROPOSED' ? <FixProposalCard key={job.id} job={job} /> : <ReviewCard key={job.id} job={job} />
          )}
        </Section>
      )}
      {working.length > 0 && (
        <Section title={`진행 중 ${working.length}`}>
          {working.map((job) => (
            <Row key={job.id} job={job} label="AI가 작업 중" spinning />
          ))}
        </Section>
      )}
      <DoneList jobs={done} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

function DoneList({ jobs }: { jobs: AiJob[] }) {
  if (jobs.length === 0) return null;
  return (
    <Section title="최근 끝남">
      {jobs.map((job) => (
        <Row key={job.id} job={job} label={DONE_LABEL[job.status] ?? job.status} />
      ))}
    </Section>
  );
}

function ReviewCard({ job }: { job: AiJob }) {
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
      <div className="flex items-start gap-2.5">
        <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[13px] font-medium text-foreground">AI 수정이 끝났어요. 바뀐 내용을 보고 승인해 주세요.</p>
          <p className="text-[13px] text-foreground">{job.instruction}</p>
          {job.targetSpecPath && <p className="truncate font-mono text-[11px] text-muted-foreground">{job.targetSpecPath}</p>}
          <Link
            to={`/projects/${job.projectId}/ai-review`}
            className="inline-block pt-1 text-[12px] font-semibold text-ai-accent hover:underline"
          >
            검토하러 가기
          </Link>
        </div>
      </div>
    </div>
  );
}

function Row({ job, label, spinning }: { job: AiJob; label: string; spinning?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-[12px]">
      {spinning && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ai-accent" />}
      <span className="min-w-0 flex-1 truncate text-foreground" title={job.instruction}>
        {job.instruction}
      </span>
      <span className={cn('shrink-0 text-muted-foreground', spinning && 'text-ai-accent')}>{label}</span>
    </div>
  );
}
