import { describe, expect, it } from 'vitest';
import type { SiteMap, SiteMapEdge, SiteMapNode } from '@/types';
import { autoSpecPath, buildSuggestions, DEFAULT_SUGGESTIONS, MAX_SUGGESTIONS } from './testSuggestions';

function node(routeKey: string, patch: Partial<SiteMapNode> = {}): SiteMapNode {
  return {
    routeKey,
    title: null,
    sourceFile: null,
    origin: 'CODE',
    stale: false,
    elementCount: 1,
    excluded: false,
    note: null,
    url: null,
    hasScreenshot: false,
    authRequired: false,
    passedCount: 0,
    failedCount: 0,
    unverifiedCount: 0,
    ...patch,
  };
}

function edge(from: string, to: string): SiteMapEdge {
  return { from, to, kind: 'link', label: null, selector: null };
}

function siteMap(nodes: SiteMapNode[], edges: SiteMapEdge[] = []): SiteMap {
  return { nodes, edges, layouts: [] } as unknown as SiteMap;
}

describe('autoSpecPath', () => {
  it('로컬 시각으로 0을 채운 경로를 만든다', () => {
    expect(autoSpecPath(new Date(2026, 0, 5, 3, 4, 9))).toBe('tests/ai/generated-20260105-030409.spec.ts');
    expect(autoSpecPath(new Date(2026, 11, 31, 23, 59, 58))).toBe('tests/ai/generated-20261231-235958.spec.ts');
  });

  it('백엔드가 막는 경로(빈 값, ..)가 나오지 않는다', () => {
    const path = autoSpecPath(new Date());
    expect(path).toMatch(/^tests\/ai\/generated-\d{8}-\d{6}\.spec\.ts$/);
    expect(path).not.toContain('..');
  });
});

describe('buildSuggestions', () => {
  it('siteMap 이 없거나 화면이 비면 기본 추천 3개를 routeKeys 없이 돌려준다', () => {
    for (const input of [null, siteMap([])]) {
      const result = buildSuggestions(input);
      expect(result).toHaveLength(3);
      expect(result.map((s) => s.text)).toEqual(DEFAULT_SUGGESTIONS.map((s) => s.text));
      expect(result.every((s) => s.routeKeys.length === 0)).toBe(true);
    }
  });

  it('제외 · 사라진 화면은 빼고, 모두 빠지면 기본 추천을 쓴다', () => {
    const result = buildSuggestions(
      siteMap([node('/a'), node('/hidden', { excluded: true }), node('/gone', { stale: true })])
    );
    const routes = result.flatMap((s) => s.routeKeys);
    expect(routes).toContain('/a');
    expect(routes).not.toContain('/hidden');
    expect(routes).not.toContain('/gone');

    const allHidden = buildSuggestions(siteMap([node('/hidden', { excluded: true }), node('/gone', { stale: true })]));
    expect(allHidden.every((s) => s.routeKeys.length === 0)).toBe(true);
  });

  it('요소가 많은 화면부터 최대 6개만 만든다', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => node(`/p${i}`, { elementCount: i }));
    const result = buildSuggestions(siteMap(nodes));
    expect(result).toHaveLength(MAX_SUGGESTIONS);
    expect(result[0].routeKeys).toEqual(['/p9']);
    expect(result[1].routeKeys).toEqual(['/p8']);
  });

  it('제목이 있으면 "제목 화면(경로)" 로 부른다', () => {
    const [first] = buildSuggestions(siteMap([node('/login', { title: '로그인' })]));
    expect(first.text).toBe('로그인 화면(/login)이 열리고 주요 입력란과 버튼이 보이는지 확인');
    const [noTitle] = buildSuggestions(siteMap([node('/board')]));
    expect(noTitle.text).toBe('/board 화면이 열리고 주요 입력란과 버튼이 보이는지 확인');
  });

  it('로그인 화면에는 잘못된 비밀번호 문장을 하나 더 만든다', () => {
    const result = buildSuggestions(siteMap([node('/auth/signin', { elementCount: 3 }), node('/home')]));
    const login = result.find((s) => s.text.includes('잘못된 비밀번호'));
    expect(login?.routeKeys).toEqual(['/auth/signin']);
  });

  it('두 화면 사이 전환이 있으면 이동 문장을 1~2개 섞는다', () => {
    const nodes = [node('/a', { elementCount: 5 }), node('/b', { elementCount: 4 }), node('/c'), node('/d'), node('/e')];
    const edges = [edge('/a', '/b'), edge('/a', '/b'), edge('/b', '/c'), edge('/c', '/d'), edge('/a', '/a'), edge('/a', '/hidden')];
    const result = buildSuggestions(siteMap([...nodes, node('/hidden', { excluded: true })], edges));
    const moves = result.filter((s) => s.text.includes('이동되는지'));
    expect(moves).toHaveLength(2);
    expect(moves[0]).toEqual({ text: '/a 화면에서 /b 화면으로 이동되는지 확인', routeKeys: ['/a', '/b'] });
    expect(moves.every((s) => s.routeKeys.length === 2)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    // 같은 화면끼리 · 제외 화면으로 가는 전환은 쓰지 않는다
    expect(result.flatMap((s) => s.routeKeys)).not.toContain('/hidden');
  });
});
