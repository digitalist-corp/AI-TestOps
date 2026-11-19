import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCcw } from 'lucide-react';
import { api } from '@/api/client';
import type { AiJob, FailureCause, FailureCluster } from '@/types';
import { Button } from '@/components/ui/Button';
import { useAccess } from '@/lib/access';
import { useAiTaskEvents } from '@/hooks/useAiTaskEvents';
import { aiJobStatusLabel } from '@/lib/utils';

const CAUSE_LABEL: Record<FailureCause, string> = {
  PRODUCT_DEFECT: '제품 결함',
  SCRIPT_ERROR: '스크립트 오류',
  ENVIRONMENT: '환경',
  FLAKY: '불안정',
  UNCLASSIFIED: '미분류',
};

/**
 * 학습 루프 (E-06 ~ E-11 간이). 실패를 원인별로 묶어 보여 주고, 사람이 승인했던 비슷한 수정이 몇 건인지 알린다.
 * PM 이상은 "AI 루프로 고치기"로 분류 → 과거 수정 참고 → 격리 수정 → 승인 대기 → 재실행 루프를 시작한다.
 * 승인은 기존 AI 검토 카드에서 한다. ai-service(프로필 ai)가 꺼져 있으면 버튼 대신 안내를 보인다.
 */
export function AiLoopPanel({ projectId, executionId }: { projectId: string; executionId: number }) {
  const canManage = useAccess().canManage(projectId);
  const [clusters, setClusters] = useState<FailureCluster[]>([]);
  const [available, setAvailable] = useState(false);
  const [loop, setLoop] = useState<AiJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadLoop = useCallback(() => {
    api.aiJobs
      .listByProject(projectId)
      .then((jobs) => setLoop(jobs.find((j) => j.jobType === 'LEARNING_LOOP' && j.failedExecutionId === executionId) ?? null))
      .catch(() => {});
  }, [projectId, executionId]);

  useEffect(() => {
    api.failures.clusters(projectId, executionId).then(setClusters).catch(() => setClusters([]));
    api.aiLoop.status().then((s) => setAvailable(s.available)).catch(() => setAvailable(false));
    loadLoop();
  }, [projectId, executionId, loadLoop]);

  useAiTaskEvents((event) => {
    if (event.type === 'ready' || event.projectId === projectId) loadLoop();
  });

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      setLoop(await api.aiLoop.start(projectId, executionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 루프를 시작하지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  if (clusters.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1.5 min-w-0">
          {clusters.map((c) => (
            <div key={c.signature} className="flex items-center gap-2 flex-wrap text-sm">
              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-muted text-foreground">
                {CAUSE_LABEL[c.cause]}
              </span>
              <span className="text-foreground">{c.summary || c.head}</span>
              <span className="text-xs text-muted-foreground">{c.count}건</span>
              <span className="text-xs text-primary">과거 수정 {c.pastFixes}건 참고</span>
            </div>
          ))}
        </div>
        {canManage &&
          (available ? (
            <Button size="sm" onClick={start} disabled={busy || loop?.status === 'RUNNING'}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              AI 루프로 고치기
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              AI 루프 서비스가 꺼져 있어요 (프로필 ai). 켜면 여기서 분류 → 수정 → 승인 → 재실행을 한 번에 돌릴 수 있어요.
            </span>
          ))}
      </div>
      {loop && (
        <div className="rounded-md bg-muted/50 p-3 space-y-1">
          <p className="text-xs font-medium text-foreground">
            AI 루프 #{loop.id} · {aiJobStatusLabel[loop.status]}
            {loop.status === 'RUNNING' && ' — 수정안은 AI 검토 탭에서 승인해 주세요'}
          </p>
          {loop.summary && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{loop.summary}</p>}
          {loop.errorMessage && <p className="text-xs text-destructive">{loop.errorMessage}</p>}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
