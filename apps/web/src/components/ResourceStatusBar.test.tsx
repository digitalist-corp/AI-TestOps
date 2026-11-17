import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { api } from '@/api/client';
import { ResourceStatusBar } from './ResourceStatusBar';

vi.mock('@/api/client', () => ({
  api: { getDockerHostResources: vi.fn(), getRunnerCapacity: vi.fn() },
}));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.getDockerHostResources).mockResolvedValue(null as never);
  vi.mocked(api.getRunnerCapacity).mockResolvedValue(null as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ResourceStatusBar', () => {
  it('기본은 접혀 있고, 펼치면 자원 항목이 보이며 다시 열어도 그 상태를 기억한다', () => {
    render(<ResourceStatusBar />);
    expect(screen.queryByText('메모리')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '리소스 현황 펼치기' }));
    expect(screen.getByText('메모리')).toBeTruthy();

    cleanup();
    render(<ResourceStatusBar />);
    expect(screen.getByText('메모리')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '리소스 현황 접기' }));
    expect(screen.queryByText('메모리')).toBeNull();
  });

  it('저장소를 읽거나 쓸 수 없어도 깨지지 않는다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<ResourceStatusBar />);
    fireEvent.click(screen.getByRole('button', { name: '리소스 현황 펼치기' }));
    expect(screen.getByText('메모리')).toBeTruthy();
  });
});
