import { describe, expect, it } from 'vitest';
import { PROJECT_WORKSPACE_TABS } from '@/config/projectWorkspace';
import {
  RAIL_ITEMS,
  WORKSPACE_GROUPS,
  groupOfTab,
  tabLabel,
  visibleWorkspaceGroups,
} from '@/config/shellNav';

describe('shellNav', () => {
  it('visibleWorkspaceGroups(false) 에는 ai 그룹이 없고, true 에는 포함된다', () => {
    const withoutAi = visibleWorkspaceGroups(false);
    expect(withoutAi.map((g) => g.id)).toEqual([
      'dashboard',
      'structure',
      'scenarios',
      'runs',
      'settings',
    ]);
    expect(withoutAi.some((g) => g.id === 'ai')).toBe(false);

    const withAi = visibleWorkspaceGroups(true);
    expect(withAi.map((g) => g.id)).toEqual([
      'dashboard',
      'structure',
      'scenarios',
      'runs',
      'settings',
      'ai',
    ]);
    expect(withAi.find((g) => g.id === 'ai')?.tabs).toEqual([
      'ai-generate',
      'ai-analysis',
      'ai-review',
    ]);
  });

  it('모든 ProjectTabId 가 정확히 한 그룹에 속한다', () => {
    const groupedTabs = WORKSPACE_GROUPS.flatMap((group) => group.tabs);
    const allTabIds = PROJECT_WORKSPACE_TABS.map((tab) => tab.id);

    expect(groupedTabs.length).toBe(allTabIds.length);
    expect(new Set(groupedTabs)).toEqual(new Set(allTabIds));

    for (const tabId of allTabIds) {
      const matchingGroups = WORKSPACE_GROUPS.filter((g) => g.tabs.includes(tabId));
      expect(matchingGroups).toHaveLength(1);
    }
  });

  it("groupOfTab('source') 가 settings 이고 라벨은 코드 편집기다", () => {
    expect(groupOfTab('source').id).toBe('settings');
    expect(groupOfTab('structure').id).toBe('structure');
    expect(groupOfTab('ai-generate').id).toBe('ai');
    expect(groupOfTab('ai-analysis').id).toBe('ai');
    expect(groupOfTab('ai-review').id).toBe('ai');
    expect(tabLabel('source')).toBe('코드 편집기');
  });

  it("레일 메뉴에서 전역 '/ai-jobs' 가 제거되었다", () => {
    expect(RAIL_ITEMS.some((item) => item.to === '/ai-jobs')).toBe(false);
  });
});
