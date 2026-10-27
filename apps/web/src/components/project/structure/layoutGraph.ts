import dagre from '@dagrejs/dagre';
import type { SiteMap, SiteMapLayout, SiteMapNode } from '@/types';

/** 화면 상자 크기. Dagre 배치와 실제 렌더링이 같은 값을 써야 상자가 겹치지 않는다. */
export const SCREEN_W = 256;
export const SCREEN_H = 128;

const GROUP_PAD = 20;
/** 그룹 이름표가 들어갈 위쪽 여백 */
const GROUP_LABEL = 28;
/** 다른 그룹을 품은 그룹은 한 겹마다 이만큼 더 크게 그려 테두리가 겹치지 않게 한다 */
const GROUP_NEST = 16;

export type ScreenStatus = 'failed' | 'passed' | 'neutral';

export interface Point {
  x: number;
  y: number;
}

/** 같은 두 화면 사이의 전환은 하나로 합친다. labels 는 전환 버튼 · 링크 글자. */
export interface MergedEdge {
  id: string;
  from: string;
  to: string;
  labels: string[];
  count: number;
}

export interface LaidOutGraph {
  /** 화면 상자의 왼쪽 위 좌표 */
  positions: Record<string, Point>;
  /** 진입점에서 몇 번째 열인지. 처음 그릴 때 왼쪽부터 차례로 나타나게 하는 데 쓴다 */
  ranks: Record<string, number>;
  edges: MergedEdge[];
  entry: string | null;
}

export interface GroupBox {
  id: string;
  layout: SiteMapLayout;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 품고 있는 다른 그룹 수 */
  depth: number;
}

/**
 * 빨강: 실패 요소가 하나라도 있음. 초록: 실패 없이 모든 요소(1개 이상)가 확인됨.
 * 회색: 그 밖(미확인만, 확인 · 미확인 섞임, 요소 없음).
 */
export function nodeStatus(node: Pick<SiteMapNode, 'failedCount' | 'passedCount' | 'elementCount'>): ScreenStatus {
  if (node.failedCount > 0) return 'failed';
  if (node.elementCount > 0 && node.passedCount === node.elementCount) return 'passed';
  return 'neutral';
}

/** 로그인 화면 → 루트 → 전환을 가장 많이 내보내는 화면 순으로 진입점을 고른다. */
export function pickEntry(nodes: SiteMapNode[], edges: MergedEdge[]): string | null {
  const routes = new Set(nodes.map((n) => n.routeKey));
  const login = nodes.find((n) => /(^|\/)(login|signin|sign-in)$/i.test(n.routeKey));
  if (login) return login.routeKey;
  if (routes.has('/')) return '/';
  let best: string | null = null;
  let bestOut = -1;
  for (const node of nodes) {
    const out = edges.filter((e) => e.from === node.routeKey).length;
    if (out > bestOut) {
      best = node.routeKey;
      bestOut = out;
    }
  }
  return best;
}

/** /projects/:id 의 부모는 /projects, 없으면 / . 들어오는 전환이 없는 화면을 경로 계층으로 묶는 데 쓴다. */
export function parentRoute(route: string, routes: Set<string>): string | null {
  const segments = route.split('/').filter(Boolean);
  for (let i = segments.length - 1; i >= 1; i--) {
    const candidate = '/' + segments.slice(0, i).join('/');
    if (routes.has(candidate)) return candidate;
  }
  if (route !== '/' && routes.has('/')) return '/';
  return null;
}

export function mergeEdges(siteMap: Pick<SiteMap, 'nodes' | 'edges'>): MergedEdge[] {
  const routes = new Set(siteMap.nodes.map((n) => n.routeKey));
  const merged = new Map<string, MergedEdge>();
  for (const edge of siteMap.edges) {
    if (edge.from === edge.to || !routes.has(edge.from) || !routes.has(edge.to)) continue;
    const id = `e:${edge.from}->${edge.to}`;
    const current = merged.get(id) ?? { id, from: edge.from, to: edge.to, labels: [], count: 0 };
    current.count += 1;
    if (edge.label && !current.labels.includes(edge.label)) current.labels.push(edge.label);
    merged.set(id, current);
  }
  return [...merged.values()];
}

/**
 * 화면과 전환을 좌→우 계층으로 배치한다. 같은 입력이면 항상 같은 배치가 나온다.
 *
 * 들어오는 전환이 없는 화면은 그대로 두면 모두 첫 열에 쌓이므로, 배치할 때만 경로 계층(부모 경로)이나
 * 진입점에서 오는 보이지 않는 간선을 더해 제자리를 찾게 한다.
 */
export function layoutGraph(siteMap: Pick<SiteMap, 'nodes' | 'edges'>): LaidOutGraph {
  const edges = mergeEdges(siteMap);
  const routes = new Set(siteMap.nodes.map((n) => n.routeKey));
  const entry = pickEntry(siteMap.nodes, edges);

  const g = new dagre.graphlib.Graph<object, object, object>({ multigraph: false });
  g.setGraph({ rankdir: 'LR', nodesep: 36, ranksep: 120, marginx: 24, marginy: 24, ranker: 'network-simplex' });
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of siteMap.nodes) {
    g.setNode(node.routeKey, { width: SCREEN_W, height: SCREEN_H });
  }
  const incoming = new Set<string>();
  for (const edge of edges) {
    g.setEdge(edge.from, edge.to, { weight: 2 });
    incoming.add(edge.to);
  }
  for (const node of siteMap.nodes) {
    const route = node.routeKey;
    if (route === entry || incoming.has(route)) continue;
    const parent = parentRoute(route, routes) ?? entry;
    if (parent && parent !== route && !g.hasEdge(parent, route)) {
      g.setEdge(parent, route, { weight: 1 });
    }
  }
  dagre.layout(g);

  const positions: Record<string, Point> = {};
  const xs = new Set<number>();
  for (const node of siteMap.nodes) {
    const laid = g.node(node.routeKey) as { x: number; y: number };
    positions[node.routeKey] = { x: Math.round(laid.x - SCREEN_W / 2), y: Math.round(laid.y - SCREEN_H / 2) };
    xs.add(positions[node.routeKey].x);
  }
  const columns = [...xs].sort((a, b) => a - b);
  const ranks: Record<string, number> = {};
  for (const node of siteMap.nodes) {
    ranks[node.routeKey] = columns.indexOf(positions[node.routeKey].x);
  }
  return { positions, ranks, edges, entry };
}

/**
 * 공용 메뉴(layout)를 공유하는 화면들을 감싸는 상자. Dagre 는 평면 그래프에 맞춰져 있어 부모-자식을
 * 함께 넘기지 않고, 화면 배치가 끝난 뒤 좌표로 감싼다. 화면을 끌어 옮기면 다시 계산해 따라간다.
 */
export function groupBoxes(layouts: SiteMapLayout[], positions: Record<string, Point>): GroupBox[] {
  const members = layouts.map((layout) => new Set(layout.routeKeys.filter((r) => positions[r])));
  const boxes: GroupBox[] = [];
  layouts.forEach((layout, i) => {
    const mine = members[i];
    if (mine.size === 0) return;
    let depth = 0;
    members.forEach((other, j) => {
      if (j !== i && other.size > 0 && other.size < mine.size && [...other].every((r) => mine.has(r))) depth++;
    });
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const route of mine) {
      const p = positions[route];
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + SCREEN_W);
      maxY = Math.max(maxY, p.y + SCREEN_H);
    }
    const pad = GROUP_PAD + depth * GROUP_NEST;
    boxes.push({
      id: `group:${layout.sourceFile}`,
      layout,
      x: minX - pad,
      y: minY - pad - GROUP_LABEL,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2 + GROUP_LABEL,
      depth,
    });
  });
  // 큰 상자를 먼저 그려야 작은 상자가 위에 보인다.
  return boxes.sort((a, b) => b.depth - a.depth || b.width * b.height - a.width * a.height);
}
