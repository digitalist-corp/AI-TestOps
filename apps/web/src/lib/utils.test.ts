import { describe, expect, it } from 'vitest';
import { executionStatusLabel, formatDuration, pmCandidates, userRoleLabel } from '@/lib/utils';

describe('formatDuration', () => {
  it('1분 미만은 초만, 넘으면 분 · 초로 보여 준다', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(44_000)).toBe('44초');
    expect(formatDuration(164_000)).toBe('2분 44초');
    expect(formatDuration(120_000)).toBe('2분');
    expect(formatDuration(4_200)).toBe('4초');
  });
});

describe('executionStatusLabel', () => {
  it('실행 상태 코드를 한글로 바꾼다', () => {
    expect(executionStatusLabel.PASSED).toBe('성공');
    expect(executionStatusLabel.FAILED).toBe('실패');
    expect(executionStatusLabel.RUNNING).toBe('실행 중');
  });
});

describe('계정 역할 — 관리자 / PM / 팀원', () => {
  it('세 역할을 각각 다른 이름으로 보여 준다', () => {
    expect(userRoleLabel).toEqual({ ADMIN: '관리자', PM: 'PM', USER: '팀원' });
  });

  it('프로젝트 PM 후보는 PM 계정만 고른다', () => {
    const users = [
      { id: 1, username: 'admin', displayName: null, role: 'ADMIN' as const },
      { id: 2, username: 'pm1', displayName: '테스트 PM', role: 'PM' as const },
      { id: 3, username: 'user1', displayName: null, role: 'USER' as const },
    ];
    expect(pmCandidates(users)).toEqual([{ id: 2, label: '테스트 PM (pm1)' }]);
  });
});
