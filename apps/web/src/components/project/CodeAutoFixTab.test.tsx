import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/api/client';
import type { CodeAutoFixMine, CodeAutoFixRequest } from '@/types';
import { CodeAutoFixTab } from './CodeAutoFixTab';

vi.mock('@/api/client', () => ({
  api: {
    codeAutoFix: { me: vi.fn(), request: vi.fn(), list: vi.fn(), grant: vi.fn(), reject: vi.fn(), revoke: vi.fn() },
  },
}));

const req = (over: Partial<CodeAutoFixRequest>): CodeAutoFixRequest => ({
  id: 9, userId: 3, userName: '윤재', status: 'PENDING', scopes: [], note: '결제 결함을 고쳐 보고 싶어요',
  requestedAt: '2026-11-23T00:00:00Z', decidedBy: null, decidedAt: null, ...over,
});
const mine = (over: Partial<CodeAutoFixMine>): CodeAutoFixMine => ({
  role: 'MEMBER', scopes: [], canManage: false, request: null, integrationReady: false, ...over,
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const renderTab = (path = '/projects/p1/code-auto-fix') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <CodeAutoFixTab projectId="p1" />
    </MemoryRouter>,
  );

describe('코드 자동 수정 탭', () => {
  it('팀원은 기본 범위가 없고, 사유를 적어 본인 사용권을 요청하면 PM 검토 대기로 바뀐다', async () => {
    vi.mocked(api.codeAutoFix.me).mockResolvedValueOnce(mine({}));
    vi.mocked(api.codeAutoFix.request).mockResolvedValueOnce(req({}));
    renderTab();

    expect(await screen.findByText('아직 사용권이 없어요')).toBeTruthy();
    // 연동이 준비되지 않았다는 사실을 숨기지 않는다
    expect(screen.getAllByText('연동 준비 전').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('요청 사유'), { target: { value: '결제 결함을 고쳐 보고 싶어요' } });
    fireEvent.click(screen.getByRole('button', { name: '사용권 요청' }));

    expect(await screen.findByText('PM 검토 대기')).toBeTruthy();
    expect(api.codeAutoFix.request).toHaveBeenCalledWith('p1', '결제 결함을 고쳐 보고 싶어요');
    expect(screen.queryByRole('button', { name: '사용권 요청' })).toBeNull();
    expect(api.codeAutoFix.list).not.toHaveBeenCalled();
  });

  it('부여받은 팀원은 본인 범위를 보지만 실행할 수 있다고 표시하지 않는다', async () => {
    vi.mocked(api.codeAutoFix.me).mockResolvedValueOnce(mine({ scopes: ['AUTO_FIX'], request: req({ status: 'GRANTED', scopes: ['AUTO_FIX'] }) }));
    renderTab();

    const scope = await screen.findByTestId('my-scope-AUTO_FIX');
    expect(within(scope).getByText('허용됨')).toBeTruthy();
    expect(within(scope).getByText('연동 준비 전')).toBeTruthy();
    expect(within(screen.getByTestId('my-scope-PR_PUBLISH')).getByText('허용 안 됨')).toBeTruthy();
  });

  it('PM은 알림으로 들어온 요청 행을 보고, 범위를 골라 부여한다', async () => {
    vi.mocked(api.codeAutoFix.me).mockResolvedValue(mine({ role: 'PM', canManage: true, scopes: ['AUTO_FIX', 'PR_PUBLISH'] }));
    vi.mocked(api.codeAutoFix.list).mockResolvedValueOnce([req({ id: 8, userName: '다른 팀원' }), req({})])
      .mockResolvedValueOnce([req({ status: 'GRANTED', scopes: ['AUTO_FIX'] })]);
    vi.mocked(api.codeAutoFix.grant).mockResolvedValueOnce(req({ status: 'GRANTED', scopes: ['AUTO_FIX'] }));
    renderTab('/projects/p1/code-auto-fix?request=9');

    const row = await screen.findByTestId('access-request-9');
    expect(row.getAttribute('data-highlight')).toBe('true');
    expect(screen.getByTestId('access-request-8').getAttribute('data-highlight')).toBe('false');
    // 범위를 고르기 전에는 부여할 수 없다
    const grant = within(row).getByRole('button', { name: '부여' }) as HTMLButtonElement;
    expect(grant.disabled).toBe(true);
    fireEvent.click(within(row).getByLabelText('자동 수정 · 재검증 요청'));
    fireEvent.click(grant);

    await waitFor(() => expect(api.codeAutoFix.grant).toHaveBeenCalledWith('p1', 9, ['AUTO_FIX']));
    expect(await within(await screen.findByTestId('access-request-9')).findByText('허용됨')).toBeTruthy();
  });

  it('처리는 성공했는데 목록을 다시 읽지 못하면 실패로 보이지 않고 결과를 그대로 보인다', async () => {
    vi.mocked(api.codeAutoFix.me).mockResolvedValue(mine({ role: 'PM', canManage: true, scopes: ['AUTO_FIX', 'PR_PUBLISH'] }));
    vi.mocked(api.codeAutoFix.list).mockResolvedValueOnce([req({})]).mockRejectedValueOnce(new Error('네트워크 오류'));
    vi.mocked(api.codeAutoFix.reject).mockResolvedValueOnce(req({ status: 'REJECTED' }));
    renderTab();

    fireEvent.click(within(await screen.findByTestId('access-request-9')).getByRole('button', { name: '거절' }));

    expect(await within(screen.getByTestId('access-request-9')).findByText('거절됨')).toBeTruthy();
    expect(screen.queryByText('네트워크 오류')).toBeNull();
  });

  it('PM은 거절 · 회수하고, 다른 PM이 먼저 처리했으면 그 이유를 보인다', async () => {
    vi.mocked(api.codeAutoFix.me).mockResolvedValue(mine({ role: 'PM', canManage: true, scopes: ['AUTO_FIX', 'PR_PUBLISH'] }));
    vi.mocked(api.codeAutoFix.list).mockResolvedValue([req({ id: 9 }), req({ id: 7, userName: '민수', status: 'GRANTED', scopes: ['AUTO_FIX', 'PR_PUBLISH'] })]);
    vi.mocked(api.codeAutoFix.reject).mockResolvedValueOnce(req({ status: 'REJECTED' }));
    vi.mocked(api.codeAutoFix.revoke).mockRejectedValueOnce(new Error('다른 사람이 먼저 처리했습니다. 새로 고친 뒤 다시 확인하세요.'));
    renderTab();

    fireEvent.click(within(await screen.findByTestId('access-request-9')).getByRole('button', { name: '거절' }));
    await waitFor(() => expect(api.codeAutoFix.reject).toHaveBeenCalledWith('p1', 9));
    fireEvent.click(within(screen.getByTestId('access-request-7')).getByRole('button', { name: '회수' }));

    expect(await screen.findByText('다른 사람이 먼저 처리했습니다. 새로 고친 뒤 다시 확인하세요.')).toBeTruthy();
    expect(api.codeAutoFix.revoke).toHaveBeenCalledWith('p1', 7);
  });
});
