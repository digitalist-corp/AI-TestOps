import { describe, expect, it } from 'vitest';
import { accessOf, type Me } from './access';

const me = (role: Me['role'], projects: Me['projects'] = []): Me => ({ id: 1, username: 'u', displayName: null, role, projects });

describe('accessOf — 관리자 > PM > 팀원', () => {
  it('관리자는 어느 프로젝트든 관리자이고 관리할 수 있다', () => {
    const a = accessOf(me('ADMIN'));
    expect(a.admin).toBe(true);
    expect(a.roleIn('shop')).toBe('ADMIN');
    expect(a.canManage('shop')).toBe(true);
  });

  it('PM 은 자기 프로젝트만 관리하고, 팀원은 보기만 한다', () => {
    const a = accessOf(me('USER', [{ projectId: 'shop', role: 'PM' }, { projectId: 'blog', role: 'MEMBER' }]));
    expect(a.admin).toBe(false);
    expect(a.canManage('shop')).toBe(true);
    expect(a.roleIn('blog')).toBe('MEMBER');
    expect(a.canManage('blog')).toBe(false);
    expect(a.roleIn('other')).toBeNull();
  });

  it('아직 모르면 아무 권한도 없다', () => {
    const a = accessOf(null);
    expect(a.admin).toBe(false);
    expect(a.canManage('shop')).toBe(false);
  });
});
