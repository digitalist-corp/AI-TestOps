import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, HelpCircle, Keyboard, X } from 'lucide-react';
import { SHORTCUTS, screenHelpFor } from '@/config/screenHelp';
import type { ProjectTabId } from '@/config/projectWorkspace';
import { cn } from '@/lib/utils';

/**
 * 상단바 오른쪽 ? 버튼.
 *
 * AI에게 묻는 창이 아니라 제품 사용법을 알려주는 고정 메뉴다.
 * (질문·코드 수정은 오른쪽 아래 AI 채팅 담당)
 */
export function HelpMenu({
  pathname,
  projectTab,
}: {
  pathname: string;
  projectTab?: ProjectTabId;
}) {
  const [open, setOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  const help = screenHelpFor(pathname, projectTab);

  // 바깥을 클릭하거나 Esc를 누르면 닫는다.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          <div className="border-b border-border bg-accent/40 px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                지금 이 화면 · {help.title}
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="닫기"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-foreground">{help.body}</p>
          </div>

          <div className="p-1.5">
            <button
              type="button"
              onClick={() => setShowShortcuts((prev) => !prev)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground hover:bg-accent"
            >
              <Keyboard className="h-4 w-4 text-muted-foreground" />
              키보드 단축키
            </button>
            {showShortcuts && (
              <ul className="mb-1 ml-9 mr-2.5 space-y-1 rounded-lg bg-muted px-2.5 py-2">
                {SHORTCUTS.map((item) => (
                  <li key={item.keys} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">{item.description}</span>
                    <kbd className="shrink-0 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                      {item.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              onClick={() => go('/templates')}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground hover:bg-accent"
            >
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              테스트 코드 템플릿 보기
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          open && 'bg-accent text-foreground'
        )}
        title="도움말"
        aria-label="도움말 열기"
      >
        <HelpCircle className="h-4 w-4" />
      </button>
    </div>
  );
}
