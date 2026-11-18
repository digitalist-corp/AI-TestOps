import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/api/client';
import { LoginPage } from './LoginPage';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

vi.mock('@/api/client', () => ({
  api: { login: vi.fn(), guestLogin: vi.fn(), getServiceHealth: vi.fn().mockResolvedValue({ status: 'UP', services: [] }) },
  clearStoredAuth: vi.fn(),
  setStoredAuth: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LoginPage', () => {
  it('게스트로 시작은 관리자 계정이 아니라 게스트 입장 요청을 보낸다', async () => {
    vi.mocked(api.guestLogin).mockResolvedValue({ token: 't', username: 'guest', role: 'USER' });
    render(<MemoryRouter><LoginPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: '게스트로 시작' }));

    await waitFor(() => expect(api.guestLogin).toHaveBeenCalled());
    expect(api.login).not.toHaveBeenCalled();
  });

  it('앱은 로그인 칸에 값을 넣지 않고 브라우저 자동완성 종류만 알려 준다', () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    const username = screen.getByLabelText('사용자명') as HTMLInputElement;
    const password = screen.getByLabelText('비밀번호') as HTMLInputElement;
    expect(username.value).toBe('');
    expect(password.value).toBe('');
    expect(username.getAttribute('autocomplete')).toBe('username');
    expect(password.getAttribute('autocomplete')).toBe('current-password');
  });

  it('기본 비밀번호 계정이면 비밀번호 변경 화면으로 보낸다', async () => {
    vi.mocked(api.login).mockResolvedValue({ token: 't', username: 'admin', role: 'ADMIN', passwordChangeRequired: true });
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('사용자명'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/change-password'));
  });

  it('회원가입 화면으로 가는 링크가 있다', () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: '회원가입' }).getAttribute('href')).toBe('/signup');
  });
});
