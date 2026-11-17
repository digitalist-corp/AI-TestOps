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
  it('상단 그룹은 입력 → 계획 → 실행 → 대시보드 → 설정 순서이고, AI 는 켰을 때만 붙는다', () => {
    expect(visibleWorkspaceGroups(false).map((g) => g.label)).toEqual(['입력', '계획', '실행', '대시보드', '설정']);
    expect(visibleWorkspaceGroups(true).map((g) => g.id)).toEqual(['input', 'plan', 'runs', 'dashboard', 'settings', 'ai']);
    expect(WORKSPACE_GROUPS.find((g) => g.id === 'input')?.tabs).toEqual(['input']);
    expect(WORKSPACE_GROUPS.find((g) => g.id === 'plan')?.tabs).toEqual(['plan', 'scenarios', 'recorder', 'structure']);
    expect(WORKSPACE_GROUPS.find((g) => g.id === 'runs')?.tabs).toEqual(['runs', 'results', 'schedules']);
    expect(WORKSPACE_GROUPS.find((g) => g.id === 'settings')?.tabs).toEqual(['settings', 'members', 'source']);
    expect(WORKSPACE_GROUPS.find((g) => g.id === 'ai')?.tabs).toEqual(['ai-generate', 'ai-analysis', 'ai-review']);
    expect(tabLabel('structure')).toBe('화면 지도');
  });

  it("'클릭으로 만들기'(recorder)는 계획 그룹에 있고, AI 를 꺼도 보인다", () => {
    expect(groupOfTab('recorder').id).toBe('plan');
    expect(tabLabel('recorder')).toBe('클릭으로 만들기');
    expect(visibleWorkspaceGroups(false).find((g) => g.id === 'plan')?.tabs).toContain('recorder');
    expect(PROJECT_WORKSPACE_TABS.find((t) => t.id === 'recorder')?.description).toBe(
      '사이트를 직접 눌러 테스트 녹화'
    );
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
    expect(groupOfTab('structure').id).toBe('plan');
    expect(groupOfTab('ai-generate').id).toBe('ai');
    expect(groupOfTab('ai-analysis').id).toBe('ai');
    expect(groupOfTab('ai-review').id).toBe('ai');
    expect(tabLabel('source')).toBe('코드 편집기');
  });

  it("레일 메뉴에서 전역 '/ai-jobs' 가 제거되었다", () => {
    expect(RAIL_ITEMS.some((item) => item.to === '/ai-jobs')).toBe(false);
  });
});

describe('팀원에게 보이는 탭', () => {
  it('팀원은 고치는 탭(입력 · 시나리오 · 녹화 · 코드 편집기 · 예약 · AI 생성 · 검토)을 보지 않는다', () => {
    const groups = visibleWorkspaceGroups(true, false);
    expect(groups.map((g) => g.id)).toEqual(['plan', 'runs', 'dashboard', 'settings', 'ai']);
    expect(groups.find((g) => g.id === 'plan')?.tabs).toEqual(['plan', 'structure']);
    expect(groups.find((g) => g.id === 'runs')?.tabs).toEqual(['runs', 'results']);
    expect(groups.find((g) => g.id === 'settings')?.tabs).toEqual(['settings', 'members']);
    expect(groups.find((g) => g.id === 'ai')?.tabs).toEqual(['ai-analysis']);
  });

  it('PM · 관리자는 모든 탭을 본다', () => {
    expect(visibleWorkspaceGroups(true, true)).toEqual(visibleWorkspaceGroups(true));
  });
});
