import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/api/client';
import type { Me } from '@/lib/access';
import type { PlanItem, Project } from '@/types';
import { HomePage } from './HomePage';

let me: Me;
vi.mock('@/lib/access', async (orig) => {
  const mod = await orig<typeof import('@/lib/access')>();
  return { ...mod, useAccess: () => mod.accessOf(me) };
});
vi.mock('@/api/client', () => ({
  api: {
    getProjects: vi.fn(),
    plan: { get: vi.fn() },
    defects: { list: vi.fn(), rerun: vi.fn() },
    getUsers: vi.fn(),
    getRunnerContainers: vi.fn(),
    runTests: vi.fn(),
    notices: { list: vi.fn() },
  },
}));

const project = (projectId: string, projectName: string) =>
  ({ projectId, projectName, dockerStatus: 'RUNNING', status: 'RUNNING', startDate: '2026-11-01', endDate: null } as Project);
const row = (over: Partial<PlanItem>): PlanItem => ({
  specPath: 'a.spec.ts', grep: '로그인', title: '로그인', describePath: '', line: 1, enabled: true, parentEnabled: true,
  sortOrder: null, assignee: '윤재', dueDate: null, priority: null, lastStatus: 'PASSED', lastRunAt: null, assigneeUserId: null, updatedByName: null, updatedAt: null, ...over,
});
const items = [
  row({}),
  row({ grep: '결제', title: '결제', lastStatus: 'FAILED', dueDate: '2000-01-01' }),
  row({ grep: '탈퇴', title: '탈퇴', lastStatus: null, assignee: '민지', assigneeUserId: 9, dueDate: '2026-12-01' }),
];

beforeEach(() => {
  vi.mocked(api.getProjects).mockResolvedValue([project('shop', '쇼핑몰')]);
  vi.mocked(api.plan.get).mockResolvedValue({
    items,
    summary: { total: 3, enabled: 3, disabled: 0, passed: 1, failed: 1, notRun: 1, completionRate: 1 / 3 },
  });
  vi.mocked(api.defects.list).mockResolvedValue({ defects: [], open: 1, resolved: 0 });
  vi.mocked(api.notices.list).mockResolvedValue([1, 2, 3, 4].map((id) => ({ id, title: `공지 ${id}`, pinned: id === 1, createdAt: '2026-11-17T00:00:00Z' }) as never));
  vi.mocked(api.getUsers).mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
  vi.mocked(api.getRunnerContainers).mockResolvedValue([
    { containerType: 'RUNNER', dockerStatus: 'RUNNING' },
    { containerType: 'RUNNER', dockerStatus: 'STOPPED' },
  ] as never);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const user = (role: Me['role'], projects: Me['projects'] = []): Me =>
  ({ id: 9, username: 'u', displayName: null, role, projects });

function renderHome() {
  render(<MemoryRouter><HomePage /></MemoryRouter>);
}

describe('HomePage — 역할마다 다른 첫 화면', () => {
  it('팀원: 내 프로젝트의 성공 · 실패 · 미수행과 실패 재실행', async () => {
    me = user('USER', [{ projectId: 'shop', role: 'MEMBER' }]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.defects.rerun).mockResolvedValue({ id: 1 } as never);
    renderHome();

    expect(await screen.findByRole('heading', { name: '내 프로젝트' })).toBeTruthy();
    expect(screen.getByText('성공 1 · 실패 1 · 미수행 1')).toBeTruthy();
    // 미해결 결함 수는 결함 리스트와 같은 API에서 온다 (#81)
    expect((await screen.findByRole('link', { name: '미해결 결함 1' })).getAttribute('href')).toBe('/projects/shop/defects');
    expect(screen.getByRole('heading', { name: '나에게 배정된 항목' })).toBeTruthy();
    expect(screen.getByText('쇼핑몰 · 탈퇴')).toBeTruthy();
    expect(screen.queryByText('쇼핑몰 · 결제')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '쇼핑몰 실패 1건 다시 실행' }));

    // 실패만 다시 실행 = 결함 다시 실행 API(빈 목록)로 원래 실행에 잇는다 (#83)
    await waitFor(() => expect(api.defects.rerun).toHaveBeenCalledWith('shop', []));
    expect(screen.queryByRole('heading', { name: '전체 현황' })).toBeNull();
  });

  it('같은 프로젝트가 이미 실행 중이면 서버의 409 안내를 그대로 보여 준다 (3차 3번)', async () => {
    me = user('USER', [{ projectId: 'shop', role: 'MEMBER' }]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.mocked(api.defects.rerun).mockRejectedValue(new Error('이미 실행 중입니다. 끝나거나 중지한 뒤에 다시 실행하세요.'));
    renderHome();

    fireEvent.click(await screen.findByRole('button', { name: '쇼핑몰 실패 1건 다시 실행' }));

    await waitFor(() => expect(alert).toHaveBeenCalledWith('이미 실행 중입니다. 끝나거나 중지한 뒤에 다시 실행하세요.'));
  });

  it('PM: 진척률 · 팀원별 진행 · 기한 지난 항목', async () => {
    me = user('USER', [{ projectId: 'shop', role: 'PM' }]);
    renderHome();

    expect(await screen.findByRole('heading', { name: '내가 맡은 프로젝트' })).toBeTruthy();
    expect(screen.getByText('진척률 33%')).toBeTruthy();
    expect(await screen.findByRole('link', { name: '미해결 결함 1' })).toBeTruthy();
    expect(screen.getByText('실행', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('2026-11-01 ~')).toBeTruthy();
    expect(screen.getByText('(계정 없음) 윤재')).toBeTruthy();
    expect(screen.getByText('민지')).toBeTruthy();
    expect(screen.getByText(/기한 지남 1건/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '내 프로젝트' })).toBeNull();
  });

  it('관리자: 전체 프로젝트 · 사용자 수 · 러너 상태', async () => {
    me = user('ADMIN');
    renderHome();

    expect(await screen.findByRole('heading', { name: '전체 현황' })).toBeTruthy();
    expect(await screen.findByText('프로젝트 1개')).toBeTruthy();
    expect(screen.getByText('사용자 2명')).toBeTruthy();
    expect(screen.getByText('러너 1 / 2 실행 중')).toBeTruthy();
    expect(await screen.findByRole('link', { name: '미해결 결함 1' })).toBeTruthy();
    expect(screen.getByText('실행', { selector: 'span' })).toBeTruthy();
  });

  it('모든 역할: 최근 공지 3개', async () => {
    me = user('USER', [{ projectId: 'shop', role: 'MEMBER' }]);
    renderHome();

    expect(await screen.findByRole('heading', { name: '공지사항' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /공지 1/ }).getAttribute('href')).toBe('/notices/1');
    expect(screen.getByText('공지 3')).toBeTruthy();
    expect(screen.queryByText('공지 4')).toBeNull();
  });
});
