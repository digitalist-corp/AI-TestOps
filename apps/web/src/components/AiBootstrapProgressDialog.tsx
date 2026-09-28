import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Sparkles, XCircle } from 'lucide-react';
import { api } from '@/api/client';
import type { ExecutionStatus } from '@/types';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';

interface Props {
  open: boolean;
  projectId: string;
  instruction: string;
  onClose: () => void;
  onOpenProject: () => void;
}

type Phase = 'GENERATING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'ERROR';

const TERMINAL_STATUSES: ExecutionStatus[] = ['PASSED', 'FAILED', 'ERROR', 'CANCELLED'];

function formatRemaining(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    return `약 ${minutes}분 ${seconds % 60}초 남았습니다`;
  }
  return `약 ${seconds}초 남았습니다`;
}

export function AiBootstrapProgressDialog({ open, projectId, instruction, onClose, onOpenProject }: Props) {
  const [phase, setPhase] = useState<Phase>('GENERATING');
  const [error, setError] = useState('');
  const [specPath, setSpecPath] = useState('');
  const [generatedFiles, setGeneratedFiles] = useState<string[]>([]);
  const [estimatedMs, setEstimatedMs] = useState(60000);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [failureLog, setFailureLog] = useState('');
  const startedAt = useRef<number>(0);
  const startedRef = useRef(false);

  const runBootstrap = useCallback(async () => {
    startedAt.current = Date.now();
    setPhase('GENERATING');
    setError('');
    setElapsedMs(0);
    try {
      const res = await api.aiBootstrap(projectId, { instruction });
      setSpecPath(res.specPath);
      setGeneratedFiles(res.generatedFiles);
      setEstimatedMs(res.estimatedDurationMs);
      setPhase('RUNNING');

      // 실행이 끝날 때까지 상태를 확인한다. 서버가 예상 시간을 주지만 실제 소요는 매번 달라서,
      // 카운트다운은 어디까지나 예상치이고 종료 판정은 항상 실제 status로 한다.
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const detail = await api.getExecutionDetail(res.executionId);
        const status = detail.execution.status;
        if (TERMINAL_STATUSES.includes(status)) {
          if (status === 'PASSED') {
            setPhase('PASSED');
          } else {
            setPhase('FAILED');
            setFailureLog(detail.logOutput ?? '');
          }
          return;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 초기 케이스 생성에 실패했습니다.');
      setPhase('ERROR');
    }
  }, [projectId, instruction]);

  useEffect(() => {
    if (!open || startedRef.current) return;
    startedRef.current = true;
    runBootstrap();
  }, [open, runBootstrap]);

  useEffect(() => {
    if (phase !== 'GENERATING' && phase !== 'RUNNING') return;
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt.current), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const inProgress = phase === 'GENERATING' || phase === 'RUNNING';
  const remainingMs = estimatedMs - elapsedMs;
  // 처음 실행은 테스트 실행 환경(도커 이미지)을 받느라 몇 분 걸릴 수 있다.
  const takingLong = inProgress && elapsedMs > 90_000;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-ai-accent" />
            AI 초기 테스트 케이스 생성
          </DialogTitle>
          <DialogDescription>
            AI가 케이스를 만들고 실제로 실행해서 통과하는지 확인합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-xs">
            <div className="flex items-center gap-2">
              {phase === 'GENERATING' ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ai-accent" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
              )}
              <span className={phase === 'GENERATING' ? 'text-foreground' : 'text-muted-foreground'}>
                AI가 테스트 코드 작성 중
              </span>
            </div>
            <div className="flex items-center gap-2">
              {phase === 'RUNNING' ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ai-accent" />
              ) : phase === 'PASSED' || phase === 'FAILED' ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
              ) : (
                <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-border" />
              )}
              <span className={phase === 'RUNNING' ? 'text-foreground' : 'text-muted-foreground'}>
                생성된 테스트 실행 중{specPath && ` (${specPath})`}
              </span>
            </div>
          </div>

          {inProgress && (
            <div className="space-y-2">
              <p className="text-center text-sm text-muted-foreground">
                {Math.floor(elapsedMs / 1000)}초 경과 ·{' '}
                {remainingMs > 0 ? formatRemaining(remainingMs) : '예상보다 오래 걸리고 있습니다'}
              </p>
              {takingLong && (
                <p className="rounded-sm border border-warning bg-warning/10 px-3 py-2 text-[13px] text-warning">
                  처음 실행할 때는 테스트 실행 환경(도커 이미지)을 내려받느라 몇 분 걸릴 수 있습니다.
                  창을 닫아도 작업은 서버에서 계속되며, 결과는 실행 이력에서 확인할 수 있습니다.
                </p>
              )}
            </div>
          )}

          {phase === 'PASSED' && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm font-medium text-success">
                <CheckCircle2 className="h-4 w-4" />
                AI가 만든 테스트가 실제로 통과했습니다
              </p>
              <p className="text-xs text-muted-foreground">
                생성된 파일: {generatedFiles.join(', ')}
              </p>
            </div>
          )}

          {phase === 'FAILED' && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                <XCircle className="h-4 w-4" />
                테스트를 만들었지만 실행에서 실패했습니다
              </p>
              <p className="text-xs text-muted-foreground">
                생성된 파일({generatedFiles.join(', ')})은 그대로 저장돼 있습니다. 소스 탐색기에서
                "AI 수정 도움"으로 이어서 고칠 수 있습니다.
              </p>
              {failureLog && (
                <details className="rounded-lg border border-border bg-muted/50">
                  <summary className="cursor-pointer px-3 py-1.5 text-xs text-muted-foreground">실행 로그 보기</summary>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all px-3 pb-3 text-[11px] text-muted-foreground">
                    {failureLog}
                  </pre>
                </details>
              )}
            </div>
          )}

          {phase === 'ERROR' && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {inProgress ? '닫기 (계속 진행됩니다)' : '닫기'}
            </Button>
            <Button type="button" onClick={onOpenProject}>
              프로젝트 열기
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
