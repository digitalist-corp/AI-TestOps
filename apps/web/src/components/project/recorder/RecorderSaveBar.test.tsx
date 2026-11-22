import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api, type RecorderApi } from '@/api/client';
import type { PlanResponse, RecordedStep } from '@/types';
import { RecorderSaveBar } from './RecorderSaveBar';

vi.mock('@/api/client', () => ({ api: { plan: { get: vi.fn() } } }));

const plan = { items: [{ planId: 13, title: '영수증 확인' }] } as PlanResponse;
const steps = [{ id: 1, kind: 'click' }] as unknown as RecordedStep[];

function view() {
  const rec = {
    code: vi.fn().mockResolvedValue({ code: '', specPath: 'tests/recorded/server.spec.ts' }),
    save: vi.fn().mockResolvedValue({ specPath: 'tests/plan/plan-13.spec.ts' }),
  } as unknown as RecorderApi;
  render(<RecorderSaveBar rec={rec} projectId="p1" sessionId="r1" planId={13} steps={steps} disabled={false}
                          onSaved={vi.fn()} onOpenTests={vi.fn()} onRun={vi.fn()} onEnd={vi.fn()} />);
  return rec;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('계획 제목과 파일 경로를 기본값으로 채우고 저장 요청에 보낸다', async () => {
  vi.mocked(api.plan.get).mockResolvedValue(plan);
  const rec = view();
  expect(await screen.findByDisplayValue('영수증 확인')).toBeTruthy();
  expect(screen.getByDisplayValue('tests/plan/plan-13.spec.ts')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  expect(await screen.findByText('테스트 파일로 저장했어요')).toBeTruthy();
  expect(rec.save).toHaveBeenCalledWith('p1', 'r1', { title: '영수증 확인', specPath: 'tests/plan/plan-13.spec.ts' });
  expect(rec.code).not.toHaveBeenCalled();
});

it('계획 조회가 늦어도 사용자가 직접 수정한 제목과 경로를 유지한다', async () => {
  let resolvePlan!: (value: PlanResponse) => void;
  vi.mocked(api.plan.get).mockReturnValue(new Promise((resolve) => { resolvePlan = resolve; }));
  const rec = view();
  fireEvent.change(screen.getByLabelText('테스트 이름'), { target: { value: '편집한 제목' } });
  fireEvent.change(screen.getByLabelText('저장 경로'), { target: { value: 'tests/custom.spec.ts' } });
  await act(async () => resolvePlan(plan));
  fireEvent.blur(screen.getByLabelText('테스트 이름'));
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(rec.save).toHaveBeenCalledWith('p1', 'r1', {
    title: '편집한 제목', specPath: 'tests/custom.spec.ts',
  }));
  expect(rec.code).not.toHaveBeenCalled();
});
