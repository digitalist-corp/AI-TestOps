import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Loader2, Sparkles, TriangleAlert, Wrench, XCircle } from 'lucide-react';
import { api } from '@/api/client';
import type { AiBootstrapPhase, AiBootstrapResponse } from '@/types';
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

const POLL_INTERVAL_MS = 2000;
const FINISHED: AiBootstrapPhase[] = ['PASSED', 'FAILED', 'ERROR'];
/** 진행 단계의 순서. HEALING 뒤에는 다시 RUNNING 으로 돌아가므로 순서 비교에서 RUNNING 과 같은 자리로 본다. */
const ORDER: Record<AiBootstrapPhase, number> = {
  ANALYZING_SITE: 0,
  GENERATING: 1,
  RUNNING: 2,
  HEALING: 2,
  PASSED: 3,
  FAILED: 3,
  ERROR: 3,
};

type StepState = 'pending' | 'active' | 'done';

function StepRow({ state, children }: { state: StepState; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {state === 'active' ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ai-accent" />
      ) : state === 'done' ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
      ) : (
        <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-border" />
      )}
      <span className={state === 'active' ? 'text-foreground' : 'text-muted-foreground'}>{children}</span>
    </div>
  );
}

export function AiBootstrapProgressDialog({ open, projectId, instruction, onClose, onOpenProject }: Props) {
  const [status, setStatus] = useState<AiBootstrapResponse | null>(null);
  const [error, setError] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef<number>(0);
  const startedRef = useRef(false);

  const runBootstrap = useCallback(async () => {
    startedAt.current = Date.now();
    setError('');
    setElapsedMs(0);
    try {
      let current = await api.aiBootstrap(projectId, { instruction });
      setStatus(current);
      // 사이트 탐색 · 생성 · 실행 · 자율 교정은 서버에서 이어지고, 여기서는 끝날 때까지 상태만 다시 읽는다.
      while (!FINISHED.includes(current.phase)) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        current = await api.getAiBootstrap(projectId, current.bootstrapId);
        setStatus(current);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 초기 케이스 생성에 실패했습니다.');
    }
  }, [projectId, instruction]);

  useEffect(() => {
    if (!open || startedRef.current) return;
    startedRef.current = true;
    runBootstrap();
  }, [open, runBootstrap]);

  const phase: AiBootstrapPhase = error ? 'ERROR' : (status?.phase ?? 'ANALYZING_SITE');
  const inProgress = !FINISHED.includes(phase);

  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt.current), 1000);
    return () => clearInterval(timer);
  }, [inProgress]);

  const stepState = (step: AiBootstrapPhase): StepState => {
    if (phase === step) return 'active';
    if (phase === 'ERROR') return ORDER[step] < ORDER[status?.phase ?? 'ANALYZING_SITE'] ? 'done' : 'pending';
    return ORDER[phase] > ORDER[step] ? 'done' : 'pending';
  };

  const site = status?.siteAnalysis ?? null;
  const healAttempt = status?.healAttempt ?? 0;
  const maxHeal = status?.maxHealAttempts ?? 2;
  const files = status?.generatedFiles ?? [];
  const warnings = status?.warnings ?? [];
  // 처음 실행은 테스트 실행 환경(도커 이미지)을 받느라 몇 분 걸릴 수 있다.
  const takingLong = inProgress && elapsedMs > 120_000;

  const analyzeLabel = (() => {
    if (phase === 'ANALYZING_SITE') return '사이트에 접속해 화면 요소와 버튼을 파악하는 중';
    if (!site) return '이미 분석된 화면 정보를 사용합니다';
    if (site.mode === 'ERROR') return '사이트 탐색 실패 — 화면 정보 없이 진행합니다';
    if (site.mode === 'VISUAL_REQUIRED') return '캔버스로 그리는 사이트라 화면 요소를 읽지 못했습니다';
    return `사이트 화면 ${site.pages}개 탐색 · 실측 셀렉터 ${site.verifiedSelectors}개 확인`;
  })();

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-ai-accent" />
            AI 초기 테스트 케이스 생성
          </DialogTitle>
          <DialogDescription>
            AI가 사이트를 직접 열어 화면 요소를 확인하고, 그 요소로 테스트를 만든 뒤 실제로 실행해 통과하는지 확인합니다.
            실패하면 실행 로그를 보고 최대 {maxHeal}번까지 스스로 고칩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-xs">
            <StepRow state={stepState('ANALYZING_SITE')}>{analyzeLabel}</StepRow>
            <StepRow state={stepState('GENERATING')}>파악한 화면 요소로 맞춤형 테스트 코드 작성 중</StepRow>
            <StepRow state={stepState('RUNNING')}>
              생성된 테스트 실행 검증 중
              {healAttempt > 0 && ` (교정 ${healAttempt}회 후 재실행)`}
              {status?.specPath && ` · ${status.specPath}`}
            </StepRow>
            {(phase === 'HEALING' || healAttempt > 0) && (
              <div className="flex items-center gap-2">
                {phase === 'HEALING' ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ai-accent" />
                ) : (
                  <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className={phase === 'HEALING' ? 'text-foreground' : 'text-muted-foreground'}>
                  실행 로그를 바탕으로 셀렉터를 자동 교정하여 재시도 중 ({healAttempt}/{maxHeal})
                </span>
              </div>
            )}
          </div>

          {inProgress && (
            <div className="space-y-2">
              <p className="text-center text-sm text-muted-foreground">
                {Math.floor(elapsedMs / 1000)}초 경과
                {status && ` · 테스트 1회 실행 예상 약 ${Math.round(status.estimatedDurationMs / 1000)}초`}
              </p>
              {takingLong && (
                <p className="rounded-sm border border-warning bg-warning/10 px-3 py-2 text-[13px] text-warning">
                  처음 실행할 때는 사이트 탐색 · 테스트 실행 환경(도커 이미지)을 내려받느라 몇 분 걸릴 수 있습니다.
                  창을 닫아도 작업은 서버에서 계속되며, 결과는 실행 이력에서 확인할 수 있습니다.
                </p>
              )}
            </div>
          )}

          {warnings.length > 0 && (
            <ul className="space-y-1">
              {warnings.map((warning) => (
                <li key={warning} className="flex items-start gap-2 text-xs text-warning">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          )}

          {phase === 'PASSED' && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm font-medium text-success">
                <CheckCircle2 className="h-4 w-4" />
                {healAttempt > 0
                  ? `AI가 ${healAttempt}번 고친 끝에 테스트가 실제로 통과했습니다`
                  : 'AI가 만든 테스트가 실제로 통과했습니다'}
              </p>
              <p className="text-xs text-muted-foreground">생성된 파일: {files.join(', ')}</p>
            </div>
          )}

          {phase === 'FAILED' && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                <XCircle className="h-4 w-4" />
                {healAttempt > 0
                  ? `${healAttempt}번 자동 교정했지만 실행에서 실패했습니다`
                  : '테스트를 만들었지만 실행에서 실패했습니다'}
              </p>
              <p className="text-xs text-muted-foreground">
                생성된 파일({files.join(', ')})은 그대로 저장돼 있습니다. 소스 탐색기에서
                "AI 수정 도움"으로 이어서 고칠 수 있습니다.
              </p>
              {status?.failureLog && (
                <details className="rounded-lg border border-border bg-muted/50">
                  <summary className="cursor-pointer px-3 py-1.5 text-xs text-muted-foreground">실행 로그 보기</summary>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all px-3 pb-3 text-[11px] text-muted-foreground">
                    {status.failureLog}
                  </pre>
                </details>
              )}
            </div>
          )}

          {phase === 'ERROR' && <p className="text-sm text-destructive">{error || status?.error}</p>}

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
