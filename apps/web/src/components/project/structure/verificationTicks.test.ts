import { describe, expect, it } from 'vitest';
import { verificationTicks } from './ScreenNode';

describe('verificationTicks', () => {
  it('요소 하나에 눈금 하나, 통과 → 실패 → 미확인 순', () => {
    expect(verificationTicks({ elementCount: 4, passedCount: 2, failedCount: 1 })).toEqual(['passed', 'passed', 'failed', 'neutral']);
  });

  it('요소가 많으면 28칸으로 줄이되 실패는 적어도 한 칸 남긴다', () => {
    const ticks = verificationTicks({ elementCount: 200, passedCount: 199, failedCount: 1 });
    expect(ticks).toHaveLength(28);
    expect(ticks.filter((t) => t === 'failed')).toHaveLength(1);
  });

  it('요소가 없으면 눈금도 없다', () => {
    expect(verificationTicks({ elementCount: 0, passedCount: 0, failedCount: 0 })).toEqual([]);
  });
});
