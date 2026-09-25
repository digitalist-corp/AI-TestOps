import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Briefcase,
  GraduationCap,
  Loader2,
  MessageCircle,
  RotateCcw,
  Send,
  Sparkles,
  UserCheck,
  X,
} from 'lucide-react';
import { AiMarkdown } from '@/components/ai/AiMarkdown';
import { useAiChat } from '@/hooks/useAiChat';
import type { UserLevel } from '@/types';
import { cn } from '@/lib/utils';

const MESSAGES_STORAGE_KEY = 'playops.aiChat.messages';
const LEVEL_STORAGE_KEY = 'playops.aiChat.userLevel';

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

export function GlobalAiChatWidget() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [userLevel, setUserLevel] = useState<UserLevel>(readStoredLevel);

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
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages.length, loading]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || loading) return;
    setQuestion('');
    await send(q);
  };

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex h-[520px] w-96 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-sidebar-active bg-gradient-to-r from-sidebar via-ai-accent/25 to-sidebar px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ai-accent/20 text-ai-accent ring-1 ring-ai-accent/30">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-bold leading-tight">AI-TestOps 도우미</p>
                <p className="text-[11px] leading-tight text-sidebar-foreground">Playwright/E2E 관련 질문에 답해드려요</p>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={clear}
                disabled={loading || messages.length === 0}
                className="rounded-md p-1 text-sidebar-foreground hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                title="대화 초기화"
                aria-label="대화 초기화"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-sidebar-foreground hover:bg-white/10 hover:text-white"
                aria-label="닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto bg-background p-3">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                <Bot className="h-8 w-8" />
                <p className="text-xs">
                  Playwright 문법, 셀렉터, 에러 원인 등 무엇이든 물어보세요.
                  <br />
                  특정 프로젝트/실행에 대한 질문은 해당 프로젝트의 "AI 분석" 탭을 이용하면 더 정확합니다.
                </p>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div key={idx} className={cn('flex gap-2 text-xs', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[85%] rounded-xl px-3 py-2 leading-relaxed',
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
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-ai-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ai-accent text-ai-accent-foreground hover:opacity-90 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-ai-accent text-ai-accent-foreground shadow-lg shadow-ai-accent/30 transition-transform hover:scale-105 hover:opacity-90"
        title="AI-TestOps 도우미"
        aria-label="AI-TestOps 도우미 열기"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>
    </>
  );
}
