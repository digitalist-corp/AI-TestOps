import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Project } from '@/types';
import { ProjectCard } from './ProjectCard';

afterEach(cleanup);

const cardProject = {
  projectId: 'shop',
  projectName: '쇼핑몰',
  baseUrl: 'https://shop.example.com',
  serverType: 'PROD',
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
const cardHandlers = { onOpen: noop, onRun: noop, onEnv: noop, onGo: noop };

describe('ProjectCard', () => {
  it('프로젝트 이름을 제목으로 크게 보이고, 사이트 주소 · 환경은 보이지 않는다', () => {
    render(<ProjectCard project={cardProject} running={false} justCreated={false} {...cardHandlers} />);

    expect(screen.getByRole('heading', { name: '쇼핑몰' })).toBeTruthy();
    expect(screen.queryByText('https://shop.example.com')).toBeNull();
    expect(screen.queryByText('운영')).toBeNull();
    expect(screen.getByText(/2분 44초/)).toBeTruthy();
  });
});
