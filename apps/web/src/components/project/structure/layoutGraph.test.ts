import { describe, expect, it } from 'vitest';
import type { SiteMapEdge, SiteMapLayout, SiteMapNode } from '@/types';
import { SCREEN_H, SCREEN_W, groupBoxes, layoutGraph, mergeEdges, nodeStatus, parentRoute, pickEntry } from './layoutGraph';

function screen(routeKey: string, counts: Partial<SiteMapNode> = {}): SiteMapNode {
  return {
    routeKey,
    title: null,
    sourceFile: null,
    origin: 'CODE',
    stale: false,
    elementCount: 0,
    excluded: false,
    note: null,
    url: null,
    hasScreenshot: false,
    authRequired: false,
    passedCount: 0,
    failedCount: 0,
    unverifiedCount: 0,
    ...counts,
  };
}

function edge(from: string, to: string, label: string | null = null): SiteMapEdge {
  return { from, to, kind: 'link', label, selector: null };
}

/** AI-TestOps 자신의 화면 9개와 그 사이 전환 */
const SELF = {
  nodes: [
    '/login', '/projects', '/projects/:id', '/projects/:id/structure', '/ai-jobs',
    '/templates', '/board', '/users', '/settings/ai',
  ].map((r) => screen(r)),
  edges: [
    edge('/login', '/projects', '로그인'),
    edge('/projects', '/projects/:id', '열기'),
    edge('/projects', '/projects/:id', '상세'),
    edge('/projects/:id', '/projects/:id/structure', '구조'),
    edge('/projects/:id/structure', '/ai-jobs', 'AI 검토'),
    edge('/projects/:id', '/projects', '목록으로'),
    edge('/projects', '/projects', '새로 고침'),
    edge('/projects', '/nowhere'),
  ],
};

function overlaps(a: { x: number; y: number }, b: { x: number; y: number }) {
  return a.x < b.x + SCREEN_W && b.x < a.x + SCREEN_W && a.y < b.y + SCREEN_H && b.y < a.y + SCREEN_H;
}

describe('nodeStatus', () => {
  it('실패가 하나라도 있으면 빨강', () => {
    expect(nodeStatus({ elementCount: 5, passedCount: 4, failedCount: 1 })).toBe('failed');
  });
  it('모든 요소가 확인되면 초록', () => {
    expect(nodeStatus({ elementCount: 3, passedCount: 3, failedCount: 0 })).toBe('passed');
  });
  it('요소가 없거나 미확인이 섞이면 회색', () => {
    expect(nodeStatus({ elementCount: 0, passedCount: 0, failedCount: 0 })).toBe('neutral');
    expect(nodeStatus({ elementCount: 3, passedCount: 2, failedCount: 0 })).toBe('neutral');
  });
});

describe('mergeEdges', () => {
  it('같은 두 화면 사이 전환은 합치고, 자기 자신 · 없는 화면으로 가는 전환은 뺀다', () => {
    const merged = mergeEdges(SELF);
    const detail = merged.find((e) => e.id === 'e:/projects->/projects/:id');
    expect(detail).toMatchObject({ count: 2, labels: ['열기', '상세'] });
    expect(merged.some((e) => e.from === e.to)).toBe(false);
    expect(merged.some((e) => e.to === '/nowhere')).toBe(false);
  });
});

describe('pickEntry · parentRoute', () => {
  it('로그인 화면을 진입점으로 고른다', () => {
    expect(pickEntry(SELF.nodes, mergeEdges(SELF))).toBe('/login');
    expect(pickEntry([screen('/a'), screen('/')], [])).toBe('/');
  });
  it('가장 가까운 상위 경로를 부모로 삼는다', () => {
    const routes = new Set(['/', '/projects', '/projects/:id']);
    expect(parentRoute('/projects/:id/structure', routes)).toBe('/projects/:id');
    expect(parentRoute('/board', routes)).toBe('/');
    expect(parentRoute('/', routes)).toBeNull();
  });
});

describe('layoutGraph', () => {
  it('9개 화면이 겹치지 않는다', () => {
    const { positions } = layoutGraph(SELF);
    const routes = Object.keys(positions);
    expect(routes).toHaveLength(9);
    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        expect(overlaps(positions[routes[i]], positions[routes[j]]), `${routes[i]} ↔ ${routes[j]}`).toBe(false);
      }
    }
  });

  it('진입점에서 왼쪽 → 오른쪽으로 펼친다', () => {
    const { positions, ranks, entry } = layoutGraph(SELF);
    expect(entry).toBe('/login');
    expect(ranks['/login']).toBe(0);
    expect(positions['/login'].x).toBeLessThan(positions['/projects'].x);
    expect(positions['/projects'].x).toBeLessThan(positions['/projects/:id'].x);
    expect(positions['/projects/:id'].x).toBeLessThan(positions['/projects/:id/structure'].x);
    expect(positions['/projects/:id/structure'].x).toBeLessThan(positions['/ai-jobs'].x);
  });

  it('들어오는 전환이 없는 화면은 첫 열에 쌓지 않고 진입점 오른쪽에 둔다', () => {
    const { positions } = layoutGraph(SELF);
    for (const orphan of ['/templates', '/board', '/users', '/settings/ai']) {
      expect(positions[orphan].x).toBeGreaterThan(positions['/login'].x);
    }
  });

  it('같은 입력이면 항상 같은 배치', () => {
    expect(layoutGraph(SELF).positions).toEqual(layoutGraph(SELF).positions);
  });

  it('화면이 없으면 빈 결과', () => {
    expect(layoutGraph({ nodes: [], edges: [] })).toEqual({ positions: {}, ranks: {}, edges: [], entry: null });
  });

  it('60개 화면도 겹치지 않는다', () => {
    const nodes = Array.from({ length: 60 }, (_, i) => screen(i === 0 ? '/' : `/s${i % 6}/p${i}`));
    const extra = Array.from({ length: 6 }, (_, i) => screen(`/s${i}`));
    const edges = nodes.slice(1).map((n, i) => edge(i % 3 === 0 ? '/' : nodes[i].routeKey, n.routeKey));
    const { positions } = layoutGraph({ nodes: [...nodes, ...extra], edges });
    const list = Object.values(positions);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        expect(overlaps(list[i], list[j])).toBe(false);
      }
    }
  });
});

describe('groupBoxes', () => {
  const layouts: SiteMapLayout[] = [
    { sourceFile: 'src/App.tsx', routeKeys: ['/projects', '/projects/:id', '/ai-jobs'], elementCount: 4, links: [] },
    { sourceFile: 'src/ProjectShell.tsx', routeKeys: ['/projects/:id'], elementCount: 2, links: [] },
    { sourceFile: 'src/Gone.tsx', routeKeys: ['/removed'], elementCount: 0, links: [] },
  ];

  it('같은 공용 메뉴의 화면을 여백을 두고 감싼다', () => {
    const { positions } = layoutGraph(SELF);
    const boxes = groupBoxes(layouts, positions);
    expect(boxes.map((b) => b.layout.sourceFile)).toEqual(['src/App.tsx', 'src/ProjectShell.tsx']);
    const outer = boxes[0];
    for (const route of layouts[0].routeKeys) {
      const p = positions[route];
      expect(p.x).toBeGreaterThanOrEqual(outer.x + 20);
      expect(p.y).toBeGreaterThanOrEqual(outer.y + 20);
      expect(p.x + SCREEN_W).toBeLessThanOrEqual(outer.x + outer.width - 20);
      expect(p.y + SCREEN_H).toBeLessThanOrEqual(outer.y + outer.height - 20);
    }
  });

  it('다른 그룹을 품은 그룹은 더 크게 그리고 먼저(뒤에) 깐다', () => {
    const { positions } = layoutGraph(SELF);
    const [outer, inner] = groupBoxes(layouts, positions);
    expect(outer.depth).toBe(1);
    expect(inner.depth).toBe(0);
    expect(outer.x).toBeLessThan(inner.x);
    expect(outer.x + outer.width).toBeGreaterThan(inner.x + inner.width);
  });
});
