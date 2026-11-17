import { useCallback, useEffect, useState } from 'react';
import { Loader2, Wrench } from 'lucide-react';
import { api } from '@/api/client';
import type { AiJob } from '@/types';
import { Button } from '@/components/ui/Button';
import { useAiEnabled } from '@/lib/aiEnabled';
import { useAiTaskEvents } from '@/hooks/useAiTaskEvents';

/**
 * 실패한 실행에서 자동으로 만든 수정 제안 카드. (FR-25)
 *
 * 묻기만 한다 — 진행을 눌러야 AI 수정이 돌고, 그 결과도 AI 검토에서 승인해야 반영된다.
 * AI를 꺼도 카드는 보인다. 고칠 방법을 읽고 직접 고치거나 닫을 수 있다.
 */
export function FixProposals({ projectId, executionId }: { projectId: string; executionId: number }) {
  const [proposals, setProposals] = useState<AiJob[]>([]);

  const load = useCallback(() => {
    api.aiJobs
      .listByProject(projectId)
      .then((jobs) => setProposals(jobs.filter((j) => j.status === 'PROPOSED' && j.failedExecutionId === executionId)))
      .catch(() => {});
  }, [projectId, executionId]);

  useEffect(load, [load]);

  // 실행이 끝난 뒤 제안이 조금 늦게 만들어져도 새로고침 없이 나타난다.
  useAiTaskEvents((event) => {
    if (event.type === 'ready' || event.projectId === projectId) load();
  });

  if (proposals.length === 0) return null;
  return (
    <div className="space-y-2">
      {proposals.map((job) => (
        <FixProposalCard key={job.id} job={job} />
      ))}
    </div>
  );
}

export function FixProposalCard({ job }: { job: AiJob }) {
  const { active: aiActive } = useAiEnabled();
  const [busy, setBusy] = useState<'proceed' | 'dismiss' | null>(null);
  const [done, setDone] = useState<'proceeded' | 'dismissed' | null>(null);
  const [error, setError] = useState('');

  const decide = async (action: 'proceed' | 'dismiss') => {
    setBusy(action);
    setError('');
    try {
      await (action === 'proceed' ? api.aiJobs.proceed(job.id) : api.aiJobs.dismiss(job.id));
      setDone(action === 'proceed' ? 'proceeded' : 'dismissed');
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리하지 못했어요.');
    } finally {
      setBusy(null);
    }
  };

  if (done === 'dismissed') return null;
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <Wrench className="h-4 w-4 mt-0.5 text-primary shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-foreground">이렇게 고칠까요?</p>
          {job.summary && <p className="text-sm text-muted-foreground">{job.summary}</p>}
          <p className="text-sm text-foreground">{job.instruction}</p>
          {job.targetSpecPath && <p className="text-xs font-mono text-muted-foreground truncate">{job.targetSpecPath}</p>}
          {done === 'proceeded' ? (
            <p className="text-sm text-primary pt-1">AI가 고치기 시작했어요. 끝나면 AI 검토 탭에서 확인하고 승인해 주세요.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {aiActive && (
                <Button size="sm" onClick={() => decide('proceed')} disabled={busy !== null}>
                  {busy === 'proceed' && <Loader2 className="h-4 w-4 animate-spin" />}
                  진행
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => decide('dismiss')} disabled={busy !== null}>
                {busy === 'dismiss' && <Loader2 className="h-4 w-4 animate-spin" />}
                닫기
              </Button>
              {!aiActive && (
                <span className="text-xs text-muted-foreground">AI를 켜면 이 방법대로 자동으로 고쳐 볼 수 있어요.</span>
              )}
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}
