import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  });

  it('환경을 고르지 않아도 기존 기본값(DEV)으로 저장한다', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProjectFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} title="프로젝트 등록" />);

    fireEvent.change(screen.getByLabelText(/사이트/), { target: { value: 'https://shop.example.com' } });
    fireEvent.change(screen.getByLabelText(/프로젝트 이름/), { target: { value: 'shop' } });
    fireEvent.change(screen.getByLabelText('담당자'), { target: { value: '홍길동' } });
    fireEvent.click(screen.getByRole('button', { name: '등록' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ serverType: 'DEV', managerName: '홍길동' });
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
