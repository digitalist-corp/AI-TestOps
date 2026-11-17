import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { api, getStoredAuth } from '@/api/client';

/**
 * 로그인한 사람의 권한을 한 곳에서 읽는다 (#106). 서버 GET /api/auth/me 만 보고 판단한다.
 * "관리자 > PM > 팀원": 전역 ADMIN 이면 어느 프로젝트든 관리자, 아니면 프로젝트별 역할(PM · 팀원).
 * 화면에서 숨기는 것은 편의일 뿐이고, 막는 것은 서버다.
 */
export type ProjectRole = 'PM' | 'MEMBER';
export type Me = {
  id: number;
  username: string;
  displayName: string | null;
  role: 'ADMIN' | 'USER';
  projects: { projectId: string; role: ProjectRole }[];
};
export type RoleInProject = 'ADMIN' | ProjectRole;

export const ROLE_LABEL: Record<RoleInProject, string> = { ADMIN: '관리자', PM: 'PM', MEMBER: '팀원' };

export function accessOf(me: Me | null) {
  const admin = me?.role === 'ADMIN';
  const roleIn = (projectId?: string): RoleInProject | null =>
    admin ? 'ADMIN' : me?.projects.find((p) => p.projectId === projectId)?.role ?? null;
  return {
    me,
    admin,
    roleIn,
    /** 계획 · 프로젝트 수정 · 팀원 추가 같은 쓰기: PM 또는 관리자 */
    canManage: (projectId?: string) => admin || roleIn(projectId) === 'PM',
  };
}

export type Access = ReturnType<typeof accessOf>;

// 프로바이더 밖(단위 테스트 등)에서는 아무 권한도 없는 것으로 본다.
const AccessContext = createContext<Access>(accessOf(null));

export function AccessProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  // 받아오기 전에는 저장된 전역 역할로 관리자 메뉴만 먼저 맞춰 둔다.
  const [me, setMe] = useState<Me | null>(() => {
    const stored = getStoredAuth();
    return stored ? { id: 0, username: stored.username, displayName: null, role: stored.role === 'ADMIN' ? 'ADMIN' : 'USER', projects: [] } : null;
  });

  // PM 이 팀원을 넣으면 화면을 옮길 때 반영된다.
  useEffect(() => {
    let ignore = false;
    api.getMe()
      .then((next) => !ignore && setMe(next))
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [location.pathname]);

  return <AccessContext.Provider value={accessOf(me)}>{children}</AccessContext.Provider>;
}

export function useAccess() {
  return useContext(AccessContext);
}
