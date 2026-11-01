import { forwardRef, type ReactNode } from 'react';
import { LayoutTemplate, Loader2, Lock, Maximize2, Minimize2, RotateCcw, Search } from 'lucide-react';
import type { SiteMapAnalysis } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import type { ScreenStatus } from './layoutGraph';

export interface GraphFilters {
  statuses: ScreenStatus[];
  authOnly: boolean;
}

const STATUS_FILTERS: { status: ScreenStatus; label: string; title: string; dot: string }[] = [
  { status: 'failed', label: '실패', title: '실패한 요소가 있는 화면', dot: 'bg-destructive' },
  { status: 'passed', label: '통과', title: '모든 요소가 확인된 화면', dot: 'bg-success' },
  { status: 'neutral', label: '미확인', title: '확인 전 화면', dot: 'bg-muted-foreground' },
];

/** 켜고 끄는 필터 버튼. 켜지면 파란 테두리와 옅은 파란 바탕으로 보인다. */
function Toggle({ active, onClick, children, title }: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <Button
      type="button"
      size="xs"
      variant={active ? 'secondary' : 'outline'}
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={cn('gap-1.5 font-medium', active && 'bg-primary-subtle')}
    >
      {children}
    </Button>
  );
}

/**
 * 그래프 위 도구 줄. 검색(Enter 로 다음 일치 화면으로 이동, / 로 바로 입력), 상태 · 로그인 필터(배치는 그대로
 * 두고 흐리게만), 공용 메뉴 연결 표시, 자동 배치 복원, 전체 화면, 분석 진행 안내.
 */
export const GraphToolbar = forwardRef<HTMLInputElement, {
  query: string;
  matchCount: number;
  matchIndex: number;
  onQuery: (value: string) => void;
  onSearchNext: (backward: boolean) => void;
  filters: GraphFilters;
  onFilters: (filters: GraphFilters) => void;
  counts: Record<ScreenStatus, number> & { screens: number; transitions: number; auth: number };
  showMenuLinks: boolean;
  onShowMenuLinks: (value: boolean) => void;
  moved: boolean;
  onResetLayout: () => void;
  fullscreen: boolean;
  onFullscreen: () => void;
  analysis: SiteMapAnalysis;
  liveScreens: number;
  viewSwitch?: ReactNode;
}>(function GraphToolbar(
  {
    query, matchCount, matchIndex, onQuery, onSearchNext,
    filters, onFilters, counts, showMenuLinks, onShowMenuLinks,
    moved, onResetLayout, fullscreen, onFullscreen, analysis, liveScreens, viewSwitch,
  },
  searchRef
) {
  const toggleStatus = (status: ScreenStatus) =>
    onFilters({
      ...filters,
      statuses: filters.statuses.includes(status)
        ? filters.statuses.filter((s) => s !== status)
        : [...filters.statuses, status],
    });
  const running = analysis.status === 'RUNNING';
  const found = Math.max(analysis.screenCount, liveScreens);
  const percent = analysis.screenCount > 0 ? Math.min(100, Math.round((analysis.processedCount / analysis.screenCount) * 100)) : 0;

  return (
    <div className="relative z-10 border-b border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <div className="mr-2 leading-tight">
          <p className="text-sm font-semibold text-foreground">화면 구조</p>
          <p className="hidden text-xs text-muted-foreground @4xl:block">
            화면 {counts.screens}개 · 연결 {counts.transitions}개
          </p>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onSearchNext(e.shiftKey);
              }
              if (e.key === 'Escape') {
                onQuery('');
                e.currentTarget.blur();
              }
            }}
            placeholder="화면 검색 · Enter 로 이동"
            aria-label="화면 검색"
            className="h-8 w-60 pl-8 pr-12 text-[13px]"
            data-testid="structure-graph-search"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs tabular-nums text-muted-foreground">
            {query ? (
              matchCount === 0 ? '0/0' : `${matchIndex + 1}/${matchCount}`
            ) : (
              <kbd className="rounded border border-border px-1 font-sans">/</kbd>
            )}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="상태 필터">
          {STATUS_FILTERS.map((f) => (
            <Toggle key={f.status} active={filters.statuses.includes(f.status)} onClick={() => toggleStatus(f.status)} title={f.title}>
              <span className={cn('h-2 w-2 rounded-full', f.dot)} />
              {f.label}
              <span className="tabular-nums text-muted-foreground">{counts[f.status]}</span>
            </Toggle>
          ))}
          <Toggle
            active={filters.authOnly}
            onClick={() => onFilters({ ...filters, authOnly: !filters.authOnly })}
            title="로그인해야 열리는 화면만"
          >
            <Lock className="h-3.5 w-3.5 text-warning" />
            로그인 필요
            <span className="tabular-nums text-muted-foreground">{counts.auth}</span>
          </Toggle>
          <Toggle active={showMenuLinks} onClick={() => onShowMenuLinks(!showMenuLinks)} title="공용 메뉴에서 각 화면으로 가는 링크를 선으로 보여 줍니다">
            <LayoutTemplate className="h-3.5 w-3.5 text-info" />
            공용 메뉴 연결
          </Toggle>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {moved && (
            <Button type="button" size="xs" variant="outline" onClick={onResetLayout} className="gap-1 font-medium" title="옮긴 화면을 자동 배치로 되돌립니다">
              <RotateCcw className="h-3.5 w-3.5" /> 자동 배치
            </Button>
          )}
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={onFullscreen}
            className="w-8 px-0"
            title={fullscreen ? '전체 화면 끝내기 (Esc)' : '전체 화면'}
            aria-label={fullscreen ? '전체 화면 끝내기' : '전체 화면'}
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          {viewSwitch}
        </div>
      </div>

      {running && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border bg-primary-subtle px-4 py-2" role="status" data-testid="structure-graph-progress">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            분석 중
          </span>
          <span className="text-xs text-foreground">
            화면 분석 중... ({found}개 화면 탐색됨{analysis.screenCount > 0 ? ` · 요소 ${analysis.processedCount}/${analysis.screenCount}` : ''})
          </span>
          <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-border" aria-hidden="true">
            <div
              className={cn('h-full rounded-full bg-primary transition-[width] duration-500', analysis.screenCount === 0 && 'w-1/3 animate-pulse')}
              style={analysis.screenCount > 0 ? { width: `${percent}%` } : undefined}
            />
          </div>
          <span className="text-xs text-muted-foreground">끝나면 완성된 그래프를 한 번에 그립니다.</span>
        </div>
      )}
    </div>
  );
});
