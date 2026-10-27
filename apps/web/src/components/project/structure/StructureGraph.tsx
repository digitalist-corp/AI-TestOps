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
import './structure-graph.css';
import { ArrowRight, CheckCircle2, Network } from 'lucide-react';
import { api } from '@/api/client';
import type { SiteMap, SiteMapNode } from '@/types';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { CursorReadout, DecodeText, LiveClock, ViewportFrame, ZoomControls } from './ConsoleHud';
import { GraphToolbar, type GraphFilters } from './GraphToolbar';
import { LayoutGroupNode, type LayoutGroupFlowNode } from './LayoutGroupNode';
import { PathBar, DEFAULT_PATH_INSTRUCTION } from './PathBar';
import { PathEdge, PathEdgeDefs, type PathFlowEdge } from './PathEdge';
import { ScreenDetailPanel, DETAIL_PANEL_WIDTH } from './ScreenDetailPanel';
import { ScreenNode, type ScreenFlowNode } from './ScreenNode';
import { SCREEN_H, SCREEN_W, groupBoxes, layoutGraph, nodeStatus, type Point, type ScreenStatus } from './layoutGraph';
import { buildConnectivity, usePathSelection } from './usePathSelection';

type GraphNode = ScreenFlowNode | LayoutGroupFlowNode;

const nodeTypes = { screen: ScreenNode, layoutGroup: LayoutGroupNode };
const edgeTypes = { path: PathEdge };

const MINIMAP_COLOR: Record<ScreenStatus, string> = {
  failed: '#ff4f61',
  passed: '#2ee59d',
  neutral: '#3d5168',
};

const pad2 = (n: number) => String(n).padStart(2, '0');

function LegendItem({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {children}
      {label}
    </span>
  );
}

export interface StructureGraphProps {
  projectId: string;
  siteMap: SiteMap;
  onNodeUpdated: (node: SiteMapNode) => void;
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

function GraphCanvas({ projectId, siteMap, onNodeUpdated, viewSwitch }: StructureGraphProps) {
  const flow = useReactFlow<GraphNode, PathFlowEdge>();
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
  const codes = useMemo(() => new Map(shown.nodes.map((n, i) => [n.routeKey, `SCR-${pad2(i + 1)}`])), [shown.nodes]);

  const connectivity = useMemo(() => buildConnectivity(shown), [shown]);
  const path = usePathSelection(connectivity);

  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(-1);
  const [filters, setFilters] = useState<GraphFilters>({ statuses: [], authOnly: false });
  const [showMenuLinks, setShowMenuLinks] = useState(false);
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
        ariaLabel: `${node.routeKey} 화면`,
        data: {
          node,
          code: codes.get(node.routeKey) ?? '',
          status: nodeStatus(node),
          rank: laid.ranks[node.routeKey] ?? 0,
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
  }, [groups, shown.nodes, positions, laid, path.orders, filtering, passes, hotSet, hovered, focused, flash, nodeByRoute, codes, addToPath, openDetail]);

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

  const empty = shown.nodes.length === 0;

  return (
    <div
      className={`@container sg-console sg-canvas flex flex-col overflow-hidden ${
        fullscreen ? 'fixed inset-0 z-50 !rounded-none' : 'relative h-[calc(100dvh-12rem)] min-h-[660px]'
      }`}
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
        moved={Object.keys(moved).length > 0}
        onResetLayout={() => setMoved({})}
        fullscreen={fullscreen}
        onFullscreen={() => setFullscreen((v) => !v)}
        analysis={siteMap.analysis}
        liveScreens={siteMap.nodes.length}
        viewSwitch={viewSwitch}
      />

      {error && (
        <p className="border-b border-[var(--c-red)]/40 bg-[var(--c-red)]/10 px-4 py-2 text-xs text-[var(--c-red)]">
          <span className="sg-mono mr-2 font-bold tracking-wider">ERROR //</span>
          {error}
        </p>
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
          colorMode="dark"
          aria-label="화면 구조 그래프"
        >
          <Background id="minor" variant={BackgroundVariant.Lines} gap={24} lineWidth={0.5} color="rgb(120 160 200 / 0.06)" />
          <Background id="major" variant={BackgroundVariant.Lines} gap={120} lineWidth={0.8} color="rgb(120 160 200 / 0.12)" />
          <Background id="cross" variant={BackgroundVariant.Cross} gap={120} size={6} lineWidth={1} color="rgb(54 211 255 / 0.28)" />

          {!empty && (
            <Panel position="top-left" className="sg-hud !m-4 w-64 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="sg-mono flex items-center gap-1.5 text-[10px] font-bold tracking-[0.16em] text-[var(--c-green)]">
                  <span className="sg-live h-1.5 w-1.5 rounded-full bg-[var(--c-green)] shadow-[0_0_8px_var(--c-green)]" />
                  {siteMap.analysis.status === 'RUNNING' ? 'INGESTING' : 'LIVE'}
                </span>
                <span className="text-[10px] text-[var(--c-dim)]">
                  <LiveClock />
                </span>
              </div>
              <p className="mt-1.5 text-[13px] font-bold tracking-wide text-[var(--c-text)]">
                <DecodeText text="SCREEN GRAPH // ONTOLOGY" className="sg-mono" />
              </p>
              <div className="mt-2 grid grid-cols-4 gap-px overflow-hidden rounded-[2px] border border-[var(--c-line-2)] bg-[var(--c-line-2)]">
                {[
                  { k: 'NODES', v: counts.screens, c: 'var(--c-text)' },
                  { k: 'EDGES', v: counts.transitions, c: 'var(--c-text)' },
                  { k: 'LAYOUT', v: groups.length, c: 'var(--c-blue)' },
                  { k: 'ALERT', v: counts.failed, c: counts.failed > 0 ? 'var(--c-red)' : 'var(--c-muted)' },
                ].map((m) => (
                  <div key={m.k} className="bg-[var(--c-bg-2)] px-1.5 py-1">
                    <p className="sg-label !text-[8px]">{m.k}</p>
                    <p className="sg-mono text-[15px] font-bold tabular-nums" style={{ color: m.c }}>
                      {pad2(m.v)}
                    </p>
                  </div>
                ))}
              </div>
              <div className="sg-mono mt-2 grid grid-cols-3 gap-y-1 text-[9px] tracking-wider text-[var(--c-muted)]">
                <LegendItem label="FAIL"><i className="h-2 w-[3px] bg-[var(--sg-fail)] shadow-[0_0_6px_var(--sg-fail)]" /></LegendItem>
                <LegendItem label="PASS"><i className="h-2 w-[3px] bg-[var(--sg-pass)] shadow-[0_0_6px_var(--sg-pass)]" /></LegendItem>
                <LegendItem label="UNV"><i className="h-2 w-[3px] bg-[var(--sg-neutral)]" /></LegendItem>
                <LegendItem label="LINK"><svg width="16" height="4"><line x1="0" y1="2" x2="16" y2="2" stroke="var(--c-cyan)" strokeWidth="1.6" strokeDasharray="5 2" /></svg></LegendItem>
                <LegendItem label="MENU"><svg width="16" height="4"><line x1="0" y1="2" x2="16" y2="2" stroke="var(--c-blue)" strokeWidth="1.8" strokeDasharray="1 3" strokeLinecap="round" /></svg></LegendItem>
                <LegendItem label="NO LINK"><svg width="16" height="4"><line x1="0" y1="2" x2="16" y2="2" stroke="var(--c-amber)" strokeWidth="1.6" strokeDasharray="3 3" /></svg></LegendItem>
              </div>
              <p className="sg-label mt-2 border-t border-[var(--c-line)] pt-1.5 !text-[8px]">
                / SEARCH · F FIT · ESC CLOSE · DRAG TO REARRANGE
              </p>
            </Panel>
          )}

          <Panel position="bottom-left" className="!m-4 flex items-end gap-2">
            <ZoomControls />
            <CursorReadout containerRef={canvasRef} />
          </Panel>

          <MiniMap<GraphNode>
            position="bottom-right"
            pannable
            zoomable
            nodeBorderRadius={2}
            nodeStrokeWidth={0}
            nodeColor={(n) => (n.type === 'screen' ? MINIMAP_COLOR[(n as ScreenFlowNode).data.status] : 'rgba(77, 141, 255, 0.10)')}
            maskColor="rgb(9 13 18 / 0.72)"
            maskStrokeColor="#36d3ff"
            maskStrokeWidth={1.5}
            style={{ marginRight: focused ? DETAIL_PANEL_WIDTH + 4 : 16, marginBottom: 16, transition: 'margin 300ms ease' }}
          />
          {!empty && (
            <Panel
              position="bottom-right"
              className="sg-label pointer-events-none !mb-[172px] !text-[9px] !text-[var(--c-cyan)]"
              style={{ marginRight: focused ? DETAIL_PANEL_WIDTH + 4 : 16, transition: 'margin 300ms ease' }}
            >
              ◢ OVERVIEW
            </Panel>
          )}
        </ReactFlow>

        <ViewportFrame />

        {empty && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <div className="sg-hint relative flex h-20 w-20 items-center justify-center rounded-[2px] border border-[var(--c-cyan)]/50 bg-[var(--c-cyan)]/5 text-[var(--c-cyan)] shadow-[0_0_40px_-8px_var(--c-cyan)]">
              <span className="sg-brackets" data-kind="lock" />
              <Network className="h-9 w-9" />
            </div>
            <p className="sg-mono text-[11px] font-bold tracking-[0.2em] text-[var(--c-cyan)]">
              {running ? 'INGEST IN PROGRESS' : 'NO OBJECTS'}
            </p>
            <p className="text-sm font-semibold text-[var(--c-text)]">{running ? '화면을 찾고 있습니다' : '아직 찾은 화면이 없습니다'}</p>
            <p className="max-w-sm text-xs text-[var(--c-muted)]">
              {running
                ? '분석이 끝나면 화면과 전환을 그래프로 한 번에 그립니다.'
                : '소스 저장소를 연결해 코드를 분석하거나, 사이트 주소로 탐색하면 여기에 화면 지도가 그려집니다.'}
            </p>
          </div>
        )}

        {focused && nodeByRoute.has(focused) && (
          <ScreenDetailPanel
            projectId={projectId}
            routeKey={focused}
            code={codes.get(focused) ?? ''}
            onClose={() => setFocused(null)}
            onAdd={addToPath}
            onJump={jumpTo}
            onNodeUpdated={(node) => {
              onNodeUpdated(node);
              setShown((prev) => ({ ...prev, nodes: prev.nodes.map((n) => (n.routeKey === node.routeKey ? node : n)) }));
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
        <DialogContent className="sg-console sg-dialog">
          <DialogHeader>
            <p className="sg-mono flex items-center gap-1.5 text-[10px] font-bold tracking-[0.16em] text-[var(--c-green)]">
              <span className="sg-live h-1.5 w-1.5 rounded-full bg-[var(--c-green)] shadow-[0_0_8px_var(--c-green)]" />
              JOB DISPATCHED · #{created?.id}
            </p>
            <DialogTitle className="text-[var(--c-text)]">테스트 생성을 시작했습니다</DialogTitle>
            <DialogDescription className="text-[var(--c-muted)]">
              <code className="sg-mono text-[var(--c-cyan)]">{created?.specPath}</code> 를 만듭니다. 생성이 끝나면 AI 검토에서
              승인해야 프로젝트에 추가됩니다.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-1 rounded-[2px] border border-[var(--c-line-2)] bg-[var(--c-bg-2)] p-2">
            {created?.routeKeys.map((route, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="sg-mono flex h-5 w-7 items-center justify-center bg-[var(--c-cyan)] text-[10px] font-bold text-[#021018]">
                  {pad2(i + 1)}
                </span>
                <span className="sg-mono text-xs text-[var(--c-text)]">{route}</span>
                {i < (created?.routeKeys.length ?? 0) - 1 && <ArrowRight className="ml-auto h-3 w-3 text-[var(--c-dim)]" />}
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="!rounded-[2px]"
              onClick={() => {
                path.clear();
                setInstruction('');
                setCreated(null);
              }}
            >
              경로 비우기
            </Button>
            <Button size="sm" className="sg-execute !rounded-[2px]" asChild>
              <Link to="/ai-jobs">
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
