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
    getAiUsage: vi.fn(),
    getNotifications: vi.fn(),
    runTests: vi.fn(),
    startDocker: vi.fn(),
    notices: { list: vi.fn() },
    aiJobs: { needsReview: vi.fn(), listByProject: vi.fn() },
  },
}));

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const project = (projectId: string, projectName: string, over: Partial<Project> = {}) =>
  ({ projectId, projectName, dockerStatus: 'RUNNING', status: 'RUNNING', startDate: '2026-11-01', endDate: null,
     latestExecutionStatus: 'FAILED', latestExecutionAt: null, latestExecutionId: null, ...over } as Project);
const row = (over: Partial<PlanItem>): PlanItem => ({
  specPath: 'a.spec.ts', grep: '로그인', title: '로그인', describePath: '', line: 1, enabled: true, parentEnabled: true,
  sortOrder: null, assignee: '윤재', dueDate: null, priority: null, lastStatus: 'PASSED', lastRunAt: null,
  prevStatus: null, prevRunAt: null, defectStatus: null, defectFailCount: 0,
  assigneeUserId: null, updatedByName: null, updatedAt: null, ...over,
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
    // 계획 3 · 작성 2(67%) · 실행 2 · 통과 1 → 완료율 33% (미작성도 분모)
    summary: { total: 3, enabled: 3, disabled: 0, unwritten: 1, written: 2, writtenRate: 2 / 3, passed: 1, failed: 1, notRun: 0, completionRate: 1 / 3 },
    screens: [],
  });
  vi.mocked(api.defects.list).mockResolvedValue({ defects: [], open: 1, resolved: 0 });
  vi.mocked(api.notices.list).mockResolvedValue([1, 2, 3, 4].map((id) => ({ id, title: `공지 ${id}`, pinned: id === 2, createdAt: '2026-11-17T00:00:00Z' }) as never));
  vi.mocked(api.getUsers).mockResolvedValue([
    { id: 1, username: 'admin', role: 'ADMIN', lastLoginAt: ago(0) },
    { id: 2, username: 'minji', displayName: '민지', role: 'USER', lastLoginAt: null },
  ] as never);
  vi.mocked(api.getRunnerContainers).mockResolvedValue([
    { containerType: 'RUNNER', projectId: 'shop', name: 'r1', dockerStatus: 'RUNNING', knownProject: true, removable: false },
    { containerType: 'RUNNER', projectId: 'demo', name: 'r2', dockerStatus: 'ERROR', knownProject: true, removable: false },
  ] as never);
  vi.mocked(api.getAiUsage).mockResolvedValue({ days: 30, from: '', totalCalls: 214, estimatedCostUsd: 3.1, priceConfigured: true, providers: [], features: [] });
  vi.mocked(api.getNotifications).mockResolvedValue([]);
  vi.mocked(api.aiJobs.needsReview).mockResolvedValue([{ id: 17, projectId: 'shop', status: 'NEEDS_REVIEW', updatedAt: ago(4) }] as never);
  vi.mocked(api.aiJobs.listByProject).mockResolvedValue([
    { id: 12, projectId: 'shop', status: 'APPLIED', postApplyVerificationStatus: 'PASSED', targetSpecPath: 'a.spec.ts' },
  ] as never);
  vi.mocked(api.runTests).mockResolvedValue({ id: 5 } as never);
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
  it('팀원: "내 할 일" 표에서 한 번에 실행하고, 내 프로젝트의 통과 · 실패 · 미수행과 실패 재실행', async () => {
    me = user('USER', [{ projectId: 'shop', role: 'MEMBER' }]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.defects.rerun).mockResolvedValue({ id: 1 } as never);
    renderHome();

    expect(await screen.findByRole('heading', { name: '내 할 일' })).toBeTruthy();
    expect(screen.getByText('배정 1 · 남음 1 · 오늘 마감 0 · 기한 지남 0 · 실패 0')).toBeTruthy();
    expect(screen.queryByText('결제')).toBeNull(); // 남의 배정은 내 할 일에 없다
    fireEvent.click(screen.getByRole('button', { name: '쇼핑몰 탈퇴 실행' }));
    await waitFor(() => expect(api.runTests).toHaveBeenCalledWith('shop', { cases: [{ specPath: 'a.spec.ts', grep: '탈퇴', nodeType: 'TEST' }] }));

    expect(screen.getByRole('heading', { name: '내 프로젝트' })).toBeTruthy();
    expect(screen.getByText('통과 1 · 실패 1 · 미수행 1')).toBeTruthy();
    // 미해결 결함 수는 결함 리스트와 같은 API에서 온다 (#81)
    expect((await screen.findByRole('link', { name: '미해결 결함 1' })).getAttribute('href')).toBe('/projects/shop/defects');
    fireEvent.click(screen.getByRole('button', { name: '쇼핑몰 실패 1건 다시 실행' }));
    // 실패만 다시 실행 = 결함 다시 실행 API(빈 목록)로 원래 실행에 잇는다 (#83)
    await waitFor(() => expect(api.defects.rerun).toHaveBeenCalledWith('shop', []));
    expect(screen.queryByRole('heading', { name: '전체 현황' })).toBeNull();
  });

  it('팀원: 그 프로젝트가 이미 실행 중이면 [실행]을 잠근다', async () => {
    me = user('USER', [{ projectId: 'shop', role: 'MEMBER' }]);
    vi.mocked(api.getProjects).mockResolvedValue([project('shop', '쇼핑몰', { latestExecutionStatus: 'RUNNING' })]);
    renderHome();

    expect((await screen.findByRole('button', { name: '쇼핑몰 탈퇴 실행' })).hasAttribute('disabled')).toBe(true);
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

  it('PM: 확인할 것 칩 · 완료율 · 퍼널 한 줄 · 담당자별(배정 · 통과 · 실패 · 미수행 · 완료율) · 기한 지남 · AI 줄', async () => {
    me = user('USER', [{ projectId: 'shop', role: 'PM' }]);
    renderHome();

    expect(await screen.findByRole('heading', { name: '내가 맡은 프로젝트' })).toBeTruthy();
    expect(await screen.findByText('완료율 33%')).toBeTruthy();
    expect(screen.getByText('계획 3 · 작성 67% · 완료 33%')).toBeTruthy(); // 서버 summary 기준 퍼널
    expect(screen.queryByText(/진척률/)).toBeNull();
    expect(await screen.findByRole('link', { name: '미해결 결함 1' })).toBeTruthy();
    expect(screen.getByText('실행', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('2026-11-01 ~')).toBeTruthy();
    expect(screen.getByText('(계정 없음) 윤재')).toBeTruthy();
    expect(screen.getByText('민지')).toBeTruthy();
    expect(screen.getByText(/기한 지남 1건/)).toBeTruthy();
    // 승인 대기: 서버가 내 프로젝트로 거른 needs-review 를 프로젝트별로 센다. 3일 넘으면 강조
    const chip = await screen.findByRole('link', { name: '승인 대기 1 · 최장 4일' });
    expect(chip.getAttribute('href')).toBe('/projects/shop/ai-review');
    expect(screen.getByText('담당자 없음 0')).toBeTruthy();
    expect(await screen.findByText('치유됨 1 · 되돌림 0')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '내 할 일' })).toBeNull();
  });

  it('관리자: KPI 6칸 · 확인 필요(러너 오류 · 상태 불일치) · 프로젝트 표 · 사용자 표', async () => {
    me = user('ADMIN');
    vi.mocked(api.getProjects).mockResolvedValue([
      project('shop', '쇼핑몰'),
      project('demo', '데모', { status: 'PLANNED', latestExecutionAt: ago(1), latestExecutionStatus: 'PASSED' }),
    ]);
    renderHome();

    expect(await screen.findByRole('heading', { name: '전체 현황' })).toBeTruthy();
    expect(await screen.findByRole('group', { name: '프로젝트: 2' })).toBeTruthy();
    expect(await screen.findByRole('group', { name: '미수행: 2건' })).toBeTruthy();
    expect(await screen.findByRole('group', { name: '미해결 결함: 2' })).toBeTruthy();
    expect(await screen.findByRole('group', { name: '승인 대기: 1 · 최장 4일' })).toBeTruthy();
    expect(await screen.findByRole('group', { name: '러너: 1/2 실행 중 · 오류 1' })).toBeTruthy();
    expect(await screen.findByRole('group', { name: 'AI 비용(30일): $3.10 · 호출 214' })).toBeTruthy();

    expect(await screen.findByText('러너 오류 · demo 러너가 ERROR')).toBeTruthy();
    expect(screen.getByText("상태 불일치 · 데모는 '계획'인데 실행 기록이 있음")).toBeTruthy();
    expect(screen.getByText('승인 정체 · 쇼핑몰 #17 (4일)')).toBeTruthy();

    expect((await screen.findAllByRole('link', { name: '미해결 결함 1' })).length).toBe(2);
    expect(screen.getAllByText('실행', { selector: 'span' }).length).toBeGreaterThan(0);
    expect(await screen.findByText('▲ 기록 없음')).toBeTruthy(); // 한 번도 로그인하지 않은 계정
  });

  it('모든 역할: 공지는 한 줄 띠 — 고정 공지 먼저, "외 n건"', async () => {
    me = user('USER', [{ projectId: 'shop', role: 'MEMBER' }]);
    renderHome();

    expect((await screen.findByRole('link', { name: /공지 2/ })).getAttribute('href')).toBe('/notices/2');
    expect(screen.getByRole('link', { name: '외 3건 →' }).getAttribute('href')).toBe('/notices');
    expect(screen.queryByText('공지 1')).toBeNull();
  });

  it('소속 프로젝트가 없으면 안내만', async () => {
    me = user('USER', []);
    vi.mocked(api.getProjects).mockResolvedValue([]);
    renderHome();

    expect(await screen.findByRole('heading', { name: '소속된 프로젝트가 없습니다' })).toBeTruthy();
  });
});
