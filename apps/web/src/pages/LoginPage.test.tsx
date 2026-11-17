import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/api/client';
import { LoginPage } from './LoginPage';

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

  it('회원가입 화면으로 가는 링크가 있다', () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: '회원가입' }).getAttribute('href')).toBe('/signup');
  });
});
