import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScenarioCaseNode, ScenarioTree } from '@/types';
import { confirmFullRun, enabledCaseCount } from '@/lib/runConfirm';

const test = (title: string, enabled = true): ScenarioCaseNode =>
  ({ type: 'TEST', title, line: 1, grep: title, enabled, children: [] });
const describeNode = (enabled: boolean, children: ScenarioCaseNode[]): ScenarioCaseNode =>
  ({ type: 'DESCRIBE', title: '묶음', line: 1, grep: '묶음', enabled, children });

const tree: ScenarioTree = {
  projectId: 'shop',
  totalSpecs: 3,
  totalCases: 6,
  specs: [
    { path: 'a.spec.ts', caseCount: 3, enabled: true, cases: [test('1'), test('2', false), describeNode(true, [test('3')])] },
    { path: 'b.spec.ts', caseCount: 1, enabled: false, cases: [test('4')] },
    { path: 'c.spec.ts', caseCount: 2, enabled: true, cases: [describeNode(false, [test('5'), test('6')])] },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe('enabledCaseCount', () => {
  it('꺼 둔 파일 · 묶음 · 케이스는 빼고 전체 실행에 들어갈 케이스만 센다', () => {
    expect(enabledCaseCount(tree)).toBe(2);
  });
});

describe('confirmFullRun', () => {
  it('프로젝트 이름과 항목 수를 묻고, 사용자의 답을 그대로 돌려준다', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const ok = await confirmFullRun('쇼핑몰', async () => tree);
    expect(ok).toBe(false);
    expect(confirmSpy.mock.calls[0][0]).toBe("'쇼핑몰' 프로젝트를 실행할까요?\n실행할 항목 2건");
  });

  it('항목 수를 못 읽어도 이름만으로 묻는다', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(await confirmFullRun('쇼핑몰', () => Promise.reject(new Error('x')))).toBe(true);
    expect(confirmSpy.mock.calls[0][0]).toBe("'쇼핑몰' 프로젝트를 실행할까요?");
  });
});
