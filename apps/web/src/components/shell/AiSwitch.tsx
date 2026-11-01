import { cn } from '@/lib/utils';

const NO_KEY_HINT = '관리자가 AI 설정에서 키를 등록해야 켤 수 있습니다';

/**
 * 상단바의 AI 스위치. 끄면 화면은 그대로이고 AI 기능(우하단 채팅 · AI 버튼)만 사라진다.
 * AI 키가 없으면(available=false) 켤 수 없으므로 비활성으로 두고, 이유를 title 로 알려 준다.
 * 상태는 props 로 받는다 — TopBar 가 useAiEnabled() 값을 넘긴다.
 */
export function AiSwitch({
  available,
  enabled,
  onChange,
}: {
  available: boolean;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="AI 기능"
      disabled={!available}
      title={available ? `AI 기능 ${enabled ? '끄기' : '켜기'}` : NO_KEY_HINT}
      onClick={() => {
        if (available) onChange(!enabled);
      }}
      className={cn(
        'flex h-9 shrink-0 items-center gap-2 rounded-lg px-2.5 text-xs font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ai-accent',
        available
          ? 'cursor-pointer text-foreground hover:bg-accent'
          : 'cursor-not-allowed text-muted-foreground'
      )}
    >
      <span>AI</span>
      {/* 작은 토글: 켜면 AI 강조색 바탕에 흰 점이 오른쪽으로 간다 */}
      <span
        aria-hidden="true"
        className={cn(
          'relative h-4 w-7 shrink-0 rounded-full border transition-colors',
          enabled ? 'border-ai-accent bg-ai-accent' : 'border-border bg-muted'
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-2.5 w-2.5 rounded-full transition-transform',
            enabled ? 'translate-x-3 bg-ai-accent-foreground' : 'bg-muted-foreground'
          )}
        />
      </span>
    </button>
  );
}
