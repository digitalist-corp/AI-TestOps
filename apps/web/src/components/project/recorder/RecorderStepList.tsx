import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CornerDownLeft,
  Eye,
  Globe,
  KeyRound,
  Loader2,
  MousePointerClick,
  Pencil,
  TextCursorInput,
  Trash2,
  TriangleAlert,
  Type,
  type LucideIcon,
} from 'lucide-react';
import type { RecordedStep } from '@/types';
import { Badge } from '@/components/ui/Badge';
import {
  describeStepValue,
  stepIconKey,
  stepKindLabel,
  type StepIconKey,
} from '@/lib/recorder';
import { cn } from '@/lib/utils';

const STEP_ICON: Record<StepIconKey, LucideIcon> = {
  globe: Globe,
  click: MousePointerClick,
  input: TextCursorInput,
  key: CornerDownLeft,
  eye: Eye,
  text: Type,
};

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  keepFocus,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** 누를 때 입력칸의 포커스가 먼저 빠지지 않게 한다 (blur 로 확정된 뒤 클릭이 다시 열리는 것을 막음) */
  keepFocus?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
      disabled={disabled}
      className={cn(
        'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors',
        'hover:bg-accent disabled:cursor-not-allowed disabled:text-border disabled:hover:bg-transparent',
        danger ? 'hover:text-destructive' : 'hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

function StepRow({
  step,
  index,
  total,
  disabled,
  onMove,
  onRemove,
  onRename,
}: {
  step: RecordedStep;
  index: number;
  total: number;
  disabled: boolean;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, label: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(step.label);
  const Icon = STEP_ICON[stepIconKey(step)];
  const valueText = describeStepValue(step);

  const startEdit = () => {
    setDraft(step.label);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    onRename(step.id, draft);
  };

  return (
    <li className="flex gap-2 border-b border-border px-3 py-2.5 last:border-b-0">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-secondary-foreground">
        {index + 1}
      </span>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-label={stepKindLabel(step)} />
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                } else if (e.key === 'Escape') {
                  setEditing(false);
                }
              }}
              aria-label="단계 설명 수정"
              className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-card px-2 text-sm text-foreground"
            />
          ) : (
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={step.label}>
              {step.label}
            </p>
          )}
        </div>

        {step.selector && (
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={step.selector}>
            {step.selector}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {valueText && (
            <span className="inline-flex items-center gap-1 text-[11px] text-secondary-foreground">
              {step.secretEnv && <KeyRound className="h-3 w-3" />}
              <span className="truncate">{valueText}</span>
            </span>
          )}
          {step.fragile && (
            <Badge variant="warning" title="순번(.nth)에 기대는 셀렉터라 화면이 바뀌면 깨질 수 있어요">
              <TriangleAlert className="h-3 w-3" />
              순번 의존
            </Badge>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-start gap-0.5">
        <IconButton label="위로" disabled={disabled || editing || index === 0} onClick={() => onMove(step.id, -1)}>
          <ArrowUp className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label="아래로" disabled={disabled || editing || index === total - 1} onClick={() => onMove(step.id, 1)}>
          <ArrowDown className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label={editing ? '설명 저장' : '설명 수정'} disabled={disabled} keepFocus={editing} onClick={editing ? commit : startEdit}>
          {editing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
        </IconButton>
        <IconButton label="삭제" danger disabled={disabled || editing} onClick={() => onRemove(step.id)}>
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </li>
  );
}

/** 오른쪽 단계 목록: 번호 · 아이콘 · 설명 · 셀렉터. 삭제 · 순서 · 설명 수정은 위에서 서버에 반영한다. */
export function RecorderStepList({
  steps,
  disabled,
  saving,
  onMove,
  onRemove,
  onRename,
}: {
  steps: RecordedStep[];
  /** 동작 중이거나 저장 중이라 편집을 막는 상태 */
  disabled: boolean;
  saving: boolean;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, label: string) => void;
}) {
  // 단계가 새로 생기면 목록 맨 아래가 보이게 따라간다.
  const endRef = useRef<HTMLLIElement>(null);
  const prevCount = useRef(steps.length);
  useEffect(() => {
    if (steps.length > prevCount.current) endRef.current?.scrollIntoView({ block: 'nearest' });
    prevCount.current = steps.length;
  }, [steps.length]);

  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <h3 className="text-sm font-bold text-foreground">
          기록된 단계 <span className="font-normal text-muted-foreground">{steps.length}개</span>
        </h3>
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="저장 중" />}
      </div>

      {steps.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-muted-foreground">
          아직 기록된 단계가 없어요.
          <br />
          왼쪽 화면을 눌러 보세요.
        </p>
      ) : (
        <ol className="max-h-[60vh] overflow-y-auto">
          {steps.map((step, index) => (
            <StepRow
              key={step.id}
              step={step}
              index={index}
              total={steps.length}
              disabled={disabled}
              onMove={onMove}
              onRemove={onRemove}
              onRename={onRename}
            />
          ))}
          <li ref={endRef} aria-hidden className="h-0" />
        </ol>
      )}
    </div>
  );
}
