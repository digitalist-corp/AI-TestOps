import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Briefcase,
  GraduationCap,
  Loader2,
  PanelLeftClose,
  RotateCcw,
  Send,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { AiMarkdown } from '@/components/ai/AiMarkdown';
import { useAiChat } from '@/hooks/useAiChat';
import type { UserLevel } from '@/types';
import { cn } from '@/lib/utils';

/** 기존 플로팅 위젯이 쓰던 키를 그대로 이어받아 대화 기록이 유지되도록 한다. */
const MESSAGES_STORAGE_KEY = 'playops.aiChat.messages';
const LEVEL_STORAGE_KEY = 'playops.aiChat.userLevel';

export const AI_PANEL_MIN_WIDTH = 280;
export const AI_PANEL_MAX_WIDTH = 560;
export const AI_PANEL_DEFAULT_WIDTH = 360;

const levelOptions: { id: UserLevel; label: string; icon: typeof UserCheck }[] = [
  { id: 'NON_DEVELOPER', label: '비전공자', icon: UserCheck },
  { id: 'JUNIOR', label: '주니어', icon: GraduationCap },
  { id: 'SENIOR', label: '시니어', icon: Briefcase },
];

function readStoredLevel(): UserLevel {
  try {
    const raw = window.localStorage.getItem(LEVEL_STORAGE_KEY);
    if (levelOptions.some((opt) => opt.id === raw)) return raw as UserLevel;
  } catch {
    // localStorage 접근 불가 시 기본값 사용
  }
  return 'JUNIOR';
}

/**
 * 왼쪽에 고정된 AI 패널.
 *
 * 대화 · AI 작업 · 승인이 한 줄기 타임라인으로 위에서 아래로 쌓이는 구조다.
 * 지금은 대화만 올라오고, 코드 수정 · 테스트 실행 · 리포트 생성 같은 작업 카드는
 * AI 작업 API가 붙는 2차에서 같은 타임라인에 끼워 넣는다.
 */
export function AiPanel({
  width,
  onWidthChange,
  onCollapse,
  contextLabel,
}: {
  width: number;
  onWidthChange: (width: number) => void;
  onCollapse: () => void;
  /** 패널 상단에 보여줄 현재 맥락 (예: "example.com · 시나리오"). */
  contextLabel: string;
}) {
  const [question, setQuestion] = useState('');
  const [userLevel, setUserLevel] = useState<UserLevel>(readStoredLevel);
  const [resizing, setResizing] = useState(false);

  const { messages, loading, send, clear } = useAiChat({
    userLevel,
    storageKey: MESSAGES_STORAGE_KEY,
  });

  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(LEVEL_STORAGE_KEY, userLevel);
    } catch {
      // 저장 실패는 무시한다.
    }
  }, [userLevel]);

  // 새 메시지가 붙으면 항상 최신 위치로 스크롤한다.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, loading]);

  // 오른쪽 경계선을 끌어 패널 폭을 조절한다. 레일(56px)을 뺀 값이 패널 폭이 된다.
  const handleResizeStart = useCallback(() => setResizing(true), []);

  useEffect(() => {
    if (!resizing) return;

    const onMove = (event: MouseEvent) => {
      const next = Math.min(AI_PANEL_MAX_WIDTH, Math.max(AI_PANEL_MIN_WIDTH, event.clientX - 56));
      onWidthChange(next);
    };
    const onUp = () => setResizing(false);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizing, onWidthChange]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || loading) return;
    setQuestion('');
    await send(q);
  };

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r border-border bg-card"
      style={{ width }}
      aria-label="AI 어시스턴트"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ai-accent/15 text-ai-accent ring-1 ring-ai-accent/30">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight text-foreground">AI 어시스턴트</p>
            <p className="truncate text-[11px] leading-tight text-muted-foreground" title={contextLabel}>
              맥락: {contextLabel}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={clear}
            disabled={loading || messages.length === 0}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            title="대화 초기화"
            aria-label="대화 초기화"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="AI 패널 접기 (Ctrl+/)"
            aria-label="AI 패널 접기"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-background p-3">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
            <Sparkles className="h-7 w-7 text-ai-accent/60" />
            <p className="text-xs leading-relaxed">
              Playwright 문법, 셀렉터, 실패 원인 등 무엇이든 물어보세요.
              <br />
              답변과 AI가 한 작업이 여기에 차례로 쌓입니다.
            </p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className={cn('flex text-xs', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[88%] rounded-xl px-3 py-2 leading-relaxed',
                  msg.role === 'user'
                    ? 'whitespace-pre-wrap rounded-br-none bg-ai-accent font-medium text-ai-accent-foreground'
                    : 'rounded-bl-none border border-border bg-card text-foreground'
                )}
              >
                {msg.role === 'user' ? msg.content : <AiMarkdown content={msg.content} />}
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin text-ai-accent" />
            AI 답변 작성 중...
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t border-border bg-card px-2.5 pt-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">수준</span>
        <div className="inline-flex rounded-lg border border-border bg-muted p-0.5">
          {levelOptions.map((opt) => {
            const isSelected = userLevel === opt.id;
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setUserLevel(opt.id)}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-all',
                  isSelected
                    ? 'border border-border bg-card text-ai-accent shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <Icon className="h-3 w-3" />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <form onSubmit={handleSend} className="flex gap-2 bg-card p-2.5">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="무엇이든 물어보세요"
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-ai-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ai-accent text-ai-accent-foreground hover:opacity-90 disabled:opacity-50"
          aria-label="보내기"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </form>

      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={handleResizeStart}
        className={cn(
          'absolute inset-y-0 -right-1 w-2 cursor-col-resize',
          resizing ? 'bg-ai-accent/40' : 'hover:bg-ai-accent/30'
        )}
        title="끌어서 패널 폭 조절"
      />
    </aside>
  );
}
