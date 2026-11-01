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
  hasRecordedWork,
  stepIconKey,
  stepKindLabel,
  valueFieldLabel,
  type StepEdit,
  type StepIconKey,
} from '@/lib/recorder';
import { cn } from '@/lib/utils';

/** 서버가 받는 입력 값의 최대 길이 */
const MAX_VALUE_LENGTH = 10_000;

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
  onEdit,
}: {
  step: RecordedStep;
  index: number;
  total: number;
  disabled: boolean;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  onEdit: (id: string, patch: StepEdit) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(step.label);
  const [draftValue, setDraftValue] = useState(step.value ?? '');
  // 취소(Esc)로 입력칸이 사라질 때 따라오는 blur 가 저장으로 이어지지 않게 한다.
  const skipCommit = useRef(false);

  const Icon = STEP_ICON[stepIconKey(step)];
  const valueText = describeStepValue(step);
  const valueLabel = valueFieldLabel(step); // 값을 고칠 수 없는 단계(클릭 · 확인 · 비밀번호)는 null

  const startEdit = () => {
    skipCommit.current = false;
    setDraftLabel(step.label);
    setDraftValue(step.value ?? '');
    setEditing(true);
  };
  const commit = () => {
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }
    setEditing(false);
    onEdit(step.id, { label: draftLabel, ...(valueLabel ? { value: draftValue } : {}) });
  };
  const cancel = () => {
    skipCommit.current = true;
    setEditing(false);
  };

  const onEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return; // 한글 조합 중의 Enter 는 글자 확정이다
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      cancel();
    }
  };

  return (
    <li
      className="flex gap-2 border-b border-border px-3 py-2.5 last:border-b-0"
      // 이 줄 안의 입력칸들 사이에서 포커스가 옮겨 다닐 때는 확정하지 않고, 줄 밖으로 나갈 때 확정한다.
      onBlur={(e) => {
        if (editing && !e.currentTarget.contains(e.relatedTarget as Node | null)) commit();
      }}
    >
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-secondary-foreground">
        {index + 1}
      </span>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-label={stepKindLabel(step)} />
          {editing ? (
            <input
              autoFocus
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              onKeyDown={onEditKeyDown}
              aria-label="단계 설명 수정"
              className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-card px-2 text-sm text-foreground"
            />
          ) : (
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={step.label}>
              {step.label}
            </p>
          )}
        </div>

        {editing && valueLabel && (
          <label className="block space-y-0.5">
            <span className="text-[11px] text-muted-foreground">{valueLabel}</span>
            <input
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              onKeyDown={onEditKeyDown}
              maxLength={MAX_VALUE_LENGTH}
              aria-label={`${valueLabel} 수정`}
              spellCheck={false}
              className="h-7 w-full rounded-sm border border-border bg-card px-2 font-mono text-xs text-foreground"
            />
          </label>
        )}
        {editing && step.secretEnv && (
          <p className="text-[11px] text-muted-foreground">
            비밀번호는 값을 저장하지 않아요. 환경변수 {step.secretEnv} 로 넣어요.
          </p>
        )}

        {step.selector && (
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={step.selector}>
            {step.selector}
          </p>
        )}

        {!editing && (
          <div className="flex flex-wrap items-center gap-1.5">
            {valueText && (
              <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-secondary-foreground">
                {step.secretEnv && <KeyRound className="h-3 w-3 shrink-0" />}
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
        )}
        {editing && step.fragile && (
          <Badge variant="warning">
            <TriangleAlert className="h-3 w-3" />
            순번 의존
          </Badge>
        )}
      </div>

      <div className="flex shrink-0 items-start gap-0.5">
        <IconButton label="위로" disabled={disabled || editing || index === 0} onClick={() => onMove(step.id, -1)}>
          <ArrowUp className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label="아래로" disabled={disabled || editing || index === total - 1} onClick={() => onMove(step.id, 1)}>
          <ArrowDown className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          label={editing ? '수정 저장' : '설명 · 값 수정'}
          disabled={disabled}
          keepFocus={editing}
          onClick={editing ? commit : startEdit}
        >
          {editing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
        </IconButton>
        <IconButton label="삭제" danger disabled={disabled || editing} onClick={() => onRemove(step.id)}>
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </li>
  );
}

/**
 * 오른쪽 단계 목록: 번호 · 아이콘 · 설명 · 셀렉터.
 * 삭제 · 순서 · 설명 · 값 수정은 위(RecorderTab)에서 서버에 반영한다.
 * 값(입력할 글자 · 키 · 기대 글자 · 이동 주소)은 비밀번호 단계를 뺀 나머지에서 고칠 수 있다.
 */
export function RecorderStepList({
  steps,
  disabled,
  saving,
  onMove,
  onRemove,
  onEdit,
}: {
  steps: RecordedStep[];
  /** 동작 중이거나 저장 중이라 편집을 막는 상태 */
  disabled: boolean;
  saving: boolean;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  onEdit: (id: string, patch: StepEdit) => void;
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
        <>
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
                onEdit={onEdit}
              />
            ))}
            <li ref={endRef} aria-hidden className="h-0" />
          </ol>
          {/* 시작할 때 서버가 붙여 주는 첫 이동 단계만 있을 때: 다음에 뭘 하면 되는지 알려 준다 */}
          {!hasRecordedWork(steps) && (
            <p className="border-t border-border px-3 py-3 text-center text-xs text-muted-foreground">
              첫 이동은 자동으로 기록됐어요. 왼쪽 화면을 눌러 이어서 만들어 보세요.
            </p>
          )}
        </>
      )}
    </div>
  );
}
