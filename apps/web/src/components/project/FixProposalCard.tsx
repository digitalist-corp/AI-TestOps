import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Wrench, XCircle } from 'lucide-react';
import { api } from '@/api/client';
import type { AiJob } from '@/types';
import { Button } from '@/components/ui/Button';
import { useAiEnabled } from '@/lib/aiEnabled';
import { notifyAiJobChanged, useAiTaskEvents } from '@/hooks/useAiTaskEvents';
import { useAccess } from '@/lib/access';

/**
 * 실패한 실행에서 자동으로 만든 수정 제안 카드. (FR-25)
 *
 * 묻기만 한다 — 진행을 눌러야 AI 수정이 돌고, 그 결과도 AI 검토에서 승인해야 반영된다.
 * AI를 꺼도 카드는 보인다. 고칠 방법을 읽고 직접 고치거나 닫을 수 있다.
 */
export function FixProposals({ projectId, executionId }: { projectId: string; executionId: number }) {
  // 진행 · 닫기는 PM (서버가 막는 쓰기). 팀원은 제안 내용만 본다.
  const canManage = useAccess().canManage(projectId);
  const [proposals, setProposals] = useState<AiJob[]>([]);

  // 이 실행에서 자동으로 만든 제안은 진행한 뒤에도 남겨 진행 중 → 끝 상태를 같은 자리에서 보여 준다.
  // 닫은 것(CANCELED) · 학습 루프가 띄운 수정(parentJobId)은 뺀다. autoCreated 가 없는 예전 응답도 PROPOSED 는 보인다.
  const load = useCallback(() => {
    api.aiJobs
      .listByProject(projectId)
      .then((jobs) =>
        setProposals(
          jobs.filter(
            (j) =>
              j.failedExecutionId === executionId &&
              (j.status === 'PROPOSED' || (j.autoCreated && j.parentJobId == null && j.status !== 'CANCELED'))
          )
        )
      )
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
        <FixProposalCard key={job.id} job={job} canManage={canManage} />
      ))}
    </div>
  );
}

/** canManage: 진행 · 닫기 버튼(PM). 팀원은 제안 내용만 */
export function FixProposalCard({ job, canManage }: { job: AiJob; canManage: boolean }) {
  const { active: aiActive } = useAiEnabled();
  const [busy, setBusy] = useState<'proceed' | 'dismiss' | null>(null);
  // 서버가 돌려준 진행 · 닫기 결과. 목록이 아직 PROPOSED 로 남아 있는 동안만 쓰고, 목록이 다시 읽히면 그쪽 상태를 따른다.
  const [decided, setDecided] = useState<AiJob | null>(null);
  const [error, setError] = useState('');
  const current = decided && job.status === 'PROPOSED' ? decided : job;
  const status = current.status;

  const decide = async (action: 'proceed' | 'dismiss') => {
    setBusy(action);
    setError('');
    try {
      const next = await (action === 'proceed' ? api.aiJobs.proceed(job.id) : api.aiJobs.dismiss(job.id));
      setDecided(next);
      notifyAiJobChanged(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리하지 못했어요.');
    } finally {
      setBusy(null);
    }
  };

  if (status === 'CANCELED') return null;
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <Wrench className="h-4 w-4 mt-0.5 text-primary shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-foreground">{status === 'PROPOSED' ? '이렇게 고칠까요?' : '수정 요청'}</p>
          {!current.revertedAt && job.summary && <p className="text-sm text-muted-foreground">{job.summary}</p>}
          <p className="text-sm text-foreground">{job.instruction}</p>
          {job.targetSpecPath && <p className="text-xs font-mono text-muted-foreground truncate">{job.targetSpecPath}</p>}
          {status !== 'PROPOSED' ? (
            <ProceededStatus job={current} />
          ) : !canManage ? null : (
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

/** 진행한 뒤의 상태. 완료는 서버가 반영(APPLIED)했다고 알려 준 뒤에만 보인다. */
function ProceededStatus({ job }: { job: AiJob }) {
  if (job.status === 'APPLIED' && job.revertedAt) {
    return (
      <div className="space-y-0.5 pt-1">
        <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
          <XCircle className="h-4 w-4" /> 사후 검증에서 문제가 발견됐어요. 되돌림 결과를 확인해 주세요.
        </p>
        {job.summary && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{job.summary}</p>}
      </div>
    );
  }
  if (job.status === 'APPLIED') {
    return (
      <p className="flex items-center gap-1.5 pt-1 text-sm font-medium text-success">
        <CheckCircle2 className="h-4 w-4" /> 수정 완료 — 파일에 반영했어요.
      </p>
    );
  }
  if (job.status === 'NEEDS_REVIEW') {
    return <p className="pt-1 text-sm text-warning">AI 수정이 끝났어요. AI 검토 탭에서 확인하고 승인하면 반영돼요.</p>;
  }
  if (job.status === 'PENDING' || job.status === 'RUNNING' || job.status === 'DIFF_READY') {
    return (
      <p className="flex items-center gap-1.5 pt-1 text-sm text-primary">
        <Loader2 className="h-4 w-4 animate-spin" /> AI가 고치는 중이에요.
      </p>
    );
  }
  return (
    <div className="space-y-0.5 pt-1">
      <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
        <XCircle className="h-4 w-4" /> {job.status === 'REJECTED' ? '수정을 거부했어요.' : '수정하지 못했어요.'}
      </p>
      {job.errorMessage && <p className="text-xs text-destructive">{job.errorMessage}</p>}
    </div>
  );
}
