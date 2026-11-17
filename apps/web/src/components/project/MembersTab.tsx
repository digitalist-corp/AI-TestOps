import { useEffect, useState } from 'react';
import { Loader2, Search, UserMinus, UserPlus, Users } from 'lucide-react';
import { api } from '@/api/client';
import type { ProjectMember, UserCandidate } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ROLE_LABEL, type RoleInProject } from '@/lib/access';

const nameOf = (m: { username: string; displayName: string | null }) => m.displayName || m.username;

/**
 * 설정 › 팀원. 누가 무엇을 하는지는 서버와 같다:
 * 팀원은 목록만, PM 은 팀원 추가 · 빼기, 관리자는 PM 지정 · 변경까지.
 */
export function MembersTab({ projectId, role }: { projectId: string; role: RoleInProject | null }) {
  const admin = role === 'ADMIN';
  const canManage = admin || role === 'PM';
  const [members, setMembers] = useState<ProjectMember[] | null>(null);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<UserCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.members
      .list(projectId)
      .then((list) => alive && setMembers(list))
      .catch(() => alive && setError('멤버를 불러오지 못했어요.'));
    return () => {
      alive = false;
    };
  }, [projectId]);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장하지 못했어요.');
    }
  };

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => setCandidates(await api.members.candidates(projectId, query)));
  };

  const add = (user: UserCandidate, nextRole: ProjectMember['role']) =>
    run(async () => {
      const added = await api.members.add(projectId, user.id, nextRole);
      setMembers((prev) => [...(prev ?? []), added]);
      setCandidates((prev) => prev?.filter((c) => c.id !== user.id) ?? null);
    });

  const changeRole = (member: ProjectMember, nextRole: ProjectMember['role']) =>
    run(async () => {
      await api.members.changeRole(projectId, member.userId, nextRole);
      setMembers((prev) => prev?.map((m) => (m.userId === member.userId ? { ...m, role: nextRole } : m)) ?? null);
    });

  const remove = (member: ProjectMember) => {
    if (!window.confirm(`${nameOf(member)}님을 이 프로젝트에서 뺄까요?`)) return;
    void run(async () => {
      await api.members.remove(projectId, member.userId);
      setMembers((prev) => prev?.filter((m) => m.userId !== member.userId) ?? null);
    });
  };

  // PM 은 팀원만 넣고 뺀다. PM 지정 · 해제는 관리자만.
  const canRemove = (m: ProjectMember) => admin || (canManage && m.role === 'MEMBER');
  const memberIds = new Set(members?.map((m) => m.userId));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Users className="h-5 w-5 text-primary" />
          팀원
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {admin
            ? 'PM을 지정하고 팀원을 넣거나 뺍니다.'
            : canManage
              ? '사용자를 찾아 팀원으로 넣거나 뺍니다. PM 지정은 관리자에게 요청하세요.'
              : '이 프로젝트의 멤버입니다.'}
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-sm border border-destructive bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {error}
        </p>
      )}

      {members === null ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{nameOf(m)}</p>
                <p className="truncate text-xs text-muted-foreground">{m.username}</p>
              </div>
              {admin ? (
                <select
                  aria-label={`${nameOf(m)} 역할`}
                  value={m.role}
                  onChange={(e) => changeRole(m, e.target.value as ProjectMember['role'])}
                  className="h-8 rounded-sm border border-border bg-card px-2 text-sm text-foreground"
                >
                  <option value="PM">PM</option>
                  <option value="MEMBER">팀원</option>
                </select>
              ) : (
                <span className="rounded px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-border">
                  {ROLE_LABEL[m.role]}
                </span>
              )}
              {canRemove(m) && (
                <Button size="sm" variant="outline" aria-label={`${nameOf(m)} 빼기`} onClick={() => remove(m)}>
                  <UserMinus className="h-4 w-4" />
                  빼기
                </Button>
              )}
            </li>
          ))}
          {members.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">멤버가 없습니다.</li>}
        </ul>
      )}

      {canManage && (
        <div className="space-y-3">
          <form onSubmit={search} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="사용자 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="아이디 또는 이름"
                className="pl-9"
              />
            </div>
            <Button type="submit" variant="outline">찾기</Button>
          </form>
          {candidates && (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {candidates.filter((c) => !memberIds.has(c.id)).map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{nameOf(c)}</p>
                    <p className="truncate text-xs text-muted-foreground">{c.username}</p>
                  </div>
                  <Button size="sm" variant="outline" aria-label={`${nameOf(c)} 팀원으로 추가`} onClick={() => add(c, 'MEMBER')}>
                    <UserPlus className="h-4 w-4" />
                    팀원으로 추가
                  </Button>
                  {admin && (
                    <Button size="sm" variant="outline" aria-label={`${nameOf(c)} PM으로 추가`} onClick={() => add(c, 'PM')}>
                      PM으로 추가
                    </Button>
                  )}
                </li>
              ))}
              {candidates.every((c) => memberIds.has(c.id)) && (
                <li className="px-4 py-6 text-center text-sm text-muted-foreground">넣을 사용자가 없습니다.</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
