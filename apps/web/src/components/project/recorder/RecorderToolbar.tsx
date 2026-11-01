import { CornerDownLeft, Eye, MousePointerClick, TextCursorInput, Type, type LucideIcon } from 'lucide-react';
import { RECORDER_MODES, type RecorderMode } from '@/lib/recorder';
import { cn } from '@/lib/utils';

const MODE_ICON: Record<RecorderMode, LucideIcon> = {
  click: MousePointerClick,
  fill: TextCursorInput,
  assertVisible: Eye,
  assertText: Type,
};

/**
 * 녹화 모드 줄: 화면을 눌렀을 때 무엇을 할지 고른다.
 * 키(Enter)는 모드가 아니라 누르는 즉시 보내는 동작이라 따로 둔다.
 */
export function RecorderToolbar({
  mode,
  onModeChange,
  onPressEnter,
  disabled,
}: {
  mode: RecorderMode;
  onModeChange: (mode: RecorderMode) => void;
  onPressEnter: () => void;
  disabled: boolean;
}) {
  const current = RECORDER_MODES.find((item) => item.id === mode) ?? RECORDER_MODES[0];

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="녹화 모드" className="inline-flex rounded-sm border border-border bg-card p-0.5">
          {RECORDER_MODES.map((item) => {
            const Icon = MODE_ICON[item.id];
            const selected = item.id === mode;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onModeChange(item.id)}
                className={cn(
                  'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-sm px-2.5 text-[13px] font-medium transition-colors',
                  selected
                    ? 'bg-primary-subtle text-primary'
                    : 'text-secondary-foreground hover:bg-accent'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onPressEnter}
          disabled={disabled}
          title="사이트에 Enter 키를 누릅니다"
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-sm border border-border bg-card px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
        >
          <CornerDownLeft className="h-3.5 w-3.5" />
          Enter 키
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{current.hint}</p>
    </div>
  );
}
