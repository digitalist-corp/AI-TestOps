import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, X } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { cn, formatRelative } from '@/lib/utils';
import type { AppNotification } from '@/types';

const POLL_MS = 15000;

const levelDot: Record<string, string> = {
  SUCCESS: 'bg-success',
  ERROR: 'bg-destructive',
};

/**
 * 우상단 종. 테스트 종료 · 예약 실행 완료 같은 알림을 모아 두고, 사용자가 확인한 뒤 지운다.
 * ponytail: 15초 폴링. AI Task 의 SSE 가 생기면 같은 통로로 받는다.
 */
export function NotificationBell() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      setItems(await api.getNotifications());
    } catch {
      // 알림을 못 불러와도 화면은 그대로 쓴다.
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

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

  const remove = async (id: number) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    await api.deleteNotification(id).catch(load);
  };

  const removeAll = async () => {
    setItems([]);
    await api.deleteAllNotifications().catch(load);
  };

  const openLink = (n: AppNotification) => {
    if (!n.link) return;
    setOpen(false);
    navigate(n.link);
  };

  const count = items.length;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <Button
        variant="ghost"
        size="sm"
        className="relative h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
        onClick={() => {
          setOpen((prev) => !prev);
          if (!open) load();
        }}
        aria-label={count > 0 ? `알림 ${count}개` : '알림'}
        aria-expanded={open}
        title="알림"
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="알림"
          className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold text-foreground">알림</p>
            {count > 0 && (
              <button
                type="button"
                onClick={removeAll}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                모두 지우기
              </button>
            )}
          </div>

          {count === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">새 알림이 없습니다</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id} className="group flex items-start gap-2.5 border-b border-border px-4 py-3 last:border-b-0">
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', levelDot[n.level] ?? 'bg-primary')} />
                  <button
                    type="button"
                    onClick={() => openLink(n)}
                    className={cn('min-w-0 flex-1 text-left', n.link && 'hover:opacity-80')}
                  >
                    <p className="text-sm font-medium text-foreground">{n.title}</p>
                    {n.message && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.message}</p>}
                    <p className="mt-1 text-[11px] text-muted-foreground">{formatRelative(n.createdAt)}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(n.id)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={`${n.title} 알림 지우기`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
