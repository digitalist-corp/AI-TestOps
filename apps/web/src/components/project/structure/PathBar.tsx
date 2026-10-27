import { Fragment, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronLeft, ChevronRight, GripVertical, Loader2, Play, Trash2, TriangleAlert, X } from 'lucide-react';
import type { SiteMapNode } from '@/types';
import type { Connection, PathChip, PathSegment } from './usePathSelection';

export const DEFAULT_PATH_INSTRUCTION = '선택한 화면 경로 순서대로 기본 탐색 및 동작 검증';

const pad2 = (n: number) => String(n).padStart(2, '0');

function Chip({ chip, index, count, node, onMove, onRemove, onFocus }: {
  chip: PathChip;
  index: number;
  count: number;
  node: SiteMapNode | undefined;
  onMove: (chipId: string, delta: number) => void;
  onRemove: (chipId: string) => void;
  onFocus: (routeKey: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chip.chipId });
  const missing = node?.stale ? (node.origin === 'SITE' ? '탐색에서 사라짐' : '코드에 없음') : null;
  const controls = 'flex h-5 w-5 cursor-pointer items-center justify-center text-[var(--c-muted)] hover:bg-[var(--c-cyan)] hover:text-[#021018] disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-[var(--c-muted)]';
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className="group/chip sg-chip relative shrink-0"
      data-testid="structure-path-chip"
    >
      <div
        {...attributes}
        {...listeners}
        onClick={() => onFocus(chip.routeKey)}
        className={`flex h-9 cursor-grab items-stretch overflow-hidden rounded-[2px] border bg-[var(--c-bg-2)] transition-[border-color,box-shadow] active:cursor-grabbing ${
          isDragging
            ? 'border-[var(--c-cyan)] shadow-[0_0_24px_-4px_var(--c-cyan)]'
            : 'border-[var(--c-line-2)] hover:border-[var(--c-cyan)]/70'
        }`}
        title={`${node?.title ?? chip.routeKey} — 끌어서 순서를 바꿉니다`}
        aria-label={`${index + 1}단계 ${chip.routeKey}`}
      >
        <span className="sg-mono flex w-8 items-center justify-center bg-[var(--c-cyan)] text-[11px] font-bold text-[#021018]">
          {pad2(index + 1)}
        </span>
        <span className="flex flex-col justify-center px-2 leading-tight">
          <span className="sg-mono max-w-40 truncate text-[11px] font-semibold text-[var(--c-text)]">{chip.routeKey}</span>
          <span className="max-w-40 truncate text-[9px] text-[var(--c-muted)]">{node?.title ?? ' '}</span>
        </span>
        {(node?.excluded || missing) && (
          <span className="sg-mono flex items-center gap-1 pr-2 text-[9px] font-bold text-[var(--c-amber)]" title={[node?.excluded && '제외됨', missing].filter(Boolean).join(' · ')}>
            {node?.excluded && 'EXCL'} {missing && 'MISSING'}
          </span>
        )}
        <GripVertical className="mr-1 h-3.5 w-3.5 self-center text-[var(--c-dim)]" />
      </div>
      <div className="sg-hud pointer-events-none absolute -top-6 left-1/2 flex -translate-x-1/2 opacity-0 transition-opacity group-focus-within/chip:pointer-events-auto group-focus-within/chip:opacity-100 group-hover/chip:pointer-events-auto group-hover/chip:opacity-100">
        <button type="button" disabled={index === 0} onClick={() => onMove(chip.chipId, -1)} className={controls} aria-label="앞으로 옮기기" title="앞으로 ◀">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button type="button" disabled={index === count - 1} onClick={() => onMove(chip.chipId, 1)} className={controls} aria-label="뒤로 옮기기" title="뒤로 ▶">
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onRemove(chip.chipId)}
          className="flex h-5 w-5 cursor-pointer items-center justify-center text-[var(--c-muted)] hover:bg-[var(--c-red)] hover:text-white"
          aria-label="경로에서 빼기"
          title="빼기 ✕"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

const CONNECTOR: Record<Connection, { label: string; title: string; color: string; dash: string }> = {
  direct: { label: 'LINK', title: '화면 전환으로 이어집니다', color: 'var(--c-cyan)', dash: '0' },
  menu: { label: 'MENU', title: '공용 메뉴로 이어집니다', color: 'var(--c-blue)', dash: '1 3' },
  same: { label: 'STAY', title: '같은 화면에 머무릅니다', color: 'var(--c-muted)', dash: '0' },
  none: { label: 'NO LINK', title: '직접 전환이 없는 화면 간 연결', color: 'var(--c-amber)', dash: '3 3' },
};

function Connector({ segment }: { segment: PathSegment | undefined }) {
  if (!segment) return null;
  const view = CONNECTOR[segment.connection];
  return (
    <li className="flex w-16 shrink-0 flex-col items-center gap-0.5" title={view.title} aria-label={view.title} data-connection={segment.connection}>
      <span className={`sg-mono text-[8px] font-bold tracking-widest ${segment.connection === 'none' ? 'sg-live' : ''}`} style={{ color: view.color }}>
        {view.label}
      </span>
      <svg width="64" height="8" viewBox="0 0 64 8" aria-hidden="true">
        <line x1="2" y1="4" x2="56" y2="4" strokeWidth="1.5" strokeDasharray={view.dash} style={{ stroke: view.color }} />
        <path d="M 55 1 L 61 4 L 55 7" fill="none" strokeWidth="1.5" style={{ stroke: view.color }} />
        {segment.connection !== 'none' && (
          <rect y="3" width="6" height="2" style={{ fill: view.color, filter: `drop-shadow(0 0 3px ${view.color})` }}>
            <animate attributeName="x" from="2" to="52" dur="1.4s" repeatCount="indefinite" />
          </rect>
        )}
      </svg>
    </li>
  );
}

/**
 * 하단 시퀀스 표시줄. 고른 화면을 순서대로 칩으로 보여 주고, 끌거나 ◀ ▶ 로 순서를 바꾼다.
 * 요청 문장을 비워 두면 기본 문장으로 바로 생성한다.
 */
export function PathBar({ chips, segments, brokenCount, nodeByRoute, instruction, busy, onInstruction, onMove, onReorder, onRemove, onClear, onFocus, onGenerate }: {
  chips: PathChip[];
  segments: PathSegment[];
  brokenCount: number;
  nodeByRoute: Map<string, SiteMapNode>;
  instruction: string;
  busy: boolean;
  onInstruction: (value: string) => void;
  onMove: (chipId: string, delta: number) => void;
  onReorder: (activeId: string, overId: string) => void;
  onRemove: (chipId: string) => void;
  onClear: () => void;
  onFocus: (routeKey: string) => void;
  onGenerate: () => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [focused, setFocused] = useState(false);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id));
  };

  return (
    <div className="sg-bar relative border-t px-3 py-2" data-testid="structure-path-bar">
      {chips.length > 0 && <div className="sg-shimmer absolute inset-x-0 top-0 h-px" />}
      <div className="flex flex-col gap-2 @5xl:flex-row @5xl:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="shrink-0 leading-none">
            <p className="sg-mono text-[11px] font-bold tracking-[0.16em] text-[var(--c-cyan)]">SEQUENCE</p>
            <p className="sg-sub mt-1">
              테스트 경로 · <span className="sg-mono">{pad2(chips.length)} STEPS</span>
            </p>
          </div>
          <span className="h-8 w-px shrink-0 bg-[var(--c-line-2)]" />
          {chips.length === 0 ? (
            <p className="sg-hint flex items-center gap-2 text-[11px] text-[var(--c-muted)]">
              <span className="sg-add inline-flex h-[18px] w-[18px] items-center justify-center rounded-[2px] text-[11px] font-bold">+</span>
              화면 카드의 + 를 순서대로 눌러 담으면 그 흐름을 따라가는 테스트를 만듭니다. 같은 화면을 다시 담아 되돌아가는 흐름도 만들 수 있습니다.
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={chips.map((c) => c.chipId)} strategy={horizontalListSortingStrategy}>
                <ol className="flex min-w-0 flex-1 items-center overflow-x-auto px-1 pb-1 pt-6" aria-label="테스트 경로 단계">
                  {chips.map((chip, index) => (
                    <Fragment key={chip.chipId}>
                      <Chip
                        chip={chip}
                        index={index}
                        count={chips.length}
                        node={nodeByRoute.get(chip.routeKey)}
                        onMove={onMove}
                        onRemove={onRemove}
                        onFocus={onFocus}
                      />
                      <Connector segment={segments[index]} />
                    </Fragment>
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          )}
          {chips.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 cursor-pointer rounded-[2px] p-1.5 text-[var(--c-dim)] hover:bg-[var(--c-red)]/15 hover:text-[var(--c-red)]"
              title="경로 비우기"
              aria-label="경로 비우기"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {brokenCount > 0 && (
            <span
              className="sg-mono inline-flex shrink-0 items-center gap-1.5 rounded-[2px] border border-[var(--c-amber)]/60 bg-[var(--c-amber)]/10 px-2 py-1 text-[10px] font-semibold text-[var(--c-amber)]"
              title="분석에서 두 화면 사이의 전환을 찾지 못했습니다. 분석이 놓쳤을 수 있어 생성은 막지 않습니다."
              data-testid="structure-path-broken"
            >
              <TriangleAlert className="h-3.5 w-3.5" />
              직접 전환이 없는 화면 간 연결 {brokenCount}곳
            </span>
          )}
          <input
            value={instruction}
            onChange={(e) => onInstruction(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && chips.length > 0 && !busy) onGenerate();
            }}
            placeholder={DEFAULT_PATH_INSTRUCTION}
            aria-label="테스트로 확인할 내용"
            className={`sg-input h-9 px-3 text-[11px] transition-[width] duration-300 ${focused || instruction ? 'w-80' : 'w-60'}`}
          />
          <button
            type="button"
            disabled={chips.length === 0 || busy}
            onClick={onGenerate}
            className="sg-execute inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-[2px] px-4 text-xs font-bold disabled:cursor-not-allowed"
            data-testid="structure-path-generate"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
            <span className="sg-mono tracking-wider">EXECUTE</span>
            <span className="opacity-60">·</span>
            이 경로로 테스트 만들기
          </button>
        </div>
      </div>
    </div>
  );
}
