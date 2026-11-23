import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_PROJECT_FORM, type Project } from '@/types';
import { ProjectFormDialog } from './ProjectFormDialog';

vi.mock('@/lib/aiEnabled', () => ({ useAiEnabled: () => ({ active: false }) }));
vi.mock('@/api/client', () => ({ api: { getTemplates: vi.fn().mockResolvedValue([]) } }));

afterEach(cleanup);

describe('ProjectFormDialog — 등록 화면 단순화', () => {
  it('환경 선택과 부가설명 없이 이름 · 사이트 · 담당자를 바로 입력한다', () => {
    render(<ProjectFormDialog open onOpenChange={() => {}} onSubmit={async () => {}} title="프로젝트 등록" />);

    expect(screen.queryByRole('button', { name: '운영' })).toBeNull();
    expect(screen.queryByText(/기본값으로 시작합니다/)).toBeNull();
    // 상세 설정을 펼치지 않아도 담당자 칸이 보인다
    expect(screen.getByLabelText('담당자')).toBeTruthy();
    // 아이디는 서버가 자동으로 붙인다 (#120)
    expect(screen.queryByLabelText(/아이디|ID/)).toBeNull();
    expect(screen.getByText(/등록하면 자동으로 붙습니다/)).toBeTruthy();
  });

  it('이름 · 사이트 · 담당자만으로 저장한다', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProjectFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} title="프로젝트 등록" />);

    expect(screen.getByRole('button', { name: /일회용 러너/, pressed: true })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /서버에서 바로 실행/ })).toBeNull();
    fireEvent.change(screen.getByLabelText(/사이트/), { target: { value: 'https://shop.example.com' } });
    fireEvent.change(screen.getByLabelText(/프로젝트 이름/), { target: { value: 'shop' } });
    fireEvent.change(screen.getByLabelText('담당자'), { target: { value: '홍길동' } });
    fireEvent.click(screen.getByRole('button', { name: '등록' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      managerName: '홍길동',
      dockerEnabled: true,
      runnerLifecycle: 'EPHEMERAL',
    });
  });
});

describe('ProjectFormDialog — 실행 방식 수정', () => {
  const project: Project = {
    ...DEFAULT_PROJECT_FORM,
    projectId: 'shop',
    projectName: '쇼핑몰',
    repositoryConnected: false,
    dockerStatus: 'NOT_CONFIGURED',
    runnerActivity: 'UNAVAILABLE',
    dockerContainerId: null,
    latestExecutionId: null,
    latestExecutionStatus: null,
    latestExecutionAt: null,
    latestExecutionDurationMs: null,
    createdAt: '',
    updatedAt: '',
    updatedBy: null,
    updatedByName: null,
  };

  it('기존 서버 실행은 현재 값으로만 표시하고 일회용으로 바꾸면 숨긴다', async () => {
    const initial = { ...project, dockerEnabled: false, runnerLifecycle: 'PERSISTENT' } as const;
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProjectFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} title="프로젝트 수정" initial={initial} />);

    const serverMode = screen.getByRole<HTMLButtonElement>('button', { name: /^서버에서 바로 실행/, pressed: true });
    expect(serverMode.disabled).toBe(true);
    expect(screen.getByText("이 방식은 지금 테스트를 실행할 수 없어요. '일회용 러너'로 바꿔 주세요.")).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^일회용 러너/ }));
    expect(screen.queryByRole('button', { name: /^서버에서 바로 실행/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^일회용 러너/, pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ dockerEnabled: true, runnerLifecycle: 'EPHEMERAL' });
  });

  it.each([
    ['EPHEMERAL', '일회용 러너'],
    ['PERSISTENT', '상주 컨테이너'],
  ] as const)('%s 프로젝트를 수정하면 현재 러너만 선택되고 서버 실행은 숨겨진다', (runnerLifecycle, title) => {
    const initial = { ...project, dockerEnabled: true, runnerLifecycle };
    render(<ProjectFormDialog open onOpenChange={() => {}} onSubmit={async () => {}} title="프로젝트 수정" initial={initial} />);

    expect(screen.getByRole('button', { name: new RegExp(`^${title}`), pressed: true })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^서버에서 바로 실행/ })).toBeNull();
  });
});

describe('ProjectFormDialog — PM 고르기', () => {
  it('등록할 때 고른 PM 을 함께 보낸다', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ProjectFormDialog
        open
        onOpenChange={() => {}}
        onSubmit={onSubmit}
        title="프로젝트 등록"
        pmCandidates={[{ id: 7, label: '김윤재 (kim)' }]}
      />
    );

    fireEvent.change(screen.getByLabelText(/사이트/), { target: { value: 'https://shop.example.com' } });
    fireEvent.change(screen.getByLabelText(/프로젝트 이름/), { target: { value: 'shop' } });
    fireEvent.change(screen.getByLabelText('PM'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: '등록' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ pmUserId: 7 });
  });
});

describe('ProjectFormDialog — 기간 · 상태 (#117)', () => {
  it('상태 · 시작일 · 종료일을 함께 보내고, 종료일이 시작일보다 앞서면 막는다', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProjectFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} title="프로젝트 등록" />);

    fireEvent.change(screen.getByLabelText(/사이트/), { target: { value: 'https://shop.example.com' } });
    fireEvent.change(screen.getByLabelText(/프로젝트 이름/), { target: { value: 'shop' } });
    expect(screen.queryByRole('option', { name: 'PLANNED' })).toBeNull();
    fireEvent.change(screen.getByLabelText('상태'), { target: { value: 'RUNNING' } });
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-11-01' } });
    fireEvent.click(screen.getByRole('button', { name: '등록' }));

    expect(await screen.findByText('종료일이 시작일보다 앞설 수 없습니다.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: '등록' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ status: 'RUNNING', startDate: '2026-12-01', endDate: '2026-12-31' });
  });
});
