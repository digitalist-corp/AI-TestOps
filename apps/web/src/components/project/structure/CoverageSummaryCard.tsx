import { Loader2, TriangleAlert } from 'lucide-react';
import type { CoverageSummary } from '@/types';
import { Button } from '@/components/ui/Button';
import { NODE_STATE_META, progressSegments, summaryText, timeAgo } from '@/lib/coverage';
import { cn } from '@/lib/utils';

/**
 * 구조 탭 맨 위의 쉬운 요약. "화면 12개 중 8개를 테스트로 확인했어요. 2곳에서 막혔어요." 한 문장과
 * 4칸 진행 막대(테스트 통과 · 화면에서 확인됨 · 아직 안 봄 · 막힘), 마지막 실행 시각을 보여 준다.
 * 실행 · 탐색 중이면 위에 "결과가 지도에 바로 반영됩니다" 띠가 붙는다.
 */
export function CoverageSummaryCard({ summary, live, onShowBlocked }: {
  summary: CoverageSummary;
  /** 지금 지도가 바뀌는 중이라면 그 이유 문장 */
  live: string | null;
  onShowBlocked: () => void;
}) {
  const text = summaryText(summary);
  const segments = progressSegments(summary);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card" data-testid="structure-coverage-summary" aria-label="확인 요약">
      {live && (
        <div
          className="flex items-center gap-2 border-b border-primary/20 bg-primary-subtle px-5 py-2 text-[13px] font-medium text-primary"
          role="status"
          data-testid="structure-live-band"
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />
          {live}
        </div>
      )}

      <div className="px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold leading-snug text-foreground">
              {text.headline}
              {text.blocked && <span className="ml-1.5 text-destructive">{text.blocked}</span>}
            </p>
            {text.next && <p className="mt-1 text-sm text-muted-foreground">{text.next}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span
              className="text-xs text-muted-foreground"
              title={summary.lastRunAt ? new Date(summary.lastRunAt).toLocaleString('ko-KR') : '아직 지도에 반영된 테스트 실행이 없어요'}
            >
              {summary.lastRunAt ? `마지막 실행 ${timeAgo(summary.lastRunAt)}` : '실행 기록 없음'}
            </span>
            {summary.blocked > 0 && (
              <Button
                size="xs"
                variant="outline"
                className="border-destructive/50 text-destructive hover:bg-destructive/10"
                onClick={onShowBlocked}
              >
                <TriangleAlert className="h-3.5 w-3.5" />
                막힌 곳 보기
              </Button>
            )}
          </div>
        </div>

        <div
          className="mt-4 flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={segments.map((s) => `${NODE_STATE_META[s.state].label} ${s.count}개`).join(', ')}
        >
          {segments
            .filter((s) => s.count > 0)
            .map((s) => (
              <i
                key={s.state}
                className={cn('h-full transition-[width] duration-700 ease-out motion-reduce:transition-none', NODE_STATE_META[s.state].bar)}
                style={{ width: `${s.percent}%` }}
                title={`${NODE_STATE_META[s.state].label} ${s.count}개 — ${NODE_STATE_META[s.state].hint}`}
              />
            ))}
        </div>

        <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
          {segments.map((s) => (
            <li key={s.state} className="flex cursor-help items-center gap-1.5 text-muted-foreground" title={NODE_STATE_META[s.state].hint}>
              <i className={cn('h-2.5 w-2.5 rounded-full', NODE_STATE_META[s.state].bar)} />
              {NODE_STATE_META[s.state].label}
              <b className={cn('font-semibold tabular-nums', s.state === 'BLOCKED' && s.count > 0 ? 'text-destructive' : 'text-foreground')}>
                {s.count}
              </b>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
