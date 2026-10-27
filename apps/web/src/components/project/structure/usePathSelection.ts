import { useCallback, useMemo, useRef, useState } from 'react';
import type { SiteMap } from '@/types';

/** 경로 표시줄의 칩 하나. 같은 화면을 여러 번 넣을 수 있어 chipId 로 구분한다. */
export interface PathChip {
  chipId: string;
  routeKey: string;
}

/**
 * 이웃한 두 칩 사이의 연결.
 * - direct: 화면 전환이 있음
 * - menu: 공용 메뉴로 갈 수 있음 (같은 메뉴를 공유하거나, 앞 화면의 메뉴에 뒤 화면 링크가 있음)
 * - same: 같은 화면을 다시 고름 (새로 고침 · 머무르기)
 * - none: 분석에서 찾은 길이 없음. 생성을 막지는 않고 경고만 한다
 */
export type Connection = 'direct' | 'menu' | 'same' | 'none';

export interface PathSegment {
  index: number;
  from: string;
  to: string;
  connection: Connection;
}

export type Connectivity = (from: string, to: string) => Connection;

export function buildConnectivity(siteMap: Pick<SiteMap, 'edges' | 'layouts'>): Connectivity {
  const direct = new Set(siteMap.edges.map((e) => `${e.from}\u0000${e.to}`));
  return (from, to) => {
    if (from === to) return 'same';
    if (direct.has(`${from}\u0000${to}`)) return 'direct';
    for (const layout of siteMap.layouts) {
      if (!layout.routeKeys.includes(from)) continue;
      if (layout.routeKeys.includes(to) || layout.links.some((link) => link.to === to)) return 'menu';
    }
    return 'none';
  };
}

export function segmentsOf(chips: PathChip[], connectivity: Connectivity): PathSegment[] {
  const segments: PathSegment[] = [];
  for (let i = 0; i + 1 < chips.length; i++) {
    const from = chips[i].routeKey;
    const to = chips[i + 1].routeKey;
    segments.push({ index: i, from, to, connection: connectivity(from, to) });
  }
  return segments;
}

/** 화면마다 경로에서 몇 번째로 나오는지 (1부터). 노드 위의 방문 순서 번호에 쓴다. */
export function ordersByRoute(chips: PathChip[]): Map<string, number[]> {
  const orders = new Map<string, number[]>();
  chips.forEach((chip, i) => {
    const list = orders.get(chip.routeKey) ?? [];
    list.push(i + 1);
    orders.set(chip.routeKey, list);
  });
  return orders;
}

export function moveChip(chips: PathChip[], chipId: string, delta: number): PathChip[] {
  const from = chips.findIndex((c) => c.chipId === chipId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= chips.length) return chips;
  return reorderChips(chips, from, to);
}

export function reorderChips(chips: PathChip[], from: number, to: number): PathChip[] {
  if (from === to) return chips;
  const next = chips.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** 경로 표시줄의 상태. 칩 추가 · 삭제 · 순서 바꾸기와, 이웃한 칩 사이가 이어지는지 계산한다. */
export function usePathSelection(connectivity: Connectivity) {
  const [chips, setChips] = useState<PathChip[]>([]);
  const seq = useRef(0);

  const add = useCallback((routeKey: string) => {
    seq.current += 1;
    const chip = { chipId: `chip-${seq.current}`, routeKey };
    setChips((prev) => [...prev, chip]);
    return chip.chipId;
  }, []);
  const remove = useCallback((chipId: string) => setChips((prev) => prev.filter((c) => c.chipId !== chipId)), []);
  const move = useCallback((chipId: string, delta: number) => setChips((prev) => moveChip(prev, chipId, delta)), []);
  const reorder = useCallback((activeId: string, overId: string) => {
    setChips((prev) => {
      const from = prev.findIndex((c) => c.chipId === activeId);
      const to = prev.findIndex((c) => c.chipId === overId);
      return from < 0 || to < 0 ? prev : reorderChips(prev, from, to);
    });
  }, []);
  const clear = useCallback(() => setChips([]), []);

  const segments = useMemo(() => segmentsOf(chips, connectivity), [chips, connectivity]);
  const orders = useMemo(() => ordersByRoute(chips), [chips]);
  const brokenCount = segments.filter((s) => s.connection === 'none').length;

  return { chips, add, remove, move, reorder, clear, segments, orders, brokenCount };
}
