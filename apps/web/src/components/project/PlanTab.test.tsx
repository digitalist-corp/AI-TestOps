import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/api/client';
import type { AiJob, PlanDailyResponse, PlanItem, PlanResponse, SiteMap } from '@/types';
import { PlanTab } from './PlanTab';
import { downloadCsv } from '@/lib/csv';

vi.mock('@/lib/csv', () => ({ downloadCsv: vi.fn() }));

vi.mock('@/api/client', () => ({
  api: {
    plan: {
      get: vi.fn(), patch: vi.fn(), reorder: vi.fn(), setEnabled: vi.fn(), daily: vi.fn(),
      create: vi.fn(), bulkCreate: vi.fn(), link: vi.fn(), linkSuggestions: vi.fn(),
      generate: vi.fn(), bulkGenerate: vi.fn(), patchEntry: vi.fn(), unlink: vi.fn(), deleteEntry: vi.fn(),
    },
    getScenarios: vi.fn(),
    testSuites: { listByProject: vi.fn() },
    getSiteMap: vi.fn(),
    getSiteMapCoverage: vi.fn(),
    members: { list: vi.fn() },
  },
}));

const item = (over: Partial<PlanItem>): PlanItem => ({
  planId: null, stage: 'WRITTEN', screenRouteKey: null, expected: null, aiJobId: null, aiJobStatus: null,
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
  screens: [],
  summary: { total: 4, enabled: 2, unwritten: 0, written: 2, writtenRate: 1, disabled: 2, passed: 1, failed: 1, notRun: 0, completionRate: 0.5 },
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
    expect(rows[0]).toEqual(['TC ID', '대분류', '케이스명', '사용', '담당자', '마감일', '우선순위', '판정', '최근 실행', '직전 결과', '결함', '작성 상태', '확인할 내용']);
    expect(rows).toHaveLength(5);
    expect(rows[1]).toEqual(['TC-001', 'tests/login.spec.ts', '로그인된다', '사용', '(계정 없음) 윤재', '', '', 'Pass', '', 'Fail', '해결', '작성됨', '']);
    expect(rows[2].slice(2, 8)).toEqual(['로그아웃된다', '사용', '김윤재', '', '', 'Fail']);
    expect(rows[2].slice(9)).toEqual(['Fail', '미해결 · 3회 연속 실패', '작성됨', '']);
    expect(rows[3].slice(2, 4)).toEqual(['탈퇴된다', '미사용']);
    expect(rows[3][7]).toBe('Untested');
    expect(rows[3].slice(9)).toEqual(['Untested', '', '작성됨', '']);
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
    vi.mocked(api.plan.get).mockResolvedValue({ ...plan, items: [{ ...plan.items[0], planId: 13 }, ...plan.items.slice(1)] });
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

describe('PlanTab — 계획 먼저 작성', () => {
  const unwritten = item({
    planId: 13, stage: 'UNWRITTEN', title: '영수증 확인', specPath: '', grep: '', line: 0,
    lastStatus: null, expected: '결제 금액을 표시한다.',
  });
  const pending = (changes: Partial<PlanItem> = {}): PlanResponse => ({
    ...plan,
    items: [...plan.items, { ...unwritten, ...changes }],
    summary: { ...plan.summary, total: 5, enabled: 3, unwritten: 1, writtenRate: 2 / 3, completionRate: 1 / 3 },
  });
  const view = (readOnly = false, aiOff = false) => render(
    <MemoryRouter><PlanTab projectId="p1" readOnly={readOnly} aiOff={aiOff} onRun={() => {}} /></MemoryRouter>,
  );

  beforeEach(() => vi.mocked(api.plan.get).mockResolvedValue(pending()));

  it('작성 상태와 행동을 보이고, 미작성은 실행 수에서 빼며 작성률과 완료율은 요약에 표시한다', async () => {
    view();
    expect(await screen.findByText('미작성')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'AI로 만들기' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '기존 테스트 연결' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '클릭으로 만들기' }).getAttribute('href')).toBe('/projects/p1/recorder?plan=13');
    expect(screen.getByRole('button', { name: '체크한 2건 실행' })).toBeTruthy();
    expect(screen.getByText('계획 5 · 작성 2 (67%) · 완료 1 (33%)')).toBeTruthy();
  });

  it('팀원은 계획 배지를 볼 수 있고 계획 편집 행동은 숨겨진다', async () => {
    view(true);
    expect(await screen.findByText('미작성')).toBeTruthy();
    for (const name of ['계획 추가', '엑셀에서 붙여넣기', 'AI 연결 추천', 'AI로 만들기', '기존 테스트 연결', '영수증 확인 계획 삭제']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByRole('link', { name: '클릭으로 만들기' })).toBeNull();
  });

  it('행에서 AI 생성을 요청하고 다음 조회에서 승인 안내를 보인다', async () => {
    const job = { id: 8, status: 'RUNNING', targetSpecPath: 'tests/plan/plan-13.spec.ts' } as AiJob;
    vi.mocked(api.plan.generate).mockResolvedValue(job);
    vi.mocked(api.plan.get)
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(pending({ aiJobId: 8, aiJobStatus: 'RUNNING' }))
      .mockResolvedValue(pending({ aiJobId: 8, aiJobStatus: 'NEEDS_REVIEW' }));
    view();
    const button = await screen.findByRole('button', { name: 'AI로 만들기' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await act(async () => fireEvent.click(button));
      expect(api.plan.generate).toHaveBeenCalledWith('p1', 13);
      expect(screen.getByText('AI 작성 중')).toBeTruthy();
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(screen.getByText('검토 대기')).toBeTruthy();
      expect(screen.getByRole('link', { name: 'AI 검토에서 승인하세요' }).getAttribute('href')).toBe('/projects/p1/ai-review');
    } finally {
      vi.useRealTimers();
    }
  });

  it('선택한 미작성 계획 한 건도 일괄 생성 요청으로 보낸다', async () => {
    vi.mocked(api.plan.bulkGenerate).mockResolvedValue({ jobs: [] });
    view();
    fireEvent.click(await screen.findByText('영수증 확인'));
    fireEvent.click(await screen.findByRole('button', { name: 'AI로 1건 만들기' }));
    await waitFor(() => expect(api.plan.bulkGenerate).toHaveBeenCalledWith('p1', [13]));
    expect(api.plan.generate).not.toHaveBeenCalled();
  });

  it('미작성 행 제목을 편집할 때 바꾸지 않은 확인할 내용과 계획 칸을 유지한다', async () => {
    vi.mocked(api.plan.patchEntry).mockResolvedValue(undefined);
    view();
    const cell = (await screen.findByText('영수증 확인')).closest('.ag-cell')!;
    fireEvent.doubleClick(cell);
    const editor = within(cell as HTMLElement).getByRole('textbox');
    fireEvent.input(editor, { target: { value: '합계 확인' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    await waitFor(() => expect(api.plan.patchEntry).toHaveBeenCalledWith('p1', 13, {
      title: '합계 확인', screenRouteKey: null, expected: '결제 금액을 표시한다.',
      assigneeUserId: null, dueDate: null, priority: null, enabled: true,
    }));
    expect(await screen.findByLabelText('합계 확인 사용')).toBeTruthy();
  });

  it('모든 행이 미작성이면 실행을 잠근다', async () => {
    vi.mocked(api.plan.get).mockResolvedValue({ ...pending(), items: [unwritten] });
    view();
    const button = await screen.findByRole('button', { name: '체크한 0건 실행' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('연결 후보에서 기존 테스트를 선택해 계획에 연결한다', async () => {
    vi.mocked(api.plan.link).mockResolvedValue(undefined);
    view();
    fireEvent.click(await screen.findByRole('button', { name: '기존 테스트 연결' }));
    const dialog = within(await screen.findByRole('dialog'));
    const picker = dialog.getByRole('combobox');
    const option = dialog.getByRole('option', { name: '로그인된다 (tests/login.spec.ts)' }) as HTMLOptionElement;
    fireEvent.change(picker, { target: { value: option.value } });
    fireEvent.click(dialog.getByRole('button', { name: '연결' }));
    await waitFor(() => expect(api.plan.link).toHaveBeenCalledWith('p1', 13, { specPath: 'tests/login.spec.ts', grep: '로그인된다' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('미작성 계획의 사용 여부는 계획 ID로 저장한다', async () => {
    vi.mocked(api.plan.setEnabled).mockResolvedValue(undefined);
    view();
    fireEvent.click(await screen.findByRole('checkbox', { name: '영수증 확인 사용' }));
    await waitFor(() => expect(api.plan.setEnabled).toHaveBeenCalledWith('p1', [{ planId: 13, specPath: '', grep: '' }], false));
  });

  it('추천의 이유를 보여 주고 선택한 짝만 연결한다', async () => {
    vi.mocked(api.plan.linkSuggestions).mockResolvedValue({
      suggestions: [{ planId: 13, specPath: 'tests/login.spec.ts', grep: '로그인된다', caseTitle: '로그인된다', reason: '인증 후에 열리는 화면' }],
    });
    vi.mocked(api.plan.link).mockResolvedValue(undefined);
    view();
    fireEvent.click(await screen.findByRole('button', { name: 'AI 연결 추천' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByText('인증 후에 열리는 화면')).toBeTruthy();
    expect(api.plan.link).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('checkbox'));
    fireEvent.click(dialog.getByRole('button', { name: '선택한 1건 연결' }));
    await waitFor(() => expect(api.plan.link).toHaveBeenCalledWith('p1', 13, { specPath: 'tests/login.spec.ts', grep: '로그인된다' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('사용자 설정에서 AI가 꺼졌으면 추천 안내를 보인다', async () => {
    view(false, true);
    fireEvent.click(await screen.findByRole('button', { name: 'AI 연결 추천' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('alert').textContent).toContain('AI가 꺼져 있어요.');
    expect(api.plan.linkSuggestions).not.toHaveBeenCalled();
  });

  it('계획 추가는 화면 지도와 멤버 선택값을 저장하고 @가 포함된 제목을 막는다', async () => {
    vi.mocked(api.plan.create).mockResolvedValue(unwritten);
    vi.mocked(api.getSiteMap).mockResolvedValue({ nodes: [{ routeKey: '/receipt', title: '영수증 화면' }] } as SiteMap);
    view();
    fireEvent.click(await screen.findByRole('button', { name: '계획 추가' }));
    const dialog = within(await screen.findByRole('dialog'));
    const title = dialog.getByLabelText('제목');
    fireEvent.change(title, { target: { value: '영수증 @확인' } });
    expect(dialog.getByRole('alert').textContent).toContain('@와 줄바꿈');
    fireEvent.change(title, { target: { value: '영수증 확인' } });
    fireEvent.change(dialog.getByLabelText('화면'), { target: { value: '/receipt' } });
    fireEvent.change(dialog.getByLabelText('담당자'), { target: { value: '7' } });
    fireEvent.change(dialog.getByLabelText('확인할 내용'), { target: { value: '결제 금액을 표시한다.' } });
    fireEvent.click(dialog.getByRole('button', { name: '계획 추가' }));
    await waitFor(() => expect(api.plan.create).toHaveBeenCalledWith('p1', {
      title: '영수증 확인', screenRouteKey: '/receipt', assigneeUserId: 7,
      dueDate: null, priority: null, expected: '결제 금액을 표시한다.',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('붙여넣기 미리보기에서 매칭 실패를 알리고 확인한 행을 일괄 추가한다', async () => {
    vi.mocked(api.plan.bulkCreate).mockResolvedValue({ created: 1 });
    view();
    fireEvent.click(await screen.findByRole('button', { name: '엑셀에서 붙여넣기' }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.change(dialog.getByRole('textbox'), { target: { value: '정산 확인\t누락된 화면\t7\t2026.11.22\t보통\t금액 확인' } });
    expect(dialog.getByText('화면 미지정 (누락된 화면)')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: '1건 추가' }));
    await waitFor(() => expect(api.plan.bulkCreate).toHaveBeenCalledWith('p1', [{
      title: '정산 확인', screenRouteKey: null, assigneeUserId: 7,
      dueDate: '2026-11-22', priority: 'MEDIUM', expected: '금액 확인',
    }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
