import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '@/api/client';
import type { PlanDailyResponse, PlanItem, PlanResponse } from '@/types';
import { PlanTab } from './PlanTab';
import { downloadCsv } from '@/lib/csv';

vi.mock('@/lib/csv', () => ({ downloadCsv: vi.fn() }));

vi.mock('@/api/client', () => ({
  api: {
    plan: { get: vi.fn(), patch: vi.fn(), reorder: vi.fn(), setEnabled: vi.fn(), daily: vi.fn() },
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
  prevStatus: null, prevRunAt: null, defectStatus: null, defectFailCount: 0,
  assigneeUserId: null, updatedByName: null, updatedAt: null,
  ...over,
});

const plan: PlanResponse = {
  items: [
    item({ updatedByName: '김윤재', updatedAt: new Date().toISOString(), prevStatus: 'FAILED', defectStatus: 'RESOLVED', defectFailCount: 1 }),
    item({ grep: '로그아웃된다', title: '로그아웃된다', line: 9, lastStatus: 'FAILED', prevStatus: 'FAILED',
      assignee: '김윤재', assigneeUserId: 7, defectStatus: 'OPEN', defectFailCount: 3 }),
    item({ grep: '탈퇴된다', title: '탈퇴된다', line: 20, enabled: false, lastStatus: null }),
    item({ specPath: 'tests/off.spec.ts', grep: '꺼진 파일', title: '꺼진 파일', enabled: false, parentEnabled: false, lastStatus: null }),
  ],
  summary: { total: 4, enabled: 2, disabled: 2, passed: 1, failed: 1, notRun: 0, completionRate: 0.5 },
};

const noDaily: PlanDailyResponse = { days: ['2026-11-21', '2026-11-22'], items: [], totals: [] };

beforeEach(() => {
  vi.mocked(api.plan.get).mockResolvedValue(plan);
  vi.mocked(api.plan.daily).mockResolvedValue(noDaily);
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
    expect(rows[0]).toEqual(['TC ID', '대분류', '케이스명', '사용', '담당자', '마감일', '우선순위', '판정', '최근 실행', '직전 결과', '결함']);
    expect(rows).toHaveLength(5);
    expect(rows[1]).toEqual(['TC-001', 'tests/login.spec.ts', '로그인된다', '사용', '(계정 없음) 윤재', '', '', 'Pass', '', 'Fail', '해결']);
    expect(rows[2].slice(2, 8)).toEqual(['로그아웃된다', '사용', '김윤재', '', '', 'Fail']);
    expect(rows[2].slice(9)).toEqual(['Fail', '미해결 · 3회 연속 실패']);
    expect(rows[3].slice(2, 4)).toEqual(['탈퇴된다', '미사용']);
    expect(rows[3][7]).toBe('Untested');
    expect(rows[3].slice(9)).toEqual(['Untested', '']);
  });

  it('직전 결과와 결과 변경을 보여 주고 미해결 결함에서 결함 목록을 연다', async () => {
    const onOpenDefects = vi.fn();
    render(<PlanTab projectId="p1" onRun={() => {}} onOpenDefects={onOpenDefects} />);

    const openDefect = await screen.findByRole('button', { name: '미해결 · 3회 연속 실패' });
    const columnIndex = (name: string) => Number(screen.getByText(name).closest('[aria-colindex]')?.getAttribute('aria-colindex'));
    expect(columnIndex('직전 결과')).toBe(columnIndex('최근 결과') + 1);
    expect(columnIndex('결함')).toBe(columnIndex('직전 결과') + 1);
    expect(screen.getByTitle('결과 변경: 실패 → 성공').parentElement?.textContent).toContain('실패');
    expect(screen.getByText('해결')).toBeTruthy();
    fireEvent.click(openDefect);
    expect(onOpenDefects).toHaveBeenCalledOnce();

    vi.mocked(api.plan.patch).mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('checkbox', { name: '로그아웃된다 사용' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '미해결 · 3회 연속 실패' })).toBeNull());
  });

  it('미사용 행을 켜면 서버에서 결함을 다시 읽는다', async () => {
    vi.mocked(api.plan.patch).mockResolvedValue(undefined);
    vi.mocked(api.plan.get).mockResolvedValueOnce(plan).mockResolvedValueOnce({
      ...plan,
      items: plan.items.map((i) => i.title === '탈퇴된다'
        ? { ...i, enabled: true, lastStatus: 'FAILED', defectStatus: 'OPEN', defectFailCount: 1 }
        : i),
    });
    render(<PlanTab projectId="p1" onRun={() => {}} />);

    fireEvent.click(await screen.findByRole('checkbox', { name: '탈퇴된다 사용' }));
    expect(await screen.findByText('미해결 · 1회 연속 실패')).toBeTruthy();
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

describe('PlanTab — 정기 실행 날짜 칸 (F-3)', () => {
  const daily: PlanDailyResponse = {
    days: ['2026-11-21', '2026-11-22'],
    items: [
      { specPath: 'tests/login.spec.ts', grep: '로그인된다', cells: [
        { date: '2026-11-21', status: 'PASSED', executionId: 10 },
        { date: '2026-11-22', status: 'PASSED', executionId: 11 },
      ] },
      { specPath: 'tests/login.spec.ts', grep: '로그아웃된다', cells: [
        { date: '2026-11-21', status: null, executionId: null },
        { date: '2026-11-22', status: 'FAILED', executionId: 11 },
      ] },
    ],
    totals: [],
  };

  it('날짜 칸에 성공 · 실패 · 미실행을 기호로 보이고, 맨 아래에 일자별 통과율을 보인다', async () => {
    vi.mocked(api.plan.daily).mockResolvedValue(daily);
    render(<PlanTab projectId="p1" onRun={() => {}} />);

    expect(await screen.findByText('정기 실행 (최근 2일)')).toBeTruthy();
    expect(screen.getAllByText('11/21').length).toBeGreaterThan(0);
    expect(screen.getAllByText('11/22').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('11/21 성공').textContent).toBe('✓');
    expect(screen.getByRole('button', { name: '11/22 실패 · 결과 보기' }).textContent).toBe('✗');
    expect(screen.getAllByLabelText('11/21 미실행').length).toBeGreaterThan(0); // 로그아웃 · 결과 없는 행
    expect(screen.getByText('일자별 통과율')).toBeTruthy();
    expect(screen.getByLabelText('11/21 통과율 100%')).toBeTruthy();
    expect(screen.getByLabelText('11/22 통과율 50%')).toBeTruthy();
    expect(screen.queryByText(/정기 실행 기록이 아직 없어요/)).toBeNull();
  });

  it('실패 칸을 누르면 그 실행 결과를 그 케이스로 연다', async () => {
    vi.mocked(api.plan.daily).mockResolvedValue(daily);
    const onOpenExecution = vi.fn();
    render(<PlanTab projectId="p1" onRun={() => {}} onOpenExecution={onOpenExecution} />);
    fireEvent.click(await screen.findByRole('button', { name: '11/22 실패 · 결과 보기' }));
    expect(onOpenExecution).toHaveBeenCalledWith(11, { specPath: 'tests/login.spec.ts', title: '로그아웃된다' });
  });

  it('스위트를 고르면 통과율을 보이는 행만으로 다시 센다', async () => {
    vi.mocked(api.plan.daily).mockResolvedValue(daily);
    vi.mocked(api.testSuites.listByProject).mockResolvedValue([
      { id: 7, projectId: 'p1', name: '로그인 묶음', specPaths: ['tests/login.spec.ts'], grep: '로그인|탈퇴', caseCount: 2, sequential: false, createdAt: '' },
    ]);
    render(<PlanTab projectId="p1" onRun={() => {}} />);
    await screen.findByLabelText('11/22 통과율 50%');
    fireEvent.change(await screen.findByLabelText('스위트'), { target: { value: '7' } });
    expect(await screen.findByLabelText('11/22 통과율 100%')).toBeTruthy();
  });

  it('통과율 고정 행은 끌기 손잡이 · 파일 툴팁이 없다', async () => {
    vi.mocked(api.plan.daily).mockResolvedValue(daily);
    const { container } = render(<PlanTab projectId="p1" onRun={() => {}} />);
    const pinnedCell = (await screen.findByText('일자별 통과율')).closest('.ag-cell')!;
    const rowCell = screen.getByText('로그아웃된다').closest('.ag-cell')!;
    expect(container.querySelectorAll('.ag-body .ag-row-drag').length).toBe(4);
    expect(container.querySelectorAll('.ag-floating-bottom .ag-row-drag').length).toBe(0);

    const hover = async (el: Element) => {
      fireEvent.mouseOver(el);
      fireEvent.mouseEnter(el);
      fireEvent.mouseMove(el);
      await new Promise((r) => setTimeout(r, 600)); // tooltipShowDelay 300ms
    };
    const leave = async (el: Element) => {
      fireEvent.mouseOut(el);
      fireEvent.mouseLeave(el);
      await waitFor(() => expect(document.querySelector('.ag-tooltip')).toBeNull());
    };
    await hover(rowCell);
    expect(document.querySelector('.ag-tooltip')?.textContent).toBe('파일: tests/login.spec.ts (9줄)'); // 일반 행은 그대로
    await leave(rowCell);
    await hover(pinnedCell);
    expect(document.querySelector('.ag-tooltip')).toBeNull();
  });

  it('정기 실행 기록이 하나도 없으면 날짜 칸 대신 안내를 보인다', async () => {
    render(<PlanTab projectId="p1" onRun={() => {}} />);
    expect(await screen.findByText(/정기 실행 기록이 아직 없어요/)).toBeTruthy();
    expect(screen.queryByText(/정기 실행 \(최근/)).toBeNull();
    expect(screen.queryByText('일자별 통과율')).toBeNull();
  });
});
