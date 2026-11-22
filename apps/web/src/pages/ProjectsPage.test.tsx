import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/api/client';
import { confirmPlaywrightVersion } from '@/lib/projectRuntime';
import type { Project, ScenarioTree } from '@/types';
import { ProjectsPage } from './ProjectsPage';

vi.mock('@/lib/aiEnabled', () => ({ useAiEnabled: () => ({ active: false }) }));
vi.mock('@/lib/projectRuntime', () => ({ confirmPlaywrightVersion: vi.fn() }));
vi.mock('@/api/client', () => ({
  getStoredAuth: () => null,
  api: {
    getProjects: vi.fn(),
    getRunningAnalyses: vi.fn(),
    getScenarios: vi.fn(),
    runTests: vi.fn(),
    startDocker: vi.fn(),
    plan: { get: vi.fn() },
  },
}));

const project = {
  projectId: 'shop',
  projectName: '쇼핑몰',
  dockerStatus: 'RUNNING',
  dockerEnabled: true,
  runnerLifecycle: 'PERSISTENT',
  runnerActivity: 'IDLE',
  nodeVersion: '22',
  playwrightVersion: '1.53.0',
  envVariables: '{}',
  loginEnvRequired: false,
  latestExecutionStatus: null,
  status: 'RUNNING',
  startDate: '2026-11-01',
  endDate: '2026-12-01',
} as unknown as Project;

const tree: ScenarioTree = {
  projectId: 'shop',
  totalSpecs: 1,
  totalCases: 3,
  specs: [{
    path: 'a.spec.ts',
    caseCount: 3,
    enabled: true,
    cases: ['1', '2', '3'].map((title) => ({ type: 'TEST', title, line: 1, grep: title, enabled: true, children: [] })),
  }],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.mocked(api.getProjects).mockResolvedValue([project]);
  vi.mocked(api.getRunningAnalyses).mockResolvedValue([]);
  vi.mocked(api.getScenarios).mockResolvedValue(tree);
  vi.mocked(api.plan.get).mockResolvedValue({ items: [], summary: { completionRate: 0.4 } } as never);
  vi.mocked(api.runTests).mockReset();
  vi.mocked(confirmPlaywrightVersion).mockResolvedValue(true);
});

function renderPage() {
  render(<MemoryRouter><ProjectsPage /></MemoryRouter>);
  return screen.findByRole('heading', { name: '쇼핑몰' });
}

describe('ProjectsPage — 실행 확인 · 수정/삭제 위치', () => {
  it('카드의 실행을 누르면 이름 · 항목 수를 묻고, 취소하면 실행 요청을 보내지 않는다', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: /실행/ }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith("'쇼핑몰' 프로젝트를 실행할까요?\n실행할 항목 3건"));
    expect(api.runTests).not.toHaveBeenCalled();
  });

  it('확인하면 실행 요청을 보낸다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.runTests).mockResolvedValue({ id: 1, status: 'PENDING', createdAt: '', startedAt: null, durationMs: null } as never);
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: /실행/ }));

    await waitFor(() => expect(api.runTests).toHaveBeenCalledWith('shop'));
  });

  it('목록에는 수정 · 삭제 버튼이 없다', async () => {
    await renderPage();
    expect(screen.queryByRole('button', { name: '수정' })).toBeNull();
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull();
  });
});

describe('ProjectsPage — 소속 프로젝트가 없는 팀원', () => {
  it('빈 목록에 PM 초대 안내를 보이고 등록 버튼(위 · 빈 목록)은 두지 않는다', async () => {
    vi.mocked(api.getProjects).mockResolvedValue([]);
    render(<MemoryRouter><ProjectsPage /></MemoryRouter>);

    expect(await screen.findByText('PM에게 초대를 요청하세요.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /프로젝트 등록/ })).toBeNull();
  });
});

describe('ProjectsPage — 상태 · 기간 · 완료율 (#117)', () => {
  it('카드에 상태 · 기간 · 완료율을 한글로 보인다', async () => {
    await renderPage();

    expect(screen.getByText('실행', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText('2026-11-01 ~ 2026-12-01')).toBeTruthy();
    expect(await screen.findByText('완료율 40%')).toBeTruthy();
    expect(screen.queryByText('RUNNING')).toBeNull();
  });

  it('종료된 프로젝트는 기본으로 숨기고, 상태로 거를 수 있다', async () => {
    vi.mocked(api.getProjects).mockResolvedValue([
      project,
      { ...project, projectId: 'old', projectName: '지난 사업', status: 'CLOSED' } as Project,
      { ...project, projectId: 'next', projectName: '다음 사업', status: 'PLANNED' } as Project,
    ]);
    await renderPage();

    expect(screen.queryByRole('heading', { name: '지난 사업' })).toBeNull();
    expect(screen.getByRole('heading', { name: '다음 사업' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('상태로 거르기'), { target: { value: 'CLOSED' } });
    expect(screen.getByRole('heading', { name: '지난 사업' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '쇼핑몰' })).toBeNull();
  });
});
