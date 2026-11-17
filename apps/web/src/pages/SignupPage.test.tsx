import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api, setStoredAuth } from '@/api/client';
import { SignupPage } from './SignupPage';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('@/api/client', () => ({
  api: { signup: vi.fn() },
  setStoredAuth: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillForm(confirm: string) {
  render(<MemoryRouter><SignupPage /></MemoryRouter>);
  fill('아이디', 'kim');
  fill('이름', '김윤재');
  fill('비밀번호', 'password123');
  fill('비밀번호 확인', confirm);
  fireEvent.click(screen.getByRole('button', { name: '가입하기' }));
}

describe('SignupPage', () => {
  it('비밀번호 확인이 다르면 가입 요청을 보내지 않는다', async () => {
    fillForm('password124');

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '비밀번호 확인이 일치하지 않습니다.');
    expect(api.signup).not.toHaveBeenCalled();
  });

  it('가입하면 바로 로그인해 프로젝트 목록으로 간다', async () => {
    vi.mocked(api.signup).mockResolvedValue({ token: 't', username: 'kim', role: 'USER' });
    fillForm('password123');

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/projects'));
    expect(api.signup).toHaveBeenCalledWith('kim', '김윤재', 'password123');
    expect(setStoredAuth).toHaveBeenCalledWith({ token: 't', username: 'kim', role: 'USER' });
  });
});
