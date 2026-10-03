import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Loader2,
  Play,
  ShieldCheck,
  TriangleAlert,
  Wrench,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { api, getStoredAuth } from '@/api/client';
import type { AiChatAction, AiJob, AiJobFileDiff, AiJobStatus } from '@/types';
import { cn } from '@/lib/utils';

/** 더 이상 변하지 않는 상태 — 여기 닿으면 폴링을 멈춘다. */
const TERMINAL: AiJobStatus[] = ['APPLIED', 'REJECTED', 'FAILED', 'ERROR', 'CANCELED', 'TIMEOUT'];
const POLL_INTERVAL_MS = 3000;

type Tone = 'pending' | 'review' | 'done' | 'failed';

const STATUS_VIEW: Record<AiJobStatus, { label: string; tone: Tone }> = {
  PENDING: { label: '대기 중', tone: 'pending' },
  RUNNING: { label: 'AI가 코드 작성 중', tone: 'pending' },
  DIFF_READY: { label: '변경 준비됨', tone: 'review' },
  NEEDS_REVIEW: { label: '승인 대기', tone: 'review' },
  APPLIED: { label: '반영됨', tone: 'done' },
  REJECTED: { label: '거부함', tone: 'failed' },
  FAILED: { label: '실패', tone: 'failed' },
  ERROR: { label: '오류', tone: 'failed' },
  CANCELED: { label: '취소됨', tone: 'failed' },
  TIMEOUT: { label: '시간 초과', tone: 'failed' },
};

const TONE_CLASS: Record<Tone, string> = {
  pending: 'bg-muted text-muted-foreground',
  review: 'bg-warning/15 text-warning',
  done: 'bg-success/15 text-success',
  failed: 'bg-destructive/15 text-destructive',
};

/**
 * AI가 대화 중에 만든 작업 · 제안을 보여주는 카드.
 *
 * 답변 본문과 분리해 카드로 세우는 이유는, 여기서 사용자가 해야 할 일이
 * "읽는 것"이 아니라 "승인하거나 실행하는 것"이기 때문이다. 글 속에 섞여 있으면
 * 승인 대기 중인 수정이 있다는 사실을 놓치게 된다.
 *
 * 작업이 만들어진 뒤에도 상태는 백그라운드에서 계속 바뀌므로(대기 → 작성 중 → 승인 대기 → 반영),
 * 카드가 서버를 주기적으로 읽어 스스로 따라간다. 끝난 작업은 더 읽지 않는다.
 */
export function AiActionCard({ action }: { action: AiChatAction }) {
  const navigate = useNavigate();
  const isProposal = action.type === 'RUN_PROPOSAL';
  const admin = getStoredAuth()?.role === 'ADMIN';

  // ── 실행 제안 ─────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  // ── AI 작업 추적 ──────────────────────────────────────────────────────
  const [job, setJob] = useState<AiJob | null>(null);
  const [diff, setDiff] = useState<AiJobFileDiff[] | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!action.jobId) return;
    let cancelled = false;

    const read = async () => {
      try {
        const next = await api.aiJobs.get(action.jobId!);
        if (cancelled) return;
        setJob(next);
        if (TERMINAL.includes(next.status)) stopPolling();
      } catch {
        // 일시적인 조회 실패로 카드를 망가뜨리지 않는다. 다음 주기에 다시 읽는다.
      }
    };

    void read();
    pollRef.current = setInterval(read, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [action.jobId, stopPolling]);

  const handleRun = async () => {
    if (!action.projectId) return;
    setRunning(true);
    setRunError(null);
    try {
      const execution = await api.runTests(action.projectId, {
        specPath: action.specPath ?? undefined,
        grep: action.grep ?? undefined,
      });
      setStarted(true);
      navigate(`/projects/${action.projectId}/runs?execution=${execution.id}`);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const toggleDiff = async () => {
    if (diffOpen) {
      setDiffOpen(false);
      return;
    }
    setDiffOpen(true);
    if (diff || !action.jobId) return;
    setDiffLoading(true);
    setError(null);
    try {
      setDiff(await api.aiJobs.diff(action.jobId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDiffOpen(false);
    } finally {
      setDiffLoading(false);
    }
  };

  const review = async (decision: 'approve' | 'reject') => {
    if (!action.jobId) return;
    setReviewing(true);
    setError(null);
    try {
      const next =
        decision === 'approve'
          ? await api.aiJobs.approve(action.jobId)
          : await api.aiJobs.reject(action.jobId);
      setJob(next);
      if (TERMINAL.includes(next.status)) stopPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewing(false);
    }
  };

  const status = job?.status;
  const view = status ? STATUS_VIEW[status] : null;
  const awaitingReview = status === 'NEEDS_REVIEW' || status === 'DIFF_READY';
  const inProgress = status === 'PENDING' || status === 'RUNNING';

  const Icon = isProposal ? Play : action.type === 'FIX_TEST' ? Wrench : FileCode2;

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-[13px]">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ai-accent" />
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold text-foreground">{action.label}</p>
          {action.detail && (
            <p className="mt-0.5 break-words text-[12px] leading-relaxed text-muted-foreground">
              {action.detail}
            </p>
          )}

          {/* ── 실행 제안 ── */}
          {isProposal && !started && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="xs" onClick={handleRun} disabled={running || !action.projectId}>
                {running ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" /> 시작 중...
                  </>
                ) : (
                  <>
                    <Play className="h-3 w-3" /> 지금 실행
                  </>
                )}
              </Button>
              <span className="text-[11px] text-muted-foreground">아직 실행되지 않았습니다</span>
            </div>
          )}
          {started && (
            <p className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-success">
              <CheckCircle2 className="h-3 w-3" /> 실행을 시작했습니다
            </p>
          )}
          {runError && <p className="mt-2 text-[12px] text-destructive">{runError}</p>}

          {/* ── AI 작업 상태 ── */}
          {action.jobId && (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                    view ? TONE_CLASS[view.tone] : TONE_CLASS.pending
                  )}
                >
                  {inProgress && <Loader2 className="h-3 w-3 animate-spin" />}
                  {awaitingReview && <ShieldCheck className="h-3 w-3" />}
                  {status === 'APPLIED' && <CheckCircle2 className="h-3 w-3" />}
                  {view?.tone === 'failed' && <XCircle className="h-3 w-3" />}
                  {view?.label ?? '상태 확인 중'}
                </span>
                <span className="text-[11px] text-muted-foreground">작업 #{action.jobId}</span>
              </div>

              {job?.changedFiles && job.changedFiles.length > 0 && (
                <p className="break-all font-mono text-[11px] text-muted-foreground">
                  변경 파일: {job.changedFiles.join(', ')}
                </p>
              )}
              {job?.riskFlags && job.riskFlags !== '[]' && (
                <p className="break-all text-[11px] font-semibold text-warning">
                  위험 신호: {job.riskFlags}
                </p>
              )}
              {job?.errorMessage && (
                <p className="break-words text-[12px] text-destructive">{job.errorMessage}</p>
              )}

              {awaitingReview && (
                <>
                  <button
                    type="button"
                    onClick={toggleDiff}
                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-ai-accent"
                  >
                    {diffOpen ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    변경 내용 보기
                    {diffLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                  </button>

                  {diffOpen && diff && (
                    <div className="space-y-2">
                      {diff.map((file) => (
                        <div key={file.path} className="rounded-sm border border-border bg-card">
                          <p className="border-b border-border px-2 py-1 font-mono text-[11px] font-semibold text-foreground">
                            {file.path}
                          </p>
                          <pre className="max-h-64 overflow-auto px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground">
                            {file.content}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 코드를 보지 않고 승인하는 일을 막기 위해, 펼쳐 본 뒤에만 버튼을 연다. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="xs"
                      onClick={() => review('approve')}
                      disabled={!diffOpen || !diff || reviewing || !admin}
                    >
                      {reviewing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      승인하고 반영
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => review('reject')}
                      disabled={reviewing || !admin}
                    >
                      거부
                    </Button>
                    {!admin ? (
                      <span className="text-[11px] text-muted-foreground">
                        승인은 관리자만 할 수 있습니다
                      </span>
                    ) : (
                      !diffOpen && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <TriangleAlert className="h-3 w-3" />
                          변경 내용을 확인해야 승인할 수 있습니다
                        </span>
                      )
                    )}
                  </div>
                </>
              )}

              {status === 'APPLIED' && action.projectId && action.specPath && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => navigate(`/projects/${action.projectId}/source`)}
                >
                  코드에서 보기
                </Button>
              )}

              {error && <p className="break-words text-[12px] text-destructive">{error}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
