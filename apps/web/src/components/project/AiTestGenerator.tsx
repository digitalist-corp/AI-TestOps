import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { api } from '@/api/client';
import type { AiJob, SiteMap } from '@/types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAiEnabled } from '@/lib/aiEnabled';
import { cn } from '@/lib/utils';
import { autoSpecPath, buildSuggestions, type TestSuggestion } from '@/lib/testSuggestions';

const POLL_INTERVAL_MS = 3000;

/** 더 기다려도 상태가 바뀌지 않는 작업 상태. 여기 닿으면 폴링을 멈춘다. */
const TERMINAL_STATUSES: AiJob['status'][] = [
  'NEEDS_REVIEW', 'APPLIED', 'REJECTED', 'FAILED', 'ERROR', 'CANCELED', 'TIMEOUT',
];

const STATUS_LABEL: Record<AiJob['status'], string> = {
  PENDING: '대기 중',
  RUNNING: 'AI가 테스트 코드를 만드는 중...',
  DIFF_READY: '결과 처리 중',
  NEEDS_REVIEW: '검토 대기 — 승인해야 반영됩니다',
  APPLIED: '적용 완료',
  REJECTED: '거부됨',
  FAILED: '생성 실패',
  ERROR: '오류 발생',
  CANCELED: '취소됨',
  TIMEOUT: '시간 초과',
};

/**
 * AI 탭의 "AI로 테스트 만들기" 화면. 문장 하나로 테스트를 만든다.
 * 파일 경로는 자동으로 정하고, 만든 코드는 사람이 승인(NEEDS_REVIEW)해야 반영된다.
 */
export function AiTestGenerator({ projectId }: { projectId: string }) {
  const { active } = useAiEnabled();
  const navigate = useNavigate();

  const [siteMap, setSiteMap] = useState<SiteMap | null>(null);
  const [siteMapLoaded, setSiteMapLoaded] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [routeKeys, setRouteKeys] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState<AiJob | null>(null);

  // 추천 문장용 화면 정보. 저장소를 연결하지 않았거나 분석 전이면 실패할 수 있어 기본 추천으로 넘어간다.
  useEffect(() => {
    if (!active) return;
    let ignore = false;
    setSiteMapLoaded(false);
    api.getSiteMap(projectId)
      .then((map) => {
        if (!ignore) setSiteMap(map);
      })
      .catch(() => {
        if (!ignore) setSiteMap(null);
      })
      .finally(() => {
        if (!ignore) setSiteMapLoaded(true);
      });
    return () => {
      ignore = true;
    };
  }, [projectId, active]);

  const suggestions = useMemo(() => buildSuggestions(siteMap), [siteMap]);

  const jobId = job?.id ?? null;
  const finished = job != null && TERMINAL_STATUSES.includes(job.status);

  // 작업이 끝날 때까지 3초마다 상태를 다시 읽는다. 언마운트 · 새로 만들기 때 멈춘다.
  useEffect(() => {
    if (jobId == null || finished) return;
    let ignore = false;
    const timer = setInterval(async () => {
      try {
        const updated = await api.aiJobs.get(jobId);
        if (!ignore) setJob(updated);
      } catch {
        // 일시적인 오류는 넘기고 다음 차례에 다시 읽는다
      }
    }, POLL_INTERVAL_MS);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [jobId, finished]);

  const pickSuggestion = (suggestion: TestSuggestion) => {
    setInstruction(suggestion.text);
    setRouteKeys(suggestion.routeKeys);
  };

  const changeInstruction = (value: string) => {
    setInstruction(value);
    // 손으로 고치면 참고 화면은 그대로 두고, 다 지우면 함께 비운다.
    if (!value.trim()) setRouteKeys([]);
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = instruction.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const created = await api.aiJobs.createTemplateGenerate(projectId, {
        targetSpecPath: autoSpecPath(new Date()),
        instruction: text,
        routeKeys: routeKeys.length ? routeKeys : undefined,
      });
      setJob(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : '테스트 생성 요청에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setJob(null);
    setInstruction('');
    setRouteKeys([]);
    setError('');
  };

  if (!active) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">AI 기능이 꺼져 있습니다. 상단의 AI 스위치를 켜세요.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="flex items-center gap-1.5 text-lg font-bold text-foreground">
          <Sparkles className="h-4 w-4 text-ai-accent" />
          AI로 테스트 만들기
        </h2>
        <p className="text-sm text-muted-foreground">
          확인하고 싶은 내용을 문장으로 적으면 AI가 Playwright 테스트를 만듭니다. 만든 코드는 승인해야 반영됩니다.
        </p>
      </div>

      {!job ? (
        <Card className="p-5">
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">추천 문장</p>
              {!siteMapLoaded ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <ul className="flex flex-wrap gap-1.5" aria-label="추천 문장">
                  {suggestions.map((suggestion) => {
                    const selected = suggestion.text === instruction;
                    return (
                      <li key={suggestion.text}>
                        <button
                          type="button"
                          onClick={() => pickSuggestion(suggestion)}
                          aria-pressed={selected}
                          className={cn(
                            'cursor-pointer rounded-full border px-3 py-1 text-left text-xs transition-colors',
                            selected
                              ? 'border-ai-accent bg-ai-accent/15 text-ai-accent'
                              : 'border-border bg-card text-foreground hover:border-ai-accent hover:text-ai-accent'
                          )}
                        >
                          {suggestion.text}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <textarea
              rows={4}
              value={instruction}
              onChange={(e) => changeInstruction(e.target.value)}
              onKeyDown={(e) => {
                // Ctrl(⌘) + Enter 로 바로 요청
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                }
              }}
              aria-label="테스트로 확인할 내용"
              placeholder="예: 로그인 화면에서 아이디와 비밀번호를 넣고 로그인하면 대시보드가 보이는지 확인"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ai-accent"
            />

            {routeKeys.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                참고할 화면: <span className="font-mono">{routeKeys.join(', ')}</span>
              </p>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={!instruction.trim() || submitting}
                className="bg-ai-accent text-ai-accent-foreground hover:opacity-90"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> 요청 중...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" /> 테스트 만들기
                  </>
                )}
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Card className="space-y-3 p-5" aria-live="polite">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-foreground">작업 #{job.id}</span>
            <span className="rounded-full bg-ai-accent/15 px-2 py-0.5 text-[11px] font-medium text-ai-accent">
              {STATUS_LABEL[job.status]}
            </span>
            {!finished && <Loader2 className="h-3.5 w-3.5 animate-spin text-ai-accent" />}
          </div>
          <p className="text-sm text-foreground">{job.instruction}</p>
          <p className="break-all font-mono text-[11px] text-muted-foreground">{job.targetSpecPath}</p>
          {job.riskFlags && job.riskFlags !== '[]' && (
            <p className="break-all font-mono text-[11px] text-warning">위험 신호: {job.riskFlags}</p>
          )}
          {job.errorMessage && <p className="text-xs text-destructive">{job.errorMessage}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" /> 새로 만들기
            </Button>
            {job.status === 'NEEDS_REVIEW' && (
              <Button type="button" size="sm" onClick={() => navigate(`/projects/${projectId}/ai-review`)}>
                검토하러 가기
              </Button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
