import { useCallback, useEffect, useState } from 'react';
import { Check, FileCode2, Loader2, RefreshCw, X } from 'lucide-react';
import { api } from '@/api/client';
import type { AiJob, AiJobFileDiff } from '@/types';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

const statusLabel: Record<AiJob['status'], string> = {
  PENDING: '대기 중',
  RUNNING: '실행 중',
  DIFF_READY: '결과 처리 중',
  NEEDS_REVIEW: '검토 대기',
  APPLIED: '적용됨',
  REJECTED: '거부됨',
  FAILED: '실패',
  ERROR: '오류',
  CANCELED: '취소됨',
  TIMEOUT: '시간 초과',
};

const statusBadgeClass: Record<AiJob['status'], string> = {
  PENDING: 'bg-muted text-muted-foreground',
  RUNNING: 'bg-primary/15 text-primary',
  DIFF_READY: 'bg-warning/15 text-warning',
  NEEDS_REVIEW: 'bg-warning/15 text-warning',
  APPLIED: 'bg-success/15 text-success',
  REJECTED: 'bg-destructive/15 text-destructive',
  FAILED: 'bg-destructive/15 text-destructive',
  ERROR: 'bg-destructive/15 text-destructive',
  CANCELED: 'bg-muted text-muted-foreground',
  TIMEOUT: 'bg-destructive/15 text-destructive',
};

function JobCard({
  job,
  onDecided,
}: {
  job: AiJob;
  onDecided: () => void;
}) {
  const [files, setFiles] = useState<AiJobFileDiff[] | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');

  const toggleDiff = async () => {
    if (files !== null) {
      setFiles(null);
      return;
    }
    setLoadingDiff(true);
    setError('');
    try {
      const res = await api.aiJobs.diff(job.id);
      setFiles(res);
      setSelectedIdx(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'diff 조회 실패');
    } finally {
      setLoadingDiff(false);
    }
  };

  const handleApprove = async () => {
    if (!confirm(`이 변경을 ${job.targetSpecPath}에 적용할까요?`)) return;
    setActing(true);
    setError('');
    try {
      await api.aiJobs.approve(job.id);
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : '승인 실패');
    } finally {
      setActing(false);
    }
  };

  const handleReject = async () => {
    setActing(true);
    setError('');
    try {
      await api.aiJobs.reject(job.id);
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : '거부 실패');
    } finally {
      setActing(false);
    }
  };

  const needsReview = job.status === 'NEEDS_REVIEW';

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-foreground">#{job.id}</span>
            <span className="text-xs font-mono text-muted-foreground">{job.targetSpecPath}</span>
            {job.changedFiles && job.changedFiles.length > 1 && (
              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                파일 {job.changedFiles.length}개 변경
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{job.instruction}</p>
          {job.riskFlags && job.riskFlags !== '[]' && (
            <p className="text-[11px] text-warning font-mono mt-1 break-all">
              검토 필요 사유: {job.riskFlags}
            </p>
          )}
          {job.summary && <p className="text-xs text-success mt-1 whitespace-pre-wrap">{job.summary}</p>}
          {job.errorMessage && <p className="text-xs text-destructive mt-1">{job.errorMessage}</p>}
        </div>
        <span
          className={cn(
            'text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap',
            statusBadgeClass[job.status]
          )}
        >
          {statusLabel[job.status]}
        </span>
      </div>

      <div>
        <Button variant="outline" size="sm" onClick={toggleDiff} disabled={loadingDiff}>
          {loadingDiff ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {files === null ? '변경 내용 보기' : '변경 내용 접기'}
        </Button>
      </div>

      {files !== null && (
        files.length === 0 ? (
          <p className="text-xs text-muted-foreground">변경된 파일이 없습니다.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            {files.length > 1 && (
              <div className="flex items-center gap-1.5 border-b border-border bg-muted px-2 py-1.5 overflow-x-auto">
                {files.map((f, idx) => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => setSelectedIdx(idx)}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold whitespace-nowrap',
                      selectedIdx === idx
                        ? 'bg-card text-primary shadow-sm border border-border'
                        : 'text-muted-foreground hover:bg-accent'
                    )}
                  >
                    <FileCode2 className="h-3 w-3" />
                    {f.path}
                  </button>
                ))}
              </div>
            )}
            <div className="bg-sidebar p-3 font-mono text-xs text-sidebar-foreground max-h-72 overflow-y-auto whitespace-pre-wrap">
              {files[selectedIdx]?.content}
            </div>
          </div>
        )
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {needsReview && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleReject} disabled={acting}>
            <X className="h-4 w-4" /> 거부
          </Button>
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={acting}
            className="bg-success hover:opacity-90 text-success-foreground"
          >
            <Check className="h-4 w-4" /> 승인 및 적용
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * 프로젝트 안의 AI 검토 탭.
 * AI가 만든 코드 변경을 검토 대기(위)와 최근 작업 최대 20개(아래)로 나누어 보여준다.
 */
export function AiReviewTab({ projectId }: { projectId: string }) {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setJobs(await api.aiJobs.listByProject(projectId));
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const needsReviewJobs = jobs.filter((job) => job.status === 'NEEDS_REVIEW');
  const recentJobs = jobs.filter((job) => job.status !== 'NEEDS_REVIEW').slice(0, 20);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-foreground">AI 검토</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            AI가 생성한 코드 수정은 자동 적용되지 않고 여기서 사람이 승인해야 실제 파일에 반영됩니다.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          새로고침
        </Button>
      </div>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground">
          검토 대기 ({needsReviewJobs.length})
        </h4>
        {needsReviewJobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            검토 대기 중인 AI 작업이 없습니다.
          </div>
        ) : (
          <div className="space-y-3">
            {needsReviewJobs.map((job) => (
              <JobCard key={job.id} job={job} onDecided={load} />
            ))}
          </div>
        )}
      </section>

      {recentJobs.length > 0 && (
        <section className="space-y-3">
          <h4 className="text-xs font-semibold text-muted-foreground">
            최근 작업 ({recentJobs.length})
          </h4>
          <div className="space-y-3">
            {recentJobs.map((job) => (
              <JobCard key={job.id} job={job} onDecided={load} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
