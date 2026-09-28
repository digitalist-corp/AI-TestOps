import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, FileCode2, Loader2, Play, ShieldCheck, TriangleAlert, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { api } from '@/api/client';
import type { AiChatAction } from '@/types';

/**
 * AI가 대화 중에 만든 작업 · 제안을 보여주는 카드.
 *
 * 답변 본문과 분리해 카드로 세우는 이유는, 여기서 사용자가 해야 할 일이
 * "읽는 것"이 아니라 "승인하거나 실행하는 것"이기 때문이다. 글 속에 섞여 있으면
 * 승인 대기 중인 수정이 있다는 사실을 놓치게 된다.
 */
export function AiActionCard({ action }: { action: AiChatAction }) {
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const isProposal = action.type === 'RUN_PROPOSAL';
  const isFailed = action.status === 'FAILED';

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

  const Icon = isFailed ? TriangleAlert : isProposal ? Play : action.type === 'FIX_TEST' ? Wrench : FileCode2;

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-[13px]">
      <div className="flex items-start gap-2">
        <Icon
          className={`mt-0.5 h-4 w-4 shrink-0 ${isFailed ? 'text-destructive' : 'text-ai-accent'}`}
        />
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold text-foreground">{action.label}</p>
          {action.detail && (
            <p className="mt-0.5 break-words text-[12px] leading-relaxed text-muted-foreground">
              {action.detail}
            </p>
          )}

          {action.status === 'CREATED' && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
                <ShieldCheck className="h-3 w-3" />
                승인 대기
              </span>
              <Button size="xs" variant="outline" onClick={() => navigate('/ai-jobs')}>
                검토하러 가기
              </Button>
            </div>
          )}

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
        </div>
      </div>
    </div>
  );
}
