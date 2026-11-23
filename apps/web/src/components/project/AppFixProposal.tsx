import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { api } from '@/api/client';
import type { AppFixCategory, AppFixProposal, AppFixView, PlanItemKey } from '@/types';
import { Badge, type BadgeProps } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

/** 분석 중일 때 다시 읽는 간격. 조회는 원격 저장소를 읽지 않아 가볍다 */
export const POLL_MS = 3000;

/** 서버 분류의 화면 이름. 코드 · API 후보만 수정 제안을 볼 수 있다 */
export const FIX_CATEGORY: Record<AppFixCategory, { label: string; variant: BadgeProps['variant'] }> = {
  APP_CODE: { label: '코드 오류 후보', variant: 'warning' },
  APP_API: { label: 'API 오류 후보', variant: 'warning' },
  TEST: { label: '테스트 오류', variant: 'neutral' },
  ENVIRONMENT: { label: '실행 환경 문제', variant: 'neutral' },
  UNKNOWN: { label: '분류 미확정', variant: 'neutral' },
};

export const isFixCandidate = (category: AppFixCategory | undefined) => category === 'APP_CODE' || category === 'APP_API';

/**
 * 결함 상세 하단의 "AI 수정 제안 보기" (제품 코드 수정안 1단계, 읽기 전용).
 * 누르면 최근 수정안을 읽고, 없으면 마지막 실패 실행으로 요청한다. 같은 상세 안에
 * 원인 · 실행 근거 → 저장소 · 기준 커밋 → 검증 → 파일별 diff 순으로 보여 준다. 저장소에는 쓰지 않는다.
 * requestBlockedReason 이 있으면(사용자가 AI 를 끔) 이미 있는 결과만 읽고 새 분석 · 다시 요청은 하지 않는다.
 */
export function AppFixProposalPanel({
  projectId,
  defectKey,
  requestBlockedReason = null,
}: {
  projectId: string;
  defectKey: PlanItemKey;
  requestBlockedReason?: string | null;
}) {
  const [data, setData] = useState<AppFixView | null>(null);
  const [none, setNone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const proposal = data?.proposal ?? null;
  const analyzing = proposal?.status === 'ANALYZING';

  const { specPath, grep } = defectKey;
  useEffect(() => {
    if (!analyzing) return;
    let canceled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const result = await api.defects.fixProposal(projectId, { specPath, grep });
        if (canceled) return;
        setData(result);
        if (result.proposal?.status !== 'ANALYZING') return;
      } catch {
        // 일시적인 조회 실패 뒤에도 분석 상태를 다시 읽는다.
      }
      if (!canceled) timer = setTimeout(poll, POLL_MS);
    };

    timer = setTimeout(poll, POLL_MS);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [analyzing, projectId, specPath, grep]);

  const act = async (work: () => Promise<AppFixView>) => {
    setBusy(true);
    setError('');
    try {
      setData(await work());
    } catch (e) {
      setError(e instanceof Error ? e.message : '수정 제안을 불러오지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  const show = () =>
    act(async () => {
      const current = await api.defects.fixProposal(projectId, defectKey);
      setNone(!current.proposal && requestBlockedReason != null);
      if (current.proposal || requestBlockedReason) return current;
      return api.defects.requestFixProposal(projectId, defectKey, current.latestFailedExecutionId);
    });
  const onRetry = requestBlockedReason ? null : () => requestAgain();
  const requestAgain = () =>
    act(() => api.defects.requestFixProposal(projectId, defectKey, data!.latestFailedExecutionId));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={show} disabled={busy || analyzing}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          AI 수정 제안 보기
        </Button>
        {data?.stale && !analyzing && (
          <>
            <Badge variant="warning">이전 수정안</Badge>
            {onRetry && (
              <Button size="sm" variant="outline" onClick={onRetry} disabled={busy}>
                새 분석 요청
              </Button>
            )}
          </>
        )}
      </div>
      {requestBlockedReason && <p className="text-xs text-muted-foreground">{requestBlockedReason}</p>}
      {none && <p className="text-sm text-muted-foreground">아직 만든 수정 제안이 없어요.</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {proposal && <ProposalBody proposal={proposal} busy={busy} onRetry={onRetry} />}
    </div>
  );
}

function ProposalBody({ proposal: p, busy, onRetry }: { proposal: AppFixProposal; busy: boolean; onRetry: (() => void) | null }) {
  if (p.status === 'ANALYZING') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-ai-accent" /> AI가 실행 근거와 소스를 분석 중이에요.
      </p>
    );
  }
  if (p.status === 'FAILED') {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">분석하지 못했어요: {p.errorMessage ?? '알 수 없는 오류'}</p>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry} disabled={busy}>
            다시 요청
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      {/* 1. 원인 · 실행 근거 */}
      <section className="space-y-1.5">
        {p.status === 'DIAGNOSIS_ONLY' && <Badge variant="info">진단만 제공</Badge>}
        {p.limitation && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{p.limitation}</p>}
        {/* 키가 없어 AI 없이 끝난 진단(요약 없음)은 키를 등록한 뒤 같은 기준으로 다시 분석할 수 있다 (서버가 키를 다시 확인) */}
        {p.status === 'DIAGNOSIS_ONLY' && !p.summary && onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry} disabled={busy}>
            AI로 다시 분석
          </Button>
        )}
        {p.summary && <p className="font-medium text-foreground">{p.summary}</p>}
        {p.causes.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-foreground">
            {p.causes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
        {p.checks.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {p.checks.map((c) => (
              <li key={c}>확인할 곳: {c}</li>
            ))}
          </ul>
        )}
        {p.evidence && (
          <details className="rounded-lg border border-border bg-muted/50">
            <summary className="cursor-pointer px-3 py-1.5 text-xs text-muted-foreground">실행 근거 (실패 #{p.executionId})</summary>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all px-3 pb-3 text-[11px] text-muted-foreground">
              {p.evidence}
            </pre>
          </details>
        )}
      </section>

      {/* 2. 저장소 · 기준 커밋 */}
      {p.sourceRepository && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{p.sourceRepository}{p.sourceBranch ? ` (${p.sourceBranch})` : ''}</span>
          {p.sourceSha && <code className="rounded bg-muted px-1 font-mono text-foreground">{p.sourceSha.slice(0, 7)}</code>}
          {p.appRoot && <span>앱 폴더 {p.appRoot}</span>}
          <span>배포 버전 미확인</span>
        </p>
      )}

      {/* 3. 검증 */}
      {p.verification === 'DIFF_APPLIES' && <Badge variant="info">diff 적용 확인 · 재현 테스트 미실행</Badge>}

      {/* 4. 파일별 diff */}
      {p.files.length > 0 && (
        <div className="space-y-2">
          {p.files.map((f) => (
            <details key={f.path} className="rounded-lg border border-border">
              <summary className="cursor-pointer px-3 py-1.5 font-mono text-xs text-foreground">{f.path}</summary>
              <pre className="max-h-80 overflow-auto bg-sidebar p-3 font-mono text-xs text-sidebar-foreground">
                {f.diff.split('\n').map((line, i) => (
                  <span
                    key={i}
                    className={cn(
                      'block',
                      line.startsWith('+') && !line.startsWith('+++') && 'text-success',
                      line.startsWith('-') && !line.startsWith('---') && 'text-destructive',
                    )}
                  >
                    {line}
                  </span>
                ))}
              </pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
