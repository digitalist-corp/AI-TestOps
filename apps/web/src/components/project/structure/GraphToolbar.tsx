import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ListFilter, Loader2, Search } from 'lucide-react';
import type { CoverageNodeState, SiteMapAnalysis } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { NODE_STATES, NODE_STATE_META } from '@/lib/coverage';
import { cn } from '@/lib/utils';

export interface GraphFilters {
  statuses: CoverageNodeState[];
  authOnly: boolean;
}

type Counts = Record<CoverageNodeState, number> & { screens: number; transitions: number; auth: number };

/** 필터 메뉴 안의 체크 한 줄 */
function CheckRow({ checked, onChange, title, children, count }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
  children: ReactNode;
  count?: number;
}) {
  return (
    <label
      title={title}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-accent"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
      />
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {count != null && <span className="text-xs tabular-nums text-muted-foreground">{count}</span>}
    </label>
  );
}

function MenuHeading({ children }: { children: ReactNode }) {
  return <p className="px-2 pb-0.5 pt-1.5 text-xs font-semibold text-muted-foreground">{children}</p>;
}

/**
 * "필터" 드롭다운 하나로 접은 조건들. 상태 · 로그인 필터는 배치는 그대로 두고 흐리게만 하며,
 * 아래 "그래프에 표시"의 공용 메뉴 연결선 · 미니맵은 보는 방식만 바꾼다.
 */
function FilterMenu({ filters, onFilters, counts, showMenuLinks, onShowMenuLinks, showMiniMap, onShowMiniMap }: {
  filters: GraphFilters;
  onFilters: (filters: GraphFilters) => void;
  counts: Counts;
  showMenuLinks: boolean;
  onShowMenuLinks: (value: boolean) => void;
  showMiniMap: boolean;
  onShowMiniMap: (value: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeCount = filters.statuses.length + (filters.authOnly ? 1 : 0);

  // 바깥을 누르거나 Esc 를 누르면 닫는다. Esc 는 그래프의 상세 패널까지 닫지 않도록 여기서 멈춘다.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  const toggleStatus = (status: CoverageNodeState, on: boolean) =>
    onFilters({
      ...filters,
      statuses: on ? [...filters.statuses, status] : filters.statuses.filter((s) => s !== status),
    });

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        size="xs"
        variant={activeCount > 0 ? 'secondary' : 'outline'}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn('gap-1.5 font-medium', activeCount > 0 && 'bg-primary-subtle')}
      >
        <ListFilter className="h-3.5 w-3.5" />
        필터
        {activeCount > 0 && (
          <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold leading-4 text-primary-foreground tabular-nums">
            {activeCount}
          </span>
        )}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </Button>

      {open && (
        <div
          role="group"
          aria-label="필터"
          className="absolute right-0 top-10 z-30 w-64 rounded-lg border border-border bg-card p-1.5 shadow-lg"
        >
          <MenuHeading>상태</MenuHeading>
          {NODE_STATES.map((state) => (
            <CheckRow
              key={state}
              checked={filters.statuses.includes(state)}
              onChange={(on) => toggleStatus(state, on)}
              title={NODE_STATE_META[state].hint}
              count={counts[state]}
            >
              <span className={cn('h-2 w-2 shrink-0 rounded-full', NODE_STATE_META[state].bar)} />
              {NODE_STATE_META[state].label}
            </CheckRow>
          ))}
          <CheckRow
            checked={filters.authOnly}
            onChange={(on) => onFilters({ ...filters, authOnly: on })}
            title="로그인해야 열리는 화면만"
            count={counts.auth}
          >
            로그인 필요한 화면만
          </CheckRow>

          <div className="my-1.5 border-t border-border" />
          <MenuHeading>그래프에 표시</MenuHeading>
          <CheckRow
            checked={showMenuLinks}
            onChange={onShowMenuLinks}
            title="공용 메뉴에서 각 화면으로 가는 링크를 선으로 보여 줍니다"
          >
            공용 메뉴 연결선
          </CheckRow>
          <CheckRow checked={showMiniMap} onChange={onShowMiniMap} title="오른쪽 아래에 전체 지도를 작게 보여 줍니다">
            미니맵
          </CheckRow>

          {activeCount > 0 && (
            <>
              <div className="my-1.5 border-t border-border" />
              <button
                type="button"
                onClick={() => onFilters({ statuses: [], authOnly: false })}
                className="w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                필터 모두 해제
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 그래프 위 도구 줄. 검색(Enter 로 다음 일치 화면으로 이동, / 로 바로 입력) · 화면 · 연결 수 · 필터 메뉴 ·
 * 그래프 ↔ 목록 전환만 둔다. 분석 중이면 아래에 진행 안내가 붙는다.
 */
export const GraphToolbar = forwardRef<HTMLInputElement, {
  query: string;
  matchCount: number;
  matchIndex: number;
  onQuery: (value: string) => void;
  onSearchNext: (backward: boolean) => void;
  filters: GraphFilters;
  onFilters: (filters: GraphFilters) => void;
  counts: Counts;
  showMenuLinks: boolean;
  onShowMenuLinks: (value: boolean) => void;
  showMiniMap: boolean;
  onShowMiniMap: (value: boolean) => void;
  analysis: SiteMapAnalysis;
  liveScreens: number;
  viewSwitch?: ReactNode;
}>(function GraphToolbar(
  {
    query, matchCount, matchIndex, onQuery, onSearchNext,
    filters, onFilters, counts, showMenuLinks, onShowMenuLinks, showMiniMap, onShowMiniMap,
    analysis, liveScreens, viewSwitch,
  },
  searchRef
) {
  const running = analysis.status === 'RUNNING';
  const found = Math.max(analysis.screenCount, liveScreens);
  const percent = analysis.screenCount > 0 ? Math.min(100, Math.round((analysis.processedCount / analysis.screenCount) * 100)) : 0;

  return (
    <div className="relative z-10 border-b border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
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
            placeholder="화면 이름 · 경로 검색"
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

        <p className="text-sm text-muted-foreground">
          화면 {counts.screens}개 · 연결 {counts.transitions}개
        </p>

        <div className="ml-auto flex items-center gap-2">
          <FilterMenu
            filters={filters}
            onFilters={onFilters}
            counts={counts}
            showMenuLinks={showMenuLinks}
            onShowMenuLinks={onShowMenuLinks}
            showMiniMap={showMiniMap}
            onShowMiniMap={onShowMiniMap}
          />
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
          <span className="text-xs text-muted-foreground">찾은 화면이 지도에 하나씩 나타납니다.</span>
        </div>
      )}
    </div>
  );
});
