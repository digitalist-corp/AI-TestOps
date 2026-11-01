import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { api } from '@/api/client';
import type { SiteMap, SiteMapNode } from '@/types';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { GraphToolbar, type GraphFilters } from './GraphToolbar';
import { LayoutGroupNode, type LayoutGroupFlowNode } from './LayoutGroupNode';
import { PathBar, DEFAULT_PATH_INSTRUCTION } from './PathBar';
import { PathEdge, PathEdgeDefs, type PathFlowEdge } from './PathEdge';
import { ScreenDetailPanel, DETAIL_PANEL_WIDTH } from './ScreenDetailPanel';
import { ScreenNode, type ScreenFlowNode } from './ScreenNode';
import { ZoomControls } from './ZoomControls';
import { SCREEN_H, SCREEN_W, groupBoxes, layoutGraph, nodeStatus, type Point, type ScreenStatus } from './layoutGraph';
import { buildConnectivity, usePathSelection } from './usePathSelection';

type GraphNode = ScreenFlowNode | LayoutGroupFlowNode;

const nodeTypes = { screen: ScreenNode, layoutGroup: LayoutGroupNode };
const edgeTypes = { path: PathEdge };

/** 미니맵 색. 앱 테마의 색 변수를 그대로 써서 라이트 · 다크를 따른다. */
const MINIMAP_COLOR: Record<ScreenStatus, string> = {
  failed: 'var(--color-destructive)',
  passed: 'var(--color-success)',
  neutral: 'var(--color-border-strong)',
};
const MINIMAP_GROUP_COLOR = 'color-mix(in oklab, var(--color-info) 20%, transparent)';

/** 범례 한 줄. 왼쪽에 색 표시, 오른쪽에 뜻. */
function LegendItem({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {children}
      {label}
    </span>
  );
}

/** 범례의 선 표시. 연결선과 같은 색 · 모양으로 그린다. */
function LegendLine({ color, dash, width = 2 }: { color: string; dash?: string; width?: number }) {
  return (
    <svg width="20" height="4" aria-hidden="true">
      <line x1="1" y1="2" x2="19" y2="2" strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" style={{ stroke: color }} />
    </svg>
  );
}

export interface StructureGraphProps {
  projectId: string;
  siteMap: SiteMap;
  onNodeUpdated: (node: SiteMapNode) => void;
  onNodeDeleted?: (routeKey: string) => void;
  /** 툴바 오른쪽 끝에 넣을 그래프 ↔ 목록 전환 버튼 */
  viewSwitch?: ReactNode;
}

/** 구조 탭의 그래프 보기. 무거운 시각화 라이브러리가 함께 실리므로 구조 탭에서 React.lazy 로 불러온다. */
export default function StructureGraph(props: StructureGraphProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}

function slugOf(route: string) {
  return route.replace(/[:*]/g, '').split('/').filter(Boolean).join('-') || 'home';
}

function GraphCanvas({ projectId, siteMap, onNodeUpdated, onNodeDeleted, viewSwitch }: StructureGraphProps) {
  const flow = useReactFlow<GraphNode, PathFlowEdge>();
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 분석 중에는 노드를 하나씩 덜컹거리며 늘리지 않고, 마지막으로 완성된 그래프를 그대로 둔다.
  const running = siteMap.analysis.status === 'RUNNING';
  const [shown, setShown] = useState(siteMap);
  useEffect(() => {
    if (!running) setShown(siteMap);
  }, [siteMap, running]);

  const laid = useMemo(() => layoutGraph(shown), [shown]);
  const [moved, setMoved] = useState<Record<string, Point>>({});
  const positions = useMemo(() => ({ ...laid.positions, ...moved }), [laid, moved]);
  const groups = useMemo(() => groupBoxes(shown.layouts, positions), [shown.layouts, positions]);
  const nodeByRoute = useMemo(() => new Map(shown.nodes.map((n) => [n.routeKey, n])), [shown.nodes]);

  const connectivity = useMemo(() => buildConnectivity(shown), [shown]);
  const path = usePathSelection(connectivity);

  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(-1);
  const [filters, setFilters] = useState<GraphFilters>({ statuses: [], authOnly: false });
  const [showMenuLinks, setShowMenuLinks] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ id: number; specPath: string; routeKeys: string[] } | null>(null);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      q
        ? shown.nodes
            .filter((n) => n.routeKey.toLowerCase().includes(q) || (n.title ?? '').toLowerCase().includes(q))
            .map((n) => n.routeKey)
        : [],
    [q, shown.nodes]
  );
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const filtering = filters.statuses.length > 0 || filters.authOnly || q !== '';
  const passes = useCallback(
    (node: SiteMapNode) =>
      (filters.statuses.length === 0 || filters.statuses.includes(nodeStatus(node))) &&
      (!filters.authOnly || node.authRequired) &&
      (q === '' || matchSet.has(node.routeKey)),
    [filters, q, matchSet]
  );

  // 마우스를 올린 화면과 그 이웃(또는 공용 메뉴 상자에 속한 화면)을 함께 띄운다.
  const hotSet = useMemo(() => {
    const hot = new Set<string>();
    if (!hovered) return hot;
    hot.add(hovered);
    const group = groups.find((g) => g.id === hovered);
    if (group) {
      group.layout.routeKeys.forEach((r) => hot.add(r));
      return hot;
    }
    for (const e of laid.edges) {
      if (e.from === hovered) hot.add(e.to);
      if (e.to === hovered) hot.add(e.from);
    }
    return hot;
  }, [hovered, groups, laid.edges]);

  // ---------------------------------------------------------------- 카메라

  /** 상세 패널이 열려 있으면 패널에 가리지 않도록, 남은 왼쪽 캔버스의 가운데로 옮긴다. */
  const centerOn = useCallback(
    (route: string, withPanel: boolean) => {
      const p = positions[route];
      if (!p) return;
      const zoom = Math.max(flow.getZoom(), 0.85);
      const offset = withPanel ? DETAIL_PANEL_WIDTH / 2 / zoom : 0;
      flow.setCenter(p.x + SCREEN_W / 2 + offset, p.y + SCREEN_H / 2, { zoom, duration: 650 });
    },
    [flow, positions]
  );

  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashNode = useCallback((route: string) => {
    setFlash(route);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2300);
  }, []);
  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  const openDetail = useCallback(
    (route: string) => {
      setFocused(route);
      centerOn(route, true);
    },
    [centerOn]
  );
  const jumpTo = useCallback(
    (route: string) => {
      flashNode(route);
      if (focused) openDetail(route);
      else centerOn(route, false);
    },
    [centerOn, flashNode, focused, openDetail]
  );

  const searchNext = (backward: boolean) => {
    if (matches.length === 0) return;
    const next = matchIndex < 0 ? 0 : (matchIndex + (backward ? -1 : 1) + matches.length) % matches.length;
    setMatchIndex(next);
    flashNode(matches[next]);
    centerOn(matches[next], focused != null);
  };

  // 화면 · 전환 구성이 바뀔 때(분석 완료)와 전체 화면을 오갈 때만 다시 맞춘다. 메모 저장으로는 움직이지 않는다.
  const signature = useMemo(
    () => shown.nodes.map((n) => n.routeKey).join('|') + '#' + laid.edges.map((e) => e.id).join('|'),
    [shown.nodes, laid.edges]
  );
  const fitKey = `${signature}@${fullscreen}`;
  const lastFit = useRef(fitKey);
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastFit.current === fitKey) return;
    lastFit.current = fitKey;
    if (lastSignature.current !== signature) {
      lastSignature.current = signature;
      setMoved({});
    }
    requestAnimationFrame(() => flow.fitView({ padding: 0.18, maxZoom: 1, duration: 700 }));
  }, [fitKey, signature, flow]);

  // Esc: 상세 닫기 → 전체 화면 끝내기. / : 검색. F: 전체 보기. 입력 중일 때는 / · F 를 가로채지 않는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable="true"]');
      if (e.key === 'Escape') {
        if (focused) setFocused(null);
        else if (fullscreen) setFullscreen(false);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!canvasRef.current?.isConnected) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'f' || e.key === 'F') {
        flow.fitView({ padding: 0.18, maxZoom: 1, duration: 500 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, focused, flow]);

  // ---------------------------------------------------------------- 노드 · 선

  const { add: addChip } = path;
  const addToPath = useCallback(
    (route: string) => {
      addChip(route);
      flashNode(route);
    },
    [addChip, flashNode]
  );

  const rfNodes = useMemo<GraphNode[]>(() => {
    const list: GraphNode[] = groups.map((g) => ({
      id: g.id,
      type: 'layoutGroup',
      position: { x: g.x, y: g.y },
      width: g.width,
      height: g.height,
      zIndex: -1,
      draggable: false,
      selectable: false,
      focusable: false,
      data: {
        layout: g.layout,
        width: g.width,
        height: g.height,
        hot: hovered === g.id,
        dimmed: filtering && !g.layout.routeKeys.some((r) => nodeByRoute.has(r) && passes(nodeByRoute.get(r)!)),
      },
    }));
    for (const node of shown.nodes) {
      list.push({
        id: node.routeKey,
        type: 'screen',
        position: positions[node.routeKey],
        width: SCREEN_W,
        height: SCREEN_H,
        // 키보드로 노드에 초점이 갈 때 나오는 테두리가 카드 모서리를 따라 둥글게 보이도록
        className: 'rounded-lg',
        ariaLabel: `${node.routeKey} 화면`,
        data: {
          node,
          status: nodeStatus(node),
          entry: laid.entry === node.routeKey,
          orders: path.orders.get(node.routeKey) ?? [],
          dimmed: filtering && !passes(node),
          hot: hotSet.has(node.routeKey),
          focused: focused === node.routeKey,
          flash: flash === node.routeKey,
          onAdd: addToPath,
          onOpen: openDetail,
        },
      });
    }
    return list;
  }, [groups, shown.nodes, positions, laid, path.orders, filtering, passes, hotSet, hovered, focused, flash, nodeByRoute, addToPath, openDetail]);

  const rfEdges = useMemo<PathFlowEdge[]>(() => {
    const transitionIds = new Set(laid.edges.map((e) => e.id));
    const steps = new Map<string, number[]>();
    const list: PathFlowEdge[] = [];
    for (const seg of path.segments) {
      if (seg.connection === 'same') continue;
      const id = `e:${seg.from}->${seg.to}`;
      if (seg.connection === 'direct' && transitionIds.has(id)) {
        steps.set(id, [...(steps.get(id) ?? []), seg.index + 1]);
        continue;
      }
      list.push({
        id: `v:${seg.index}`,
        source: seg.from,
        target: seg.to,
        type: 'path',
        zIndex: 6,
        data: {
          kind: seg.connection === 'menu' ? 'virtual-menu' : 'virtual-broken',
          steps: [seg.index + 1],
          labels: [],
          count: 0,
          hot: false,
          dimmed: false,
        },
      });
    }
    const dimByFilter = (from: string, to: string) =>
      filtering && !(passes(nodeByRoute.get(from)!) && passes(nodeByRoute.get(to)!));
    for (const e of laid.edges) {
      const hot = hovered != null && (e.from === hovered || e.to === hovered);
      const mine = steps.get(e.id) ?? [];
      list.push({
        id: e.id,
        source: e.from,
        target: e.to,
        type: 'path',
        zIndex: mine.length > 0 ? 5 : hot ? 4 : 0,
        data: {
          kind: 'transition',
          steps: mine,
          labels: e.labels,
          count: e.count,
          hot,
          dimmed: (hovered != null && !hot) || dimByFilter(e.from, e.to),
        },
      });
    }
    if (showMenuLinks) {
      for (const g of groups) {
        const targets = new Set(g.layout.links.map((l) => l.to).filter((to) => nodeByRoute.has(to)));
        for (const to of targets) {
          const hot = hovered === g.id || hovered === to;
          list.push({
            id: `l:${g.layout.sourceFile}->${to}`,
            source: g.id,
            target: to,
            type: 'path',
            zIndex: hot ? 3 : 0,
            data: { kind: 'layout', steps: [], labels: [], count: 0, hot, dimmed: hovered != null && !hot },
          });
        }
      }
    }
    return list;
  }, [laid.edges, path.segments, filtering, passes, nodeByRoute, hovered, showMenuLinks, groups]);

  const onNodesChange = useCallback((changes: NodeChange<GraphNode>[]) => {
    const next: Record<string, Point> = {};
    for (const change of changes) {
      if (change.type === 'position' && change.position && !change.id.startsWith('group:')) {
        next[change.id] = change.position;
      }
    }
    if (Object.keys(next).length > 0) setMoved((prev) => ({ ...prev, ...next }));
  }, []);

  // ---------------------------------------------------------------- 생성

  const generate = async () => {
    const routeKeys = path.chips.map((c) => c.routeKey);
    if (routeKeys.length === 0) return;
    const slug = routeKeys.map(slugOf).join('--').slice(0, 80).replace(/-+$/, '');
    const specPath = `tests/flow-${slug}.spec.ts`;
    setBusy(true);
    setError('');
    try {
      const job = await api.aiJobs.createTemplateGenerate(projectId, {
        targetSpecPath: specPath,
        instruction: instruction.trim() || DEFAULT_PATH_INSTRUCTION,
        routeKeys,
      });
      setCreated({ id: job.id, specPath, routeKeys });
    } catch (e) {
      setError(e instanceof Error ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(() => {
    const c = { failed: 0, passed: 0, neutral: 0, auth: 0, screens: shown.nodes.length, transitions: laid.edges.length };
    for (const node of shown.nodes) {
      c[nodeStatus(node)] += 1;
      if (node.authRequired) c.auth += 1;
    }
    return c;
  }, [shown.nodes, laid.edges]);

  return (
    <div
      className={cn(
        '@container flex flex-col overflow-hidden bg-background',
        fullscreen ? 'fixed inset-0 z-50' : 'relative h-[calc(100dvh-12rem)] min-h-[660px] rounded-lg border border-border'
      )}
      data-testid="structure-graph"
    >
      <PathEdgeDefs />
      <GraphToolbar
        ref={searchRef}
        query={query}
        matchCount={matches.length}
        matchIndex={Math.max(matchIndex, 0)}
        onQuery={(value) => {
          setQuery(value);
          setMatchIndex(-1);
        }}
        onSearchNext={searchNext}
        filters={filters}
        onFilters={setFilters}
        counts={counts}
        showMenuLinks={showMenuLinks}
        onShowMenuLinks={setShowMenuLinks}
        showMiniMap={showMiniMap}
        onShowMiniMap={setShowMiniMap}
        analysis={siteMap.analysis}
        liveScreens={siteMap.nodes.length}
        viewSwitch={viewSwitch}
      />

      {error && (
        <p className="border-b border-destructive/40 bg-destructive/5 px-4 py-2 text-xs text-destructive">{error}</p>
      )}

      <div ref={canvasRef} className="relative min-h-0 flex-1">
        <ReactFlow<GraphNode, PathFlowEdge>
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_, node) => node.type === 'screen' && openDetail(node.id)}
          onNodeMouseEnter={(_, node) => setHovered(node.id)}
          onNodeMouseLeave={() => setHovered(null)}
          onPaneClick={() => setFocused(null)}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          fitView
          fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
          minZoom={0.1}
          maxZoom={1.8}
          colorMode={theme}
          // 바탕색은 바깥 상자(bg-background)가 맡는다.
          style={{ background: 'transparent' }}
          aria-label="화면 구조 그래프"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--color-border)" />

          {/* 표시 전용 패널이라 클릭은 아래 캔버스로 흘려보낸다. 막으면 패널 뒤에 놓인 화면 카드를 누를 수 없다. */}
          <Panel
            position="top-left"
            className="pointer-events-none !m-3 flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm select-none"
            role="group"
            aria-label="범례"
          >
            <LegendItem label="통과"><i className="h-2 w-2 rounded-full bg-success" /></LegendItem>
            <LegendItem label="실패"><i className="h-2 w-2 rounded-full bg-destructive" /></LegendItem>
            <LegendItem label="미확인"><i className="h-2 w-2 rounded-full bg-border-strong" /></LegendItem>
            <LegendItem label="화면 전환"><LegendLine color="var(--color-border-strong)" width={1.5} /></LegendItem>
            {path.chips.length > 0 && (
              <LegendItem label="선택한 경로"><LegendLine color="var(--color-primary)" width={2.5} /></LegendItem>
            )}
            {showMenuLinks && (
              <LegendItem label="공용 메뉴"><LegendLine color="var(--color-info)" dash="2 4" /></LegendItem>
            )}
            {path.brokenCount > 0 && (
              <LegendItem label="전환 없음"><LegendLine color="var(--color-warning)" dash="5 4" /></LegendItem>
            )}
          </Panel>

          <Panel position="bottom-left" className="!m-4">
            <ZoomControls
              fullscreen={fullscreen}
              onFullscreen={() => setFullscreen((v) => !v)}
              moved={Object.keys(moved).length > 0}
              onResetLayout={() => setMoved({})}
            />
          </Panel>

          {showMiniMap && (
            <MiniMap<GraphNode>
              position="bottom-right"
              pannable
              zoomable
              className="overflow-hidden rounded-lg border border-border shadow-sm"
              bgColor="var(--color-card)"
              nodeBorderRadius={3}
              nodeStrokeWidth={0}
              nodeColor={(n) => (n.type === 'screen' ? MINIMAP_COLOR[(n as ScreenFlowNode).data.status] : MINIMAP_GROUP_COLOR)}
              maskStrokeColor="var(--color-primary)"
              maskStrokeWidth={1.5}
              style={{ marginRight: focused ? DETAIL_PANEL_WIDTH + 4 : 16, marginBottom: 16, transition: 'margin 300ms ease' }}
            />
          )}
        </ReactFlow>

        {focused && nodeByRoute.has(focused) && (
          <ScreenDetailPanel
            projectId={projectId}
            routeKey={focused}
            onClose={() => setFocused(null)}
            onAdd={addToPath}
            onJump={jumpTo}
            onNodeUpdated={(node) => {
              onNodeUpdated(node);
              setShown((prev) => ({ ...prev, nodes: prev.nodes.map((n) => (n.routeKey === node.routeKey ? node : n)) }));
            }}
            onDeleteNode={(route) => {
              onNodeDeleted?.(route);
              setShown((prev) => ({
                ...prev,
                nodes: prev.nodes.filter((n) => n.routeKey !== route),
                edges: prev.edges.filter((e) => e.from !== route && e.to !== route),
              }));
            }}
          />
        )}
      </div>

      <PathBar
        chips={path.chips}
        segments={path.segments}
        brokenCount={path.brokenCount}
        nodeByRoute={nodeByRoute}
        instruction={instruction}
        busy={busy}
        onInstruction={setInstruction}
        onMove={path.move}
        onReorder={path.reorder}
        onRemove={path.remove}
        onClear={path.clear}
        onFocus={jumpTo}
        onGenerate={generate}
      />

      <Dialog open={created != null} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>테스트 생성을 시작했습니다</DialogTitle>
            <DialogDescription>
              AI 작업 #{created?.id} 로 <code className="font-mono text-foreground">{created?.specPath}</code> 를 만듭니다. 생성이
              끝나면 AI 검토에서 승인해야 프로젝트에 추가됩니다.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-2">
            {created?.routeKeys.map((route, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
                  {i + 1}
                </span>
                <span className="font-mono text-sm text-foreground">{route}</span>
                {i < (created?.routeKeys.length ?? 0) - 1 && <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />}
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                path.clear();
                setInstruction('');
                setCreated(null);
              }}
            >
              경로 비우기
            </Button>
            <Button size="sm" asChild>
              <Link to={`/projects/${projectId}/ai-review`}>
                <CheckCircle2 className="h-4 w-4" />
                AI 검토로 이동
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
