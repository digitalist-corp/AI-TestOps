import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Loader2, Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { api } from '@/api/client';
import type { Notice, NoticeRequest } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { ConsoleEyebrow } from '@/components/console/ConsoleText';
import { useAccess } from '@/lib/access';
import { cn } from '@/lib/utils';

const formatDate = (value: string) => new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });

/** ISO ↔ <input type="datetime-local"> 값 (현지 시각) */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

/** 관리자에게만 보이는 표시: 게시 기간 밖이면 팀원 · PM 에게는 안 보인다 */
function outOfWindow(n: Notice) {
  const now = Date.now();
  return (n.visibleFrom && new Date(n.visibleFrom).getTime() > now)
    || (n.visibleUntil && new Date(n.visibleUntil).getTime() <= now);
}

const toRequest = (n: Notice): NoticeRequest => ({
  title: n.title, content: n.content, pinned: n.pinned, visibleFrom: n.visibleFrom, visibleUntil: n.visibleUntil,
});

function NoticeFormDialog({ initial, onClose, onSave }: {
  initial: NoticeRequest;
  onClose: () => void;
  onSave: (data: NoticeRequest) => Promise<void>;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSave(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial.title ? '공지 수정' : '새 공지'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notice-title">제목</Label>
            <Input id="notice-title" required maxLength={200} value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notice-content">내용</Label>
            <textarea id="notice-content" required rows={10} value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              className="w-full rounded-sm border border-border bg-card px-3.5 py-2.5 text-[15px] text-foreground" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="notice-from">게시 시작 (비우면 바로)</Label>
              <Input id="notice-from" type="datetime-local" value={toLocalInput(form.visibleFrom)}
                onChange={(e) => setForm({ ...form, visibleFrom: fromLocalInput(e.target.value) })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notice-until">게시 종료 (비우면 계속)</Label>
              <Input id="notice-until" type="datetime-local" value={toLocalInput(form.visibleUntil)}
                onChange={(e) => setForm({ ...form, visibleUntil: fromLocalInput(e.target.value) })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />
            맨 위에 고정
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>취소</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {initial.title ? '저장' : '올리기'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 공지사항 (#116). 모두 읽고, 관리자만 쓰기 · 수정 · 삭제 · 고정한다 (막는 것은 서버).
 * 왼쪽 목록(고정 먼저 · 최신순), 오른쪽 상세. 주소 /notices/:id 로 바로 열 수 있다 (알림 종 링크).
 */
export function NoticesPage() {
  const { admin } = useAccess();
  const navigate = useNavigate();
  const { noticeId } = useParams();
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [editing, setEditing] = useState<Notice | 'new' | null>(null);

  const load = useCallback(() => {
    api.notices.list().then(setNotices).catch(() => setNotices([]));
  }, []);

  useEffect(load, [load]);

  if (!notices) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const selected = notices.find((n) => String(n.id) === noticeId) ?? (noticeId ? null : notices[0] ?? null);

  const save = async (data: NoticeRequest) => {
    const saved = editing === 'new' ? await api.notices.create(data) : await api.notices.update((editing as Notice).id, data);
    setEditing(null);
    load();
    navigate(`/notices/${saved.id}`);
  };

  const togglePin = async (n: Notice) => {
    await api.notices.update(n.id, { ...toRequest(n), pinned: !n.pinned });
    load();
  };

  const remove = async (n: Notice) => {
    if (!window.confirm(`'${n.title}' 공지를 삭제할까요?`)) return;
    await api.notices.remove(n.id);
    load();
    navigate('/notices');
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <ConsoleEyebrow>WORKSPACE // NOTICES</ConsoleEyebrow>
          <h2 className="text-[24px] font-bold leading-tight text-foreground">공지사항</h2>
        </div>
        {admin && (
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            새 공지
          </Button>
        )}
      </div>

      {notices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-12 text-center text-[15px] text-muted-foreground">
          아직 공지가 없습니다.
        </div>
      ) : (
        <div className="grid grid-cols-[360px_minmax(0,1fr)] gap-6">
          <ul className="divide-y divide-border self-start overflow-hidden rounded-xl border border-border bg-card">
            {notices.map((n) => (
              <li key={n.id}>
                <Link
                  to={`/notices/${n.id}`}
                  className={cn('block px-4 py-3 hover:bg-muted', selected?.id === n.id && 'bg-muted')}
                >
                  <div className="flex items-center gap-2">
                    {n.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="고정" />}
                    <span className="truncate font-medium text-foreground">{n.title}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDate(n.createdAt)}
                    {admin && outOfWindow(n) && ' · 게시 기간 아님'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          {selected ? (
            <article className="space-y-4 rounded-xl border border-border bg-card p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    {selected.pinned && <Badge variant="info">고정</Badge>}
                    {admin && outOfWindow(selected) && <Badge variant="warning">게시 기간 아님</Badge>}
                  </div>
                  <h3 className="text-[20px] font-bold text-foreground">{selected.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {selected.createdBy} · {formatDate(selected.createdAt)}
                    {selected.updatedAt !== selected.createdAt && ` (수정 ${formatDate(selected.updatedAt)})`}
                  </p>
                </div>
                {admin && (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline" onClick={() => togglePin(selected)}>
                      {selected.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                      {selected.pinned ? '고정 해제' : '고정'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(selected)}>
                      <Pencil className="h-4 w-4" />
                      수정
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive" onClick={() => remove(selected)}>
                      <Trash2 className="h-4 w-4" />
                      삭제
                    </Button>
                  </div>
                )}
              </div>
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">{selected.content}</p>
            </article>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-card px-5 py-12 text-center text-[15px] text-muted-foreground">
              공지를 찾을 수 없습니다. 게시 기간이 끝났거나 삭제되었을 수 있습니다.
            </div>
          )}
        </div>
      )}

      {editing && (
        <NoticeFormDialog
          initial={editing === 'new'
            ? { title: '', content: '', pinned: false, visibleFrom: null, visibleUntil: null }
            : toRequest(editing)}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}
