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
import { ChevronLeft, ChevronRight, GripVertical, Loader2, Plus, Sparkles, Trash2, TriangleAlert, X } from 'lucide-react';
import type { SiteMapNode } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAiEnabled } from '@/lib/aiEnabled';
import { cn } from '@/lib/utils';
import type { Connection, PathChip, PathSegment } from './usePathSelection';

export const DEFAULT_PATH_INSTRUCTION = '선택한 화면 경로 순서대로 기본 탐색 및 동작 검증';

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
  const notes = [node?.excluded && '제외됨', missing].filter(Boolean).join(' · ');
  const controls =
    'flex h-6 w-6 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground';
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className="group/chip relative shrink-0"
      data-testid="structure-path-chip"
    >
      <div
        {...attributes}
        {...listeners}
        onClick={() => onFocus(chip.routeKey)}
        className={cn(
          'flex h-11 cursor-grab items-center gap-2 rounded-lg border bg-card pl-1.5 pr-1 transition-[border-color,box-shadow] active:cursor-grabbing',
          isDragging ? 'border-primary shadow-md' : 'border-border hover:border-border-strong'
        )}
        title={`${node?.title ?? chip.routeKey} — 끌어서 순서를 바꿉니다`}
        aria-label={`${index + 1}단계 ${chip.routeKey}`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          {index + 1}
        </span>
        <span className="flex flex-col justify-center leading-tight">
          <span className="max-w-40 truncate font-mono text-xs font-semibold text-foreground">{chip.routeKey}</span>
          <span className="max-w-40 truncate text-[11px] text-muted-foreground">{node?.title ?? ' '}</span>
        </span>
        {notes && (
          <Badge variant="warning" className="px-1.5 py-0 text-[11px]" title={notes}>
            {notes}
          </Badge>
        )}
        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      <div className="pointer-events-none absolute -top-7 left-1/2 flex -translate-x-1/2 overflow-hidden rounded-md border border-border bg-card opacity-0 shadow-sm transition-opacity group-focus-within/chip:pointer-events-auto group-focus-within/chip:opacity-100 group-hover/chip:pointer-events-auto group-hover/chip:opacity-100">
        <button type="button" disabled={index === 0} onClick={() => onMove(chip.chipId, -1)} className={controls} aria-label="앞으로 옮기기" title="앞으로">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" disabled={index === count - 1} onClick={() => onMove(chip.chipId, 1)} className={controls} aria-label="뒤로 옮기기" title="뒤로">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onRemove(chip.chipId)}
          className="flex h-6 w-6 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label="경로에서 빼기"
          title="빼기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

const CONNECTOR: Record<Connection, { label: string; title: string; color: string; dash: string }> = {
  direct: { label: '전환', title: '화면 전환으로 이어집니다', color: 'var(--color-primary)', dash: '0' },
  menu: { label: '공용 메뉴', title: '공용 메뉴로 이어집니다', color: 'var(--color-info)', dash: '2 4' },
  same: { label: '같은 화면', title: '같은 화면에 머무릅니다', color: 'var(--color-muted-foreground)', dash: '0' },
  none: { label: '전환 없음', title: '직접 전환이 없는 화면 간 연결', color: 'var(--color-warning)', dash: '5 4' },
};

function Connector({ segment }: { segment: PathSegment | undefined }) {
  if (!segment) return null;
  const view = CONNECTOR[segment.connection];
  return (
    <li className="flex w-16 shrink-0 flex-col items-center gap-0.5" title={view.title} aria-label={view.title} data-connection={segment.connection}>
      <span className="whitespace-nowrap text-[11px] font-medium" style={{ color: view.color }}>
        {view.label}
      </span>
      <svg width="64" height="8" viewBox="0 0 64 8" aria-hidden="true">
        <line x1="2" y1="4" x2="56" y2="4" strokeWidth="1.5" strokeDasharray={view.dash} strokeLinecap="round" style={{ stroke: view.color }} />
        <path d="M 55 1 L 61 4 L 55 7" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: view.color }} />
      </svg>
    </li>
  );
}

/**
 * 하단 경로 표시줄. 고른 화면을 순서대로 칩으로 보여 주고, 끌거나 ‹ › 로 순서를 바꾼다.
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
  // AI를 끄면 경로 고르기 · 보기만 남기고, 테스트 생성 입력과 버튼은 숨긴다.
  const { active: aiActive } = useAiEnabled();
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id));
  };

  return (
    <div className="relative border-t border-border bg-card px-4 py-3" data-testid="structure-path-bar">
      <div className="flex flex-col gap-3 @5xl:flex-row @5xl:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="shrink-0 leading-tight">
            <p className="text-sm font-semibold text-foreground">테스트 경로</p>
            <p className="text-xs text-muted-foreground">{chips.length}단계</p>
          </div>
          <span className="h-8 w-px shrink-0 bg-border" />
          {chips.length === 0 ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground">
                <Plus className="h-3 w-3" strokeWidth={2.5} />
              </span>
              {aiActive
                ? '화면 카드의 + 를 순서대로 눌러 담으면 그 흐름을 따라가는 테스트를 만듭니다. 같은 화면을 다시 담아 되돌아가는 흐름도 만들 수 있습니다.'
                : '화면 카드의 + 를 순서대로 눌러 담으면 그 흐름이 그래프에 표시됩니다. 같은 화면을 다시 담아 되돌아가는 흐름도 볼 수 있습니다.'}
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={chips.map((c) => c.chipId)} strategy={horizontalListSortingStrategy}>
                <ol className="flex min-w-0 flex-1 items-center overflow-x-auto px-1 pb-1 pt-8" aria-label="테스트 경로 단계">
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
              className="shrink-0 cursor-pointer rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              title="경로 비우기"
              aria-label="경로 비우기"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {brokenCount > 0 && (
            <Badge
              variant="warning"
              className="px-2.5 py-1"
              title="분석에서 두 화면 사이의 전환을 찾지 못했습니다. 분석이 놓쳤을 수 있어 생성은 막지 않습니다."
              data-testid="structure-path-broken"
            >
              <TriangleAlert className="h-3.5 w-3.5" />
              직접 전환이 없는 화면 간 연결 {brokenCount}곳
            </Badge>
          )}
          {aiActive && (
            <>
              <Input
                value={instruction}
                onChange={(e) => onInstruction(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && chips.length > 0 && !busy) onGenerate();
                }}
                placeholder={DEFAULT_PATH_INSTRUCTION}
                aria-label="테스트로 확인할 내용"
                className={cn('h-10 text-[13px] transition-[width] duration-300', focused || instruction ? 'w-80' : 'w-60')}
              />
              <Button
                type="button"
                size="sm"
                disabled={chips.length === 0 || busy}
                onClick={onGenerate}
                data-testid="structure-path-generate"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                이 경로로 테스트 만들기
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
