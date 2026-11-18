import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '@/api/client';
import type { PlanItem, PlanResponse } from '@/types';
import { PlanTab } from './PlanTab';
import { downloadCsv } from '@/lib/csv';

vi.mock('@/lib/csv', () => ({ downloadCsv: vi.fn() }));

vi.mock('@/api/client', () => ({
  api: {
    plan: { get: vi.fn(), patch: vi.fn(), reorder: vi.fn(), setEnabled: vi.fn() },
    getScenarios: vi.fn(),
    testSuites: { listByProject: vi.fn() },
    getSiteMap: vi.fn(),
    getSiteMapCoverage: vi.fn(),
    members: { list: vi.fn() },
  },
}));

const item = (over: Partial<PlanItem>): PlanItem => ({
  specPath: 'tests/login.spec.ts', grep: '로그인된다', title: '로그인된다', describePath: '', line: 1,
  enabled: true, parentEnabled: true, sortOrder: null, assignee: '윤재', dueDate: null, priority: null, lastStatus: 'PASSED', lastRunAt: null,
  assigneeUserId: null, updatedByName: null, updatedAt: null,
  ...over,
});

const plan: PlanResponse = {
  items: [
    item({ updatedByName: '김윤재', updatedAt: new Date().toISOString() }),
    item({ grep: '로그아웃된다', title: '로그아웃된다', line: 9, lastStatus: 'FAILED', assignee: '김윤재', assigneeUserId: 7 }),
    item({ grep: '탈퇴된다', title: '탈퇴된다', line: 20, enabled: false, lastStatus: null }),
    item({ specPath: 'tests/off.spec.ts', grep: '꺼진 파일', title: '꺼진 파일', enabled: false, parentEnabled: false, lastStatus: null }),
  ],
  summary: { total: 4, enabled: 2, disabled: 2, passed: 1, failed: 1, notRun: 0, completionRate: 0.5 },
};

beforeEach(() => {
  vi.mocked(api.plan.get).mockResolvedValue(plan);
  vi.mocked(api.getScenarios).mockResolvedValue({ projectId: 'p1', totalSpecs: 0, totalCases: 0, specs: [] });
  vi.mocked(api.getSiteMap).mockRejectedValue(new Error('없음'));
  vi.mocked(api.getSiteMapCoverage).mockRejectedValue(new Error('없음'));
  vi.mocked(api.testSuites.listByProject).mockResolvedValue([]);
  vi.mocked(api.members.list).mockResolvedValue([{ userId: 7, username: 'kim', displayName: '김윤재', role: 'MEMBER' }]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PlanTab', () => {
  it('CSV 내보내기: 표준 칸 순서로, 사용 중 · 미사용 모두, 판정은 엑셀 표기(Pass/Fail/Untested)', async () => {
    vi.mocked(api.plan.get).mockResolvedValue(plan);
    render(<PlanTab projectId="p1" onRun={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'CSV 내보내기' }));

    const [fileName, rows] = vi.mocked(downloadCsv).mock.calls[0];
    expect(fileName).toMatch(/^p1-계획-\d{8}\.csv$/);
    expect(rows[0]).toEqual(['TC ID', '대분류', '케이스명', '사용', '담당자', '마감일', '우선순위', '판정', '최근 실행']);
    expect(rows).toHaveLength(5);
    expect(rows[1]).toEqual(['TC-001', 'tests/login.spec.ts', '로그인된다', '사용', '(계정 없음) 윤재', '', '', 'Pass', '']);
    expect(rows[2].slice(2, 8)).toEqual(['로그아웃된다', '사용', '김윤재', '', '', 'Fail']);
    expect(rows[3].slice(2, 4)).toEqual(['탈퇴된다', '미사용']);
    expect(rows[3][7]).toBe('Untested');
  });

  it('코드 용어 없이 업무 열 이름을 보여 준다', async () => {
    const { container } = render(<PlanTab projectId="p1" onRun={() => {}} />);
    await screen.findByText('로그아웃된다');
    for (const name of ['사용', '순서', '계획 항목', '화면', '담당자', '마감일', '우선순위', '최근 결과', '최근 수정']) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    expect(container.textContent).not.toMatch(/spec|grep/i);
    expect(screen.getByText('김윤재 · 방금')).toBeTruthy();
  });

  it('담당자는 멤버 계정 이름으로, 계정과 잇지 못한 옛 이름은 "(계정 없음)"으로 보인다', async () => {
    render(<PlanTab projectId="p1" onRun={() => {}} />);
    await screen.findByText('로그아웃된다');
    expect(screen.getAllByText('(계정 없음) 윤재').length).toBeGreaterThan(0);
    expect(screen.getByText('김윤재')).toBeTruthy();
  });

  it('사용 체크를 끄면 그 행의 계획 칸과 함께 enabled=false 를 보낸다', async () => {
    vi.mocked(api.plan.patch).mockResolvedValue(undefined);
    render(<PlanTab projectId="p1" onRun={() => {}} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: '로그인된다 사용' }));
    await waitFor(() =>
      expect(api.plan.patch).toHaveBeenCalledWith('p1', {
        specPath: 'tests/login.spec.ts', grep: '로그인된다', enabled: false, assignee: '윤재', assigneeUserId: null, dueDate: null, priority: null,
      })
    );
  });

  it('파일이나 묶음이 꺼진 케이스는 체크를 잠그고 이유를 알려 준다', async () => {
    render(<PlanTab projectId="p1" onRun={() => {}} />);
    const box = (await screen.findByRole('checkbox', { name: '꺼진 파일 사용' })) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.title).toContain('파일이나 묶음이 꺼져 있어요');
  });

  it('revertsCellWhenSaveFails', async () => {
    vi.mocked(api.plan.patch).mockRejectedValue(new Error('500'));
    render(<PlanTab projectId="p1" onRun={() => {}} />);
    const box = await screen.findByRole('checkbox', { name: '로그인된다 사용' });
    fireEvent.click(box);
    expect(await screen.findByText('저장하지 못했어요. 다시 시도해 주세요.')).toBeTruthy();
    await waitFor(() =>
      expect((screen.getByRole('checkbox', { name: '로그인된다 사용' }) as HTMLInputElement).checked).toBe(true)
    );
  });

  it('체크한 N건 실행 버튼에 사용 중 건수가 나오고 누르면 실행한다', async () => {
    const onRun = vi.fn();
    render(<PlanTab projectId="p1" onRun={onRun} />);
    fireEvent.click(await screen.findByRole('button', { name: '체크한 2건 실행' }));
    expect(onRun).toHaveBeenCalled();
  });

  it('스위트가 없으면 스위트 선택을 보이지 않는다', async () => {
    render(<PlanTab projectId="p1" onRun={() => {}} />);
    await screen.findByText('로그아웃된다');
    expect(screen.queryByLabelText('스위트')).toBeNull();
  });

  it('스위트를 고르면 그 항목만 남고 건수를 보여 준다', async () => {
    vi.mocked(api.testSuites.listByProject).mockResolvedValue([
      { id: 7, projectId: 'p1', name: '로그인 묶음', specPaths: ['tests/login.spec.ts'], grep: '로그인|탈퇴', caseCount: 2, sequential: false, createdAt: '' },
    ]);
    render(<PlanTab projectId="p1" onRun={() => {}} />);
    const picker = await screen.findByLabelText('스위트');
    fireEvent.change(picker, { target: { value: '7' } });
    await waitFor(() => expect(screen.queryByText('로그아웃된다')).toBeNull());
    expect(screen.getByText('로그인된다')).toBeTruthy();
    expect(screen.getByText('성공 1 · 실패 0 · 미수행 0 · 미사용 1')).toBeTruthy();
  });
});

describe('PlanTab — 팀원(보기 전용)', () => {
  it('사용 체크 · 칸 수정 · 일괄 버튼 없이 보기만 하고, 실행은 할 수 있다', async () => {
    render(<PlanTab projectId="p1" onRun={() => {}} readOnly />);

    const check = await screen.findByLabelText('로그인된다 사용');
    expect((check as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /체크한 2건 실행/ })).toBeTruthy();
    expect(screen.queryByText(/칸을 두 번 눌러 고치고/)).toBeNull();
  });

  it('실행 중이면 실행 버튼을 누를 수 없다', async () => {
    render(<PlanTab projectId="p1" onRun={() => {}} runDisabled />);
    const button = (await screen.findByRole('button', { name: /실행 중/ })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
