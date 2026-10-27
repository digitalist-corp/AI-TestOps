import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SiteMapEdge, SiteMapLayout } from '@/types';
import { buildConnectivity, usePathSelection } from './usePathSelection';

const edges: SiteMapEdge[] = [
  { from: '/login', to: '/projects', kind: 'link', label: null, selector: null },
  { from: '/projects', to: '/projects/:id', kind: 'link', label: null, selector: null },
];
const layouts: SiteMapLayout[] = [
  {
    sourceFile: 'src/Layout.tsx',
    routeKeys: ['/projects', '/projects/:id', '/board'],
    elementCount: 3,
    links: [{ to: '/ai-jobs', label: 'AI 검토', selector: null }],
  },
];
const connectivity = buildConnectivity({ edges, layouts });

describe('buildConnectivity', () => {
  it('전환 · 공용 메뉴 · 같은 화면 · 끊김을 구분한다', () => {
    expect(connectivity('/login', '/projects')).toBe('direct');
    expect(connectivity('/projects/:id', '/board')).toBe('menu'); // 같은 메뉴를 공유
    expect(connectivity('/board', '/ai-jobs')).toBe('menu'); // 메뉴에 링크가 있음
    expect(connectivity('/projects', '/projects')).toBe('same');
    expect(connectivity('/login', '/board')).toBe('none');
    expect(connectivity('/projects', '/login')).toBe('none'); // 방향이 있다
  });
});

describe('usePathSelection', () => {
  it('같은 화면을 여러 번 담아도 칩마다 다른 chipId 를 준다', () => {
    const { result } = renderHook(() => usePathSelection(connectivity));
    act(() => {
      result.current.add('/projects');
      result.current.add('/projects/:id');
      result.current.add('/projects');
    });
    const ids = result.current.chips.map((c) => c.chipId);
    expect(new Set(ids).size).toBe(3);
    expect(result.current.orders.get('/projects')).toEqual([1, 3]);
    expect(result.current.orders.get('/projects/:id')).toEqual([2]);
  });

  it('끊긴 구간을 세고, 순서를 바꾸면 다시 계산한다', () => {
    const { result } = renderHook(() => usePathSelection(connectivity));
    act(() => {
      result.current.add('/login');
      result.current.add('/projects/:id');
      result.current.add('/projects');
    });
    expect(result.current.segments.map((s) => s.connection)).toEqual(['none', 'menu']);
    expect(result.current.brokenCount).toBe(1);

    const [, detail, list] = result.current.chips;
    act(() => result.current.reorder(list.chipId, detail.chipId)); // /login → /projects → /projects/:id
    expect(result.current.chips.map((c) => c.routeKey)).toEqual(['/login', '/projects', '/projects/:id']);
    expect(result.current.segments.map((s) => s.connection)).toEqual(['direct', 'direct']);
    expect(result.current.brokenCount).toBe(0);
  });

  it('◀ ▶ 로 한 칸씩 옮기고 양 끝에서는 움직이지 않는다', () => {
    const { result } = renderHook(() => usePathSelection(connectivity));
    act(() => {
      result.current.add('/a');
      result.current.add('/b');
    });
    const [a, b] = result.current.chips;
    act(() => result.current.move(a.chipId, -1));
    expect(result.current.chips).toEqual([a, b]);
    act(() => result.current.move(a.chipId, 1));
    expect(result.current.chips).toEqual([b, a]);
    act(() => result.current.remove(b.chipId));
    expect(result.current.chips).toEqual([a]);
    act(() => result.current.clear());
    expect(result.current.chips).toEqual([]);
  });
});
