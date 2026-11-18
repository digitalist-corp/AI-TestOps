import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/api/client';
import type { Me } from '@/lib/access';
import { StructureEmptyState } from './structure/StructureEmptyState';
import { ScreenDetailPanel } from './structure/ScreenDetailPanel';
import { FixProposals } from './FixProposalCard';

/**
 * 팀원(보기 · 실행)에게 서버가 403으로 막는 쓰기 버튼을 보이지 않는다.
 * PM · 관리자에게는 그대로 보인다. 서버 403은 RolePermissionIntegrationTest.
 */
let me: Me;
vi.mock('@/lib/access', async (orig) => {
  const mod = await orig<typeof import('@/lib/access')>();
  return { ...mod, useAccess: () => mod.accessOf(me) };
});
vi.mock('@/api/client', () => ({
  api: {
    aiJobs: { listByProject: vi.fn() },
    getSiteMapNode: vi.fn(),
  },
}));
vi.mock('@/lib/aiEnabled', () => ({ useAiEnabled: () => ({ active: true, checked: true }) }));

const member = (role: 'PM' | 'MEMBER'): Me => ({ id: 9, username: 'u', displayName: null, role: 'USER', projects: [{ projectId: 'p1', role }] });

beforeEach(() => {
  vi.mocked(api.aiJobs.listByProject).mockResolvedValue([
    { id: 3, status: 'PROPOSED', type: 'FIX', projectId: 'p1', failedExecutionId: 7, summary: '셀렉터를 바꿉니다' } as never,
  ]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const emptyState = () =>
  render(
    <MemoryRouter>
      <StructureEmptyState projectId="p1" running={false} urlRun={false} busy={false} siteReady sourceHint={null}
        onFindBySite={vi.fn()} onFindByCode={vi.fn()} onAddNode={vi.fn()} />
    </MemoryRouter>,
  );

const detail = {
  node: {
    routeKey: '/login', title: '로그인', note: '로그인 화면 메모', excluded: false, stale: false, origin: 'SITE_URL',
    elementCount: 0, sourceFile: null, authRequired: false, hasScreenshot: false,
  },
  elements: [],
  edges: [],
  forms: [],
  tests: [],
};
const panel = () =>
  render(
    <MemoryRouter>
      <ScreenDetailPanel projectId="p1" routeKey="/login" onClose={vi.fn()} onAdd={vi.fn()} onJump={vi.fn()}
        onNodeUpdated={vi.fn()} loadDetail={async () => detail as never} />
    </MemoryRouter>,
  );

describe('팀원에게 서버가 막는 버튼', () => {
  it('화면 지도 빈 상태: 팀원은 화면 찾기 · 녹화 · 화면 직접 추가 대신 안내만', () => {
    me = member('MEMBER');
    emptyState();
    expect(screen.queryByText('화면 직접 추가하기')).toBeNull();
    expect(screen.queryByText('사이트 주소로 화면 찾기')).toBeNull();
    expect(screen.queryByText('저장소 코드로 화면 찾기')).toBeNull();
    expect(screen.queryByText('직접 클릭해서 테스트 만들기')).toBeNull();
    expect(screen.getByText(/PM이 화면을 찾으면 여기에 보여요/)).toBeTruthy();
  });

  it('화면 지도 빈 상태: PM은 모두 본다', () => {
    me = member('PM');
    emptyState();
    expect(screen.getByText('화면 직접 추가하기')).toBeTruthy();
    expect(screen.getByText('사이트 주소로 화면 찾기')).toBeTruthy();
  });

  it('화면 상세: 팀원은 경로에 추가 · 삭제 · 메모 저장 · 제외 스위치를 보지 않고 메모는 읽기만', async () => {
    me = member('MEMBER');
    panel();
    expect(await screen.findByText('로그인 화면 메모')).toBeTruthy(); // 읽기 전용 글
    expect(screen.queryByRole('textbox', { name: '화면 메모' })).toBeNull();
    expect(screen.queryByRole('button', { name: /경로에 추가/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /삭제/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /메모 저장/ })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('화면 상세: PM은 모두 본다', async () => {
    me = member('PM');
    panel();
    expect(await screen.findByRole('button', { name: /메모 저장/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /삭제/ })).toBeTruthy();
    expect(screen.getByRole('switch')).toBeTruthy();
  });

  it('AI 수정 제안: 팀원은 진행 · 닫기 없이 내용만 본다', async () => {
    me = member('MEMBER');
    render(<MemoryRouter><FixProposals projectId="p1" executionId={7} /></MemoryRouter>);
    await waitFor(() => expect(api.aiJobs.listByProject).toHaveBeenCalled());
    expect(await screen.findByText('셀렉터를 바꿉니다')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /진행/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /닫기/ })).toBeNull();
  });
});
