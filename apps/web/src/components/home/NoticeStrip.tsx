import { Link } from 'react-router-dom';
import { Pin } from 'lucide-react';
import type { Notice } from '@/types';

/** 공지 한 줄 띠 (A9): 고정 공지를 먼저, 제목 하나와 "외 n건 →". 할 일을 밀어내지 않는다. */
export function NoticeStrip({ notices }: { notices: Notice[] }) {
  if (notices.length === 0) return null;
  const first = notices.find((n) => n.pinned) ?? notices[0];
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2 text-sm">
      <span className="shrink-0 font-semibold text-muted-foreground">공지</span>
      <Link to={`/notices/${first.id}`} className="flex min-w-0 flex-1 items-center gap-1.5 hover:underline">
        {first.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="고정" />}
        <span className="truncate font-medium text-foreground">{first.title}</span>
      </Link>
      <Link to="/notices" className="shrink-0 text-muted-foreground hover:underline">
        {notices.length > 1 ? `외 ${notices.length - 1}건 →` : '전체 →'}
      </Link>
    </div>
  );
}
