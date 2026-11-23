import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Wrench } from 'lucide-react';
import { api } from '@/api/client';
import type { CodeAutoFixMine, CodeAutoFixRequest, CodeAutoFixScope } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ROLE_LABEL } from '@/lib/access';
import { cn, formatRelative } from '@/lib/utils';

const SCOPES: { id: CodeAutoFixScope; label: string; detail: string }[] = [
  { id: 'AUTO_FIX', label: '자동 수정 · 재검증 요청', detail: '결함의 수정안 검증과 재실행을 자동으로 요청해요.' },
  { id: 'PR_PUBLISH', label: '검증 후 PR 게시 요청', detail: '검증된 diff 의 PR 게시를 요청해요. 게시는 diff 마다 PM · 관리자 승인이 따로 필요해요.' },
];

const STATUS: Record<CodeAutoFixRequest['status'], { label: string; variant: 'warning' | 'success' | 'neutral' | 'destructive' }> = {
  PENDING: { label: 'PM 검토 대기', variant: 'warning' },
  GRANTED: { label: '허용됨', variant: 'success' },
  REJECTED: { label: '거절됨', variant: 'neutral' },
  REVOKED: { label: '회수됨', variant: 'destructive' },
};

/**
 * 프로젝트의 "코드 자동 수정" 사용권 (프로젝트 · 팀원별, 기본 없음).
 * 팀원은 본인 사용권을 요청하고, PM · 관리자는 알림에서 넘어온 요청 행에서 범위를 골라 부여 · 거절 · 회수한다.
 * 자동 수정 실행 · PR 연동은 아직 준비 전이라, 범위를 줘도 지금은 아무것도 실행하거나 저장소에 쓰지 않는다.
 */
export function CodeAutoFixTab({ projectId }: { projectId: string }) {
  const [params] = useSearchParams();
  const highlighted = Number(params.get('request')) || null;
  const [mine, setMine] = useState<CodeAutoFixMine | null>(null);
  const [requests, setRequests] = useState<CodeAutoFixRequest[] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.codeAutoFix
      .me(projectId)
      .then((me) => {
        if (!alive) return;
        setMine(me);
        if (me.canManage) api.codeAutoFix.list(projectId).then((list) => alive && setRequests(list)).catch(() => {});
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : '사용권을 불러오지 못했어요.'));
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (highlighted && requests) document.getElementById(`access-request-${highlighted}`)?.scrollIntoView?.({ block: 'center' });
  }, [highlighted, requests]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리하지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  const ask = () =>
    run(async () => {
      const request = await api.codeAutoFix.request(projectId, note.trim());
      setMine((m) => (m ? { ...m, request } : m));
    });

  // 처리 결과를 바로 반영하고, 다른 PM 의 처리까지 맞추려고 목록을 다시 읽는다
  const decide = (action: () => Promise<CodeAutoFixRequest>) =>
    run(async () => {
      const updated = await action();
      setRequests((list) => list?.map((r) => (r.id === updated.id ? { ...r, ...updated, userName: r.userName } : r)) ?? null);
      // 처리는 이미 됐다. 다시 읽기만 실패하면 방금 결과를 그대로 둔다
      await api.codeAutoFix.list(projectId).then(setRequests, () => {});
    });

  if (!mine) {
    return error ? (
      <p className="text-sm text-destructive">{error}</p>
    ) : (
      <div className="flex min-h-[160px] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const myRequest = mine.request;
  const canAsk = mine.role === 'MEMBER' && (!myRequest || myRequest.status === 'REJECTED' || myRequest.status === 'REVOKED');

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Wrench className="h-5 w-5 text-primary" />
          코드 자동 수정
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          팀원이 자동 수정 기능을 쓰려면 이 프로젝트 PM에게 사용권을 받아야 해요. 사용권은 이 프로젝트와 팀원에게만 적용되고, 프로젝트에서 빠지면 사라져요.
        </p>
        {!mine.integrationReady && (
          <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            자동 수정 실행 · 재검증 · PR 게시 연동은 아직 준비 전이에요. 지금은 사용권만 관리하고, 범위를 받아도 실행하거나 저장소에 쓰지 않아요.
            결함 화면의 "AI 수정 제안 보기"(읽기 전용)는 사용권과 상관없이 쓸 수 있어요.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-medium text-foreground">내 사용권</h4>
          <Badge>{ROLE_LABEL[mine.role]}</Badge>
          {myRequest && <Badge variant={STATUS[myRequest.status].variant}>{STATUS[myRequest.status].label}</Badge>}
        </div>
        {mine.role !== 'MEMBER' ? (
          <p className="text-sm text-muted-foreground">PM · 관리자는 요청 없이 모든 범위를 관리해요.</p>
        ) : mine.scopes.length === 0 && !myRequest ? (
          <p className="text-sm text-muted-foreground">아직 사용권이 없어요</p>
        ) : null}
        <ul className="space-y-1.5">
          {SCOPES.map((s) => {
            const allowed = mine.scopes.includes(s.id);
            return (
              <li key={s.id} data-testid={`my-scope-${s.id}`} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-foreground">{s.label}</span>
                <Badge variant={allowed ? 'success' : 'neutral'}>{allowed ? '허용됨' : '허용 안 됨'}</Badge>
                <Badge variant="warning">연동 준비 전</Badge>
              </li>
            );
          })}
        </ul>
        {canAsk && (
          <div className="flex flex-wrap items-end gap-2 pt-1">
            <div className="min-w-[240px] flex-1 space-y-1">
              <label htmlFor="code-auto-fix-note" className="text-xs text-muted-foreground">
                요청 사유
              </label>
              <Input
                id="code-auto-fix-note"
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                placeholder="예: 결제 화면 결함을 자동으로 고쳐 보고 싶어요"
              />
            </div>
            <Button size="sm" onClick={ask} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              사용권 요청
            </Button>
          </div>
        )}
      </section>

      {mine.canManage && (
        <section className="space-y-3">
          <h4 className="font-medium text-foreground">팀원 요청</h4>
          {requests === null ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : requests.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              아직 사용권 요청이 없어요.
            </p>
          ) : (
            <div className="space-y-2">
              {requests.map((r) => (
                <RequestRow
                  key={r.id}
                  request={r}
                  highlight={r.id === highlighted}
                  busy={busy}
                  onGrant={(scopes) => decide(() => api.codeAutoFix.grant(projectId, r.id, scopes))}
                  onReject={() => decide(() => api.codeAutoFix.reject(projectId, r.id))}
                  onRevoke={() => decide(() => api.codeAutoFix.revoke(projectId, r.id))}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function RequestRow({
  request: r,
  highlight,
  busy,
  onGrant,
  onReject,
  onRevoke,
}: {
  request: CodeAutoFixRequest;
  highlight: boolean;
  busy: boolean;
  onGrant: (scopes: CodeAutoFixScope[]) => void;
  onReject: () => void;
  onRevoke: () => void;
}) {
  const [chosen, setChosen] = useState<CodeAutoFixScope[]>(r.scopes);
  const decidable = r.status === 'PENDING' || r.status === 'GRANTED';
  const toggle = (id: CodeAutoFixScope) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <div
      id={`access-request-${r.id}`}
      data-testid={`access-request-${r.id}`}
      data-highlight={highlight}
      className={cn('space-y-2 rounded-lg border border-border bg-card p-3', highlight && 'ring-2 ring-primary')}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-foreground">{r.userName ?? `#${r.userId}`}</span>
        <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
        <span className="text-xs text-muted-foreground">{formatRelative(r.requestedAt)} 요청</span>
      </div>
      {r.note && <p className="text-sm text-muted-foreground">{r.note}</p>}
      {decidable && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {SCOPES.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 text-sm text-foreground" title={s.detail}>
                <input type="checkbox" aria-label={s.label} checked={chosen.includes(s.id)} onChange={() => toggle(s.id)} />
                {s.label}
                <Badge variant="warning">연동 준비 전</Badge>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onGrant(chosen)} disabled={busy || chosen.length === 0}>
              {r.status === 'GRANTED' ? '범위 저장' : '부여'}
            </Button>
            {r.status === 'PENDING' && (
              <Button size="sm" variant="outline" onClick={onReject} disabled={busy}>
                거절
              </Button>
            )}
            {r.status === 'GRANTED' && (
              <Button size="sm" variant="outline" onClick={onRevoke} disabled={busy}>
                회수
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
