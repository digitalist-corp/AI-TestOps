import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Project } from '@/types';
import { ProjectCard } from './ProjectCard';

const runningLog = 'Running 6 tests using 1 worker\n[1/6] a\n[2/6] b\n  1) [chromium] › b\n[3/6] c\n';
vi.mock('@/components/project/ExecutionLogPanel', () => ({
  useExecutionLogStream: (id: number | null) => ({ log: id ? runningLog : '', finished: false, status: null }),
}));

afterEach(cleanup);

const cardProject = {
  projectId: 'shop',
  projectName: '쇼핑몰',
  baseUrl: 'https://shop.example.com',
  managerName: '홍길동',
  dockerStatus: 'RUNNING',
  dockerEnabled: true,
  runnerLifecycle: 'PERSISTENT',
  runnerActivity: 'IDLE',
  nodeVersion: '22',
  playwrightVersion: '1.53.0',
  envVariables: '{}',
  loginEnvRequired: false,
  latestExecutionStatus: 'PASSED',
  latestExecutionAt: '2026-11-17T00:00:00Z',
  latestExecutionDurationMs: 164_000,
} as unknown as Project;

const noop = () => {};
const cardHandlers = { onOpen: noop, onRun: noop, onStop: noop, onEnv: noop, onGo: noop };

describe('ProjectCard', () => {
  it('프로젝트 이름을 제목으로 크게 보이고, 사이트 주소 · 환경은 보이지 않는다', () => {
    render(<ProjectCard project={cardProject} running={false} justCreated={false} {...cardHandlers} />);

    expect(screen.getByRole('heading', { name: '쇼핑몰' })).toBeTruthy();
    expect(screen.queryByText('https://shop.example.com')).toBeNull();
    expect(screen.queryByText('운영')).toBeNull();
    expect(screen.getByText(/2분 44초/)).toBeTruthy();
  });

  it('실행 중이면 진척도(완료 / 전체, 성공 · 실패)를 보이고, 환경변수 줄은 없다', () => {
    const running = { ...cardProject, latestExecutionStatus: 'RUNNING', latestExecutionId: 7 } as Project;
    render(<ProjectCard project={running} running={false} justCreated={false} {...cardHandlers} />);

    expect(screen.getByText('완료 2 / 6')).toBeTruthy();
    expect(screen.getByText('성공 1 · 실패 1')).toBeTruthy();
    expect(screen.queryByText('환경변수')).toBeNull();
  });
});

describe('ProjectCard — 환경변수 입력은 PM · 관리자만', () => {
  const missing = { ...cardProject, loginEnvRequired: true, envVariables: '{}' } as Project;

  it('PM · 관리자에게는 환경변수 버튼이 있다', () => {
    render(<ProjectCard project={missing} running={false} justCreated={false} {...cardHandlers} />);
    expect(screen.getByRole('button', { name: '환경변수' })).toBeTruthy();
  });

  it('팀원(onEnv 없음)에게는 버튼 대신 PM에게 요청하라고 안내한다', () => {
    const { onEnv: _omit, ...handlers } = cardHandlers;
    void _omit;
    render(<ProjectCard project={missing} running={false} justCreated={false} {...handlers} />);
    expect(screen.queryByRole('button', { name: '환경변수' })).toBeNull();
    expect(screen.getByText(/PM에게 입력을 요청하세요/)).toBeTruthy();
  });

  it('실행 중이면 실행 대신 중지 버튼이 보이고, 누르면 그 실행을 멈춘다', () => {
    const onRun = vi.fn();
    const onStop = vi.fn();
    const running = { ...cardProject, latestExecutionStatus: 'RUNNING', latestExecutionId: 7 } as Project;
    render(<ProjectCard project={running} running={false} justCreated={false} {...cardHandlers} onRun={onRun} onStop={onStop} />);

    expect(screen.queryByRole('button', { name: /^실행$/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /중지/ }));
    expect(onStop).toHaveBeenCalledWith(7);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('중지를 요청한 뒤에는 "중지 중"으로 바뀌고 다시 누를 수 없다', () => {
    const stopping = { ...cardProject, latestExecutionStatus: 'CANCEL_REQUESTED', latestExecutionId: 7 } as Project;
    render(<ProjectCard project={stopping} running={false} justCreated={false} {...cardHandlers} />);

    expect((screen.getByRole('button', { name: /중지 중/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
