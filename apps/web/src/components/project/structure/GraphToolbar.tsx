import { forwardRef, type ReactNode } from 'react';
import { LayoutTemplate, Lock, Maximize2, Minimize2, RotateCcw, Search } from 'lucide-react';
import type { SiteMapAnalysis } from '@/types';
import type { ScreenStatus } from './layoutGraph';

export interface GraphFilters {
  statuses: ScreenStatus[];
  authOnly: boolean;
}

const STATUS_FILTERS: { status: ScreenStatus; label: string; title: string; color: string }[] = [
  { status: 'failed', label: 'FAIL', title: '실패한 요소가 있는 화면', color: 'var(--sg-fail)' },
  { status: 'passed', label: 'PASS', title: '모든 요소가 확인된 화면', color: 'var(--sg-pass)' },
  { status: 'neutral', label: 'UNVERIFIED', title: '확인 전 화면', color: 'var(--c-muted)' },
];

const pad2 = (n: number) => String(n).padStart(2, '0');

function Toggle({ active, onClick, children, title, color = 'var(--c-cyan)' }: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  color?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className="sg-mono inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[2px] border px-2 text-[10px] font-semibold tracking-wider transition-colors"
      style={
        active
          ? { borderColor: color, color, background: `color-mix(in oklab, ${color} 12%, transparent)`, boxShadow: `0 0 14px -4px ${color}` }
          : { borderColor: 'var(--c-line-2)', color: 'var(--c-muted)', background: 'var(--c-bg-2)' }
      }
    >
      {children}
    </button>
  );
}

/**
 * 그래프 위 명령 줄. 검색(Enter 로 다음 일치 화면으로 이동, / 로 바로 입력), 상태 · 인증 필터(배치는 그대로
 * 두고 흐리게만), 공용 메뉴 링크 표시, 자동 배치 복원, 전체 화면, 분석 진행 배너.
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
  const cells = 48;
  const filled = analysis.screenCount > 0 ? Math.round((analysis.processedCount / analysis.screenCount) * cells) : 0;

  return (
    <div className="sg-bar relative z-10 border-b">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="mr-1 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-[2px] border border-[var(--c-cyan)]/60 bg-[var(--c-cyan)]/10 text-[13px] text-[var(--c-cyan)] shadow-[0_0_12px_-3px_var(--c-cyan)]">
            ◈
          </span>
          <div className="leading-none">
            <p className="sg-mono text-[11px] font-bold tracking-[0.16em] text-[var(--c-text)]">SCREEN ONTOLOGY</p>
            <p className="sg-sub mt-0.5">화면 구조 그래프</p>
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--c-cyan)]" />
          <input
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
            className="sg-input h-7 w-60 pl-7 pr-12 text-[11px]"
            data-testid="structure-graph-search"
          />
          <span className="sg-mono pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-[var(--c-dim)]">
            {query ? (matchCount === 0 ? '0/0' : `${matchIndex + 1}/${matchCount}`) : <kbd className="rounded-[2px] border border-[var(--c-line-2)] px-1">/</kbd>}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="상태 필터">
          {STATUS_FILTERS.map((f) => (
            <Toggle key={f.status} active={filters.statuses.includes(f.status)} onClick={() => toggleStatus(f.status)} title={f.title} color={f.color}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: f.color }} />
              {f.label}
              <span className="tabular-nums opacity-70">{pad2(counts[f.status])}</span>
            </Toggle>
          ))}
          <Toggle
            active={filters.authOnly}
            onClick={() => onFilters({ ...filters, authOnly: !filters.authOnly })}
            title="로그인해야 열리는 화면만"
            color="var(--c-amber)"
          >
            <Lock className="h-3 w-3" />
            AUTH
            <span className="tabular-nums opacity-70">{pad2(counts.auth)}</span>
          </Toggle>
          <Toggle active={showMenuLinks} onClick={() => onShowMenuLinks(!showMenuLinks)} title="공용 메뉴에서 각 화면으로 가는 링크를 선으로 보여 줍니다" color="var(--c-blue)">
            <LayoutTemplate className="h-3 w-3" />
            MENU LINKS
          </Toggle>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="sg-mono hidden text-[10px] tracking-wider text-[var(--c-dim)] @4xl:inline">
            NODES <b className="text-[var(--c-text)]">{pad2(counts.screens)}</b> · EDGES <b className="text-[var(--c-text)]">{pad2(counts.transitions)}</b>
          </span>
          {moved && (
            <button
              type="button"
              onClick={onResetLayout}
              className="sg-mono inline-flex h-7 cursor-pointer items-center gap-1 rounded-[2px] border border-[var(--c-line-2)] bg-[var(--c-bg-2)] px-2 text-[10px] tracking-wider text-[var(--c-muted)] hover:border-[var(--c-cyan)] hover:text-[var(--c-cyan)]"
              title="옮긴 화면을 자동 배치로 되돌립니다"
            >
              <RotateCcw className="h-3 w-3" /> AUTO LAYOUT
            </button>
          )}
          <button
            type="button"
            onClick={onFullscreen}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[2px] border border-[var(--c-line-2)] bg-[var(--c-bg-2)] text-[var(--c-muted)] hover:border-[var(--c-cyan)] hover:text-[var(--c-cyan)]"
            title={fullscreen ? '전체 화면 끝내기 (Esc)' : '전체 화면'}
            aria-label={fullscreen ? '전체 화면 끝내기' : '전체 화면'}
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          {viewSwitch}
        </div>
      </div>

      {running && (
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--c-line-2)] bg-[var(--c-cyan)]/[0.04] px-3 py-1.5" role="status" data-testid="structure-graph-progress">
          <span className="sg-mono flex items-center gap-1.5 text-[10px] font-bold tracking-[0.16em] text-[var(--c-cyan)]">
            <span className="sg-live h-1.5 w-1.5 rounded-full bg-[var(--c-cyan)] shadow-[0_0_8px_var(--c-cyan)]" />
            INGEST
          </span>
          <span className="text-[11px] text-[var(--c-text)]">
            화면 분석 중... ({found}개 화면 탐색됨{analysis.screenCount > 0 ? ` · 요소 ${analysis.processedCount}/${analysis.screenCount}` : ''})
          </span>
          <div className="flex flex-1 gap-[2px]" aria-hidden="true">
            {Array.from({ length: cells }, (_, i) => (
              <span
                key={i}
                className="sg-cell h-2 flex-1 rounded-[1px]"
                data-on={i < filled}
                data-head={analysis.screenCount === 0 ? i % 12 === 0 : i === filled}
              />
            ))}
          </div>
          <span className="text-[10px] text-[var(--c-muted)]">끝나면 완성된 그래프를 한 번에 그립니다.</span>
        </div>
      )}
    </div>
  );
});
