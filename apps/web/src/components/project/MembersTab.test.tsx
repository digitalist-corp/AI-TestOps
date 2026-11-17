import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '@/api/client';
import { MembersTab } from './MembersTab';

vi.mock('@/api/client', () => ({
  api: {
    members: { list: vi.fn(), candidates: vi.fn(), add: vi.fn(), changeRole: vi.fn(), remove: vi.fn() },
  },
}));

const members = [
  { userId: 1, username: 'pm', displayName: '박PM', role: 'PM' as const },
  { userId: 2, username: 'kim', displayName: '김팀원', role: 'MEMBER' as const },
];

beforeEach(() => {
  vi.mocked(api.members.list).mockResolvedValue(members);
  vi.mocked(api.members.candidates).mockResolvedValue([{ id: 3, username: 'lee', displayName: '이신입' }]);
  vi.mocked(api.members.add).mockResolvedValue({ userId: 3, username: 'lee', displayName: '이신입', role: 'MEMBER' });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MembersTab', () => {
  it('팀원은 멤버 목록만 본다', async () => {
    render(<MembersTab projectId="shop" role="MEMBER" />);

    expect(await screen.findByText('김팀원')).toBeTruthy();
    expect(screen.queryByLabelText('사용자 검색')).toBeNull();
    expect(screen.queryByRole('button', { name: /빼기/ })).toBeNull();
  });

  it('PM 은 사용자를 찾아 팀원으로 넣고 팀원을 뺄 수 있지만 PM 은 건드리지 못한다', async () => {
    render(<MembersTab projectId="shop" role="PM" />);
    await screen.findByText('김팀원');

    expect(screen.queryByRole('button', { name: '박PM 빼기' })).toBeNull();
    expect(screen.getByRole('button', { name: '김팀원 빼기' })).toBeTruthy();
    expect(screen.queryByLabelText('김팀원 역할')).toBeNull();

    fireEvent.change(screen.getByLabelText('사용자 검색'), { target: { value: 'lee' } });
    fireEvent.click(screen.getByRole('button', { name: '찾기' }));
    fireEvent.click(await screen.findByRole('button', { name: '이신입 팀원으로 추가' }));

    await waitFor(() => expect(api.members.add).toHaveBeenCalledWith('shop', 3, 'MEMBER'));
    expect(await screen.findByText('이신입')).toBeTruthy();
  });

  it('관리자는 PM 을 지정 · 변경한다', async () => {
    vi.mocked(api.members.changeRole).mockResolvedValue(undefined);
    render(<MembersTab projectId="shop" role="ADMIN" />);
    await screen.findByText('김팀원');

    fireEvent.change(screen.getByLabelText('김팀원 역할'), { target: { value: 'PM' } });

    await waitFor(() => expect(api.members.changeRole).toHaveBeenCalledWith('shop', 2, 'PM'));
    expect(screen.getByRole('button', { name: '박PM 빼기' })).toBeTruthy();
  });
});
