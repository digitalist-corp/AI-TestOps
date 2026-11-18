import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ExecutionsTab } from './ExecutionsTab';

vi.mock('ag-grid-react', () => ({ AgGridReact: () => <div data-testid="grid" /> }));
vi.mock('@/components/project/ExecutionLogPanel', () => ({ ExecutionLogPanel: () => null }));

afterEach(cleanup);

const props = {
  executions: [],
  loading: false,
  activeExecutionId: null,
  onRefresh: vi.fn(),
  onSelect: vi.fn(),
  onCancel: vi.fn(),
  onDelete: vi.fn(),
  onReset: vi.fn(),
  selectedId: null,
};

describe('실행 이력 (#108)', () => {
  it('팀원에게는 이력 삭제 · 초기화 버튼을 보이지 않는다 (서버도 막는다)', () => {
    render(<ExecutionsTab {...props} canManage={false} />);
    expect(screen.getByRole('button', { name: /새로고침/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /선택 삭제/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /전체 초기화/ })).toBeNull();
  });

  it('PM · 관리자에게는 보인다', () => {
    render(<ExecutionsTab {...props} />);
    expect(screen.getByRole('button', { name: /선택 삭제/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /전체 초기화/ })).toBeTruthy();
  });
});
