import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react';
import { api } from '@/api/client';
import type { CaseFocus, CaseSteps, StepsResponse } from '@/types';
import { samePath } from '@/lib/rounds';
import { cn } from '@/lib/utils';

/** 영상은 실패 단계 조금 앞부터 보여 준다 */
const LEAD_MS = 2000;

const isFocus = (c: CaseSteps, focus: CaseFocus | null | undefined) =>
  !!focus && samePath(c.specPath, focus.specPath) && (c.title === focus.title || c.title.endsWith(` > ${focus.title}`));

/** "파일 > 묶음 > 케이스" 에서 파일을 뺀 이름 */
const caseName = (c: CaseSteps) => {
  const parts = c.title.split(' > ');
  return parts.length > 1 ? parts.slice(1).join(' > ') : c.title;
};

/**
 * 단계별 실행 기록 (B-6, #85). 케이스마다 한국어 단계 문장과 성공 · 실패, 실패 단계에는 그때의 화면과 영상.
 * 실패 케이스는 펼쳐 두고, focus(결함에서 들어옴)가 있으면 그 케이스의 실패 단계로 스크롤한다.
 */
export function StepTimeline({
  projectId,
  executionId,
  focus,
  mediaUrl,
}: {
  projectId: string;
  executionId: number;
  focus?: CaseFocus | null;
  /** 아티팩트 경로 → 브라우저가 바로 여는 주소 (토큰 포함) */
  mediaUrl: (path: string) => string;
}) {
  const [data, setData] = useState<StepsResponse | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const focusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(false);
    api
      .getSteps(projectId, executionId)
      .then((res) => {
        if (!alive) return;
        setData(res);
        setOpen(new Set(res.cases.filter((c) => c.status === 'FAILED' || isFocus(c, focus)).map((c) => c.title)));
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [projectId, executionId, focus]);

  useEffect(() => {
    focusRef.current?.scrollIntoView?.({ block: 'center' });
  }, [data]);

  if (error) return <p className="text-sm text-muted-foreground">단계 기록을 불러오지 못했어요.</p>;
  if (!data) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data.recorded || data.cases.length === 0) {
    return <p className="text-sm text-muted-foreground">이 실행에는 단계 기록이 없어요. 새로 실행하면 단계가 남아요.</p>;
  }

  const cases = [...data.cases].sort((a, b) => Number(b.status === 'FAILED') - Number(a.status === 'FAILED'));
  const toggle = (title: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  return (
    <ul className="space-y-2">
      {cases.map((c) => {
        const expanded = open.has(c.title);
        const focused = isFocus(c, focus);
        const failed = c.status === 'FAILED';
        const shot = c.attachments.find((a) => a.contentType.startsWith('image/'));
        const video = c.attachments.find((a) => a.contentType.startsWith('video/'));
        return (
          <li
            key={c.title}
            className={cn('rounded-lg border bg-card', failed ? 'border-destructive/40' : 'border-border', focused && 'ring-2 ring-primary/40')}
          >
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => toggle(c.title)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left"
            >
              {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                  failed ? 'bg-destructive/10 text-destructive' : c.status === 'PASSED' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
                )}
              >
                {failed ? '실패' : c.status === 'PASSED' ? '성공' : '건너뜀'}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={c.title}>
                {caseName(c)}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {failed && c.failedStep != null ? `${c.steps.length}단계 중 ${c.failedStep + 1}번째에서 실패` : `${c.steps.length}단계`}
              </span>
            </button>
            {expanded && (
              <ol aria-label={`${caseName(c)} 단계`} className="space-y-1 border-t border-border px-3 py-2">
                {c.steps.map((s, i) => {
                  const isFailedStep = i === c.failedStep;
                  return (
                    <li
                      key={i}
                      ref={isFailedStep && focused ? (el) => { focusRef.current = el; } : undefined}
                      className={cn('rounded-md px-2 py-1 text-sm', isFailedStep && 'bg-destructive/5')}
                    >
                      <div className="flex items-start gap-2">
                        <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                        {s.status === 'FAILED' ? (
                          <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-label="실패" />
                        ) : (
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="성공" />
                        )}
                        <span className={cn('min-w-0 flex-1 break-words', isFailedStep ? 'font-medium text-destructive' : 'text-foreground')}>
                          {s.text}
                        </span>
                      </div>
                      {s.error && <p className="ml-14 mt-0.5 break-words text-xs text-muted-foreground">{s.error}</p>}
                      {isFailedStep && (shot || video) && (
                        <div className="ml-14 mt-2 grid grid-cols-1 gap-2 @3xl:grid-cols-2">
                          {shot && (
                            <a href={mediaUrl(shot.path)} target="_blank" rel="noreferrer" className="block">
                              <img
                                src={mediaUrl(shot.path)}
                                alt="실패 시점 화면"
                                className="max-h-64 w-full rounded border border-border object-contain"
                              />
                            </a>
                          )}
                          {video && (
                            <video
                              aria-label="실패 직전부터 영상"
                              controls
                              preload="metadata"
                              src={`${mediaUrl(video.path)}#t=${Math.max(0, ((s.offsetMs ?? 0) - LEAD_MS) / 1000)}`}
                              className="max-h-64 w-full rounded border border-border bg-black"
                            />
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </li>
        );
      })}
    </ul>
  );
}
