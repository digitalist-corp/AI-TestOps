import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '@/api/client';
import type { Me } from '@/lib/access';
import type { Notice } from '@/types';
import { NoticesPage } from './NoticesPage';

let me: Me;
vi.mock('@/lib/access', async (orig) => {
  const mod = await orig<typeof import('@/lib/access')>();
  return { ...mod, useAccess: () => mod.accessOf(me) };
});
vi.mock('@/api/client', () => ({
  api: { notices: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() } },
}));

const notice = (id: number, title: string, pinned = false): Notice => ({
  id, title, content: `${title} 내용`, pinned, visibleFrom: null, visibleUntil: null,
  createdBy: 'admin', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z',
});

const user = (role: Me['role']): Me => ({ id: 1, username: 'u', displayName: null, role, projects: [] });

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/notices" element={<NoticesPage />} />
        <Route path="/notices/:noticeId" element={<NoticesPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.mocked(api.notices.list).mockResolvedValue([notice(2, '점검 안내', true), notice(1, '새 기능')]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('NoticesPage', () => {
  it('팀원: 목록과 상세를 읽고, 쓰기 버튼은 없다', async () => {
    me = user('USER');
    renderAt('/notices/2');

    expect(await screen.findByRole('heading', { name: '점검 안내' })).toBeTruthy();
    expect(screen.getByText('점검 안내 내용')).toBeTruthy();
    expect(screen.getByText('고정')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '새 공지' })).toBeNull();
    expect(screen.queryByRole('button', { name: '수정' })).toBeNull();
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull();
  });

  it('관리자: 새 공지를 쓰면 목록이 새로 고쳐진다', async () => {
    me = user('ADMIN');
    vi.mocked(api.notices.create).mockResolvedValue(notice(3, '배포 안내'));
    renderAt('/notices');

    fireEvent.click(await screen.findByRole('button', { name: '새 공지' }));
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '배포 안내' } });
    fireEvent.change(screen.getByLabelText('내용'), { target: { value: '오늘 배포' } });
    fireEvent.click(screen.getByLabelText('맨 위에 고정'));
    fireEvent.click(screen.getByRole('button', { name: '올리기' }));

    await waitFor(() => expect(api.notices.create).toHaveBeenCalledWith({
      title: '배포 안내', content: '오늘 배포', pinned: true, visibleFrom: null, visibleUntil: null,
    }));
    expect(api.notices.list).toHaveBeenCalledTimes(2);
  });

  it('관리자: 고정을 풀고 지울 수 있다', async () => {
    me = user('ADMIN');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.notices.update).mockResolvedValue(notice(2, '점검 안내'));
    vi.mocked(api.notices.remove).mockResolvedValue(undefined);
    renderAt('/notices/2');

    fireEvent.click(await screen.findByRole('button', { name: '고정 해제' }));
    await waitFor(() => expect(api.notices.update).toHaveBeenCalledWith(2, expect.objectContaining({ pinned: false })));

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(api.notices.remove).toHaveBeenCalledWith(2));
  });
});
