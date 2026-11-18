import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api, setStoredAuth } from '@/api/client';
import { ChangePasswordPage } from './ChangePasswordPage';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('@/api/client', () => ({
  api: { changePassword: vi.fn() },
  setStoredAuth: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function submit(confirm: string) {
  render(<MemoryRouter><ChangePasswordPage /></MemoryRouter>);
  fill('현재 비밀번호', 'admin');
  fill('새 비밀번호', 'new-pass-1234');
  fill('새 비밀번호 확인', confirm);
  fireEvent.click(screen.getByRole('button', { name: '비밀번호 바꾸기' }));
}

describe('ChangePasswordPage', () => {
  it('새 비밀번호 칸은 브라우저가 새 비밀번호로 다루게 한다', () => {
    render(<MemoryRouter><ChangePasswordPage /></MemoryRouter>);
    expect(screen.getByLabelText('현재 비밀번호').getAttribute('autocomplete')).toBe('current-password');
    expect(screen.getByLabelText('새 비밀번호').getAttribute('autocomplete')).toBe('new-password');
  });

  it('확인이 다르면 요청을 보내지 않는다', async () => {
    submit('new-pass-9999');
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '새 비밀번호 확인이 일치하지 않습니다.');
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it('바꾸면 새 토큰을 저장하고 홈으로 간다', async () => {
    vi.mocked(api.changePassword).mockResolvedValue({ token: 'new', username: 'admin', role: 'ADMIN', passwordChangeRequired: false });
    submit('new-pass-1234');

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/home'));
    expect(api.changePassword).toHaveBeenCalledWith('admin', 'new-pass-1234');
    expect(setStoredAuth).toHaveBeenCalledWith({ token: 'new', username: 'admin', role: 'ADMIN' });
  });
});
