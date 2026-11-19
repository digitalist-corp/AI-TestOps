import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ProgressNote } from './ProgressNote';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('진행 표시', () => {
  it('돌고 있으면 스피너 · 경과 · 남은 시간을 보이고 1초마다 갱신한다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T00:00:30Z'));
    render(<ProgressNote label="테스트 실행 중" startedAt="2026-11-19T00:00:00Z" estimateMs={90_000} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('테스트 실행 중');
    expect(status.textContent).toContain('30초 경과 · 약 1분 남음');
    expect(status.querySelector('.animate-spin')).not.toBeNull();
    act(() => vi.advanceTimersByTime(5_000));
    expect(status.textContent).toContain('35초 경과 · 약 55초 남음');
  });

  it('사람 차례(기다림)는 스피너 · 남은 시간 없이 경과만', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T00:01:00Z'));
    render(<ProgressNote label="승인을 기다리는 중" startedAt="2026-11-19T00:00:00Z" estimateMs={10_000} waiting />);
    const status = screen.getByRole('status');
    expect(status.querySelector('.animate-spin')).toBeNull();
    expect(status.textContent).toContain('1분 경과');
    expect(status.textContent).not.toContain('남음');
  });
});
