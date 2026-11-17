import { describe, expect, it } from 'vitest';
import { executionStatusLabel, formatDuration } from '@/lib/utils';

describe('formatDuration', () => {
  it('1분 미만은 초만, 넘으면 분 · 초로 보여 준다', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(44_000)).toBe('44초');
    expect(formatDuration(164_000)).toBe('2분 44초');
    expect(formatDuration(120_000)).toBe('2분');
    expect(formatDuration(4_200)).toBe('4초');
  });
});

describe('executionStatusLabel', () => {
  it('실행 상태 코드를 한글로 바꾼다', () => {
    expect(executionStatusLabel.PASSED).toBe('성공');
    expect(executionStatusLabel.FAILED).toBe('실패');
    expect(executionStatusLabel.RUNNING).toBe('실행 중');
  });
});
