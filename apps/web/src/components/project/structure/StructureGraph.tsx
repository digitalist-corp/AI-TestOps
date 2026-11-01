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
import { ArrowRight, CheckCircle2, Pause, Play, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { api } from '@/api/client';
import type { Coverage, CoverageEdgeState, CoverageFlow, CoverageNodeState, SiteMap, SiteMapNode, SiteMapNodeDetail } from '@/types';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { useAiEnabled } from '@/lib/aiEnabled';
import {
  EDGE_STATE_META,
  NODE_STATE_META,
  PLAYBACK_INTERVAL_MS,
  diffNodeStates,
  edgeKey,
  fallbackCoverageNode,
  flowForExecution,
  playbackFrame,
  playbackPlan,
  withCoverageEdges,
  type IssueItem,
  type PlaybackPlan,
} from '@/lib/coverage';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { FlowPanel, type SidePanelTab } from './FlowPanel';
import { GraphToolbar, type GraphFilters } from './GraphToolbar';
import type { IssueActionHandler } from './IssueList';
import { LayoutGroupNode, type LayoutGroupFlowNode } from './LayoutGroupNode';
import { PathBar, DEFAULT_PATH_INSTRUCTION } from './PathBar';
import { PathEdge, PathEdgeDefs, type PathFlowEdge } from './PathEdge';
import { ScreenDetailPanel, DETAIL_PANEL_WIDTH } from './ScreenDetailPanel';
import { ScreenNode, type ScreenFlowNode, type ScreenPlayback } from './ScreenNode';
import { ZoomControls } from './ZoomControls';
import { SCREEN_H, SCREEN_W, groupBoxes, layoutGraph, nodeStatus, type Point } from './layoutGraph';
import { useMediaQuery } from './useMediaQuery';
import { buildConnectivity, usePathSelection } from './usePathSelection';

type GraphNode = ScreenFlowNode | LayoutGroupFlowNode;

const nodeTypes = { screen: ScreenNode, layoutGroup: LayoutGroupNode };
const edgeTypes = { path: PathEdge };

/** 미니맵 색. 앱 테마의 색 변수를 그대로 써서 라이트 · 다크를 따른다. */
const MINIMAP_COLOR: Record<CoverageNodeState, string> = {
  TESTED: 'var(--color-success)',
  OBSERVED: 'var(--color-info)',
  UNSEEN: 'var(--color-border-strong)',
  BLOCKED: 'var(--color-destructive)',
};
const MINIMAP_GROUP_COLOR = 'color-mix(in oklab, var(--color-info) 20%, transparent)';

/** 범례 한 줄. 왼쪽에 색 표시, 오른쪽에 뜻. 마우스를 올리면 한 줄 설명이 뜬다. */
function LegendItem({ children, label, hint }: { children: ReactNode; label: string; hint?: string }) {
  return (
    <span className="pointer-events-auto flex cursor-help items-center gap-1.5" title={hint}>
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

/** 범례의 화면 상자 표시. 그래프 상자와 같은 모양을 작게 그린다. */
const LEGEND_BOX: Record<CoverageNodeState, string> = {
  TESTED: 'border-success bg-success/25',
  OBSERVED: 'border-info border-2 bg-card',
  UNSEEN: 'border-dashed border-border-strong bg-card',
  BLOCKED: 'border-destructive bg-destructive/15',
};

const LEGEND_LINE: Record<CoverageEdgeState, { color: string; dash?: string; width?: number }> = {
  TESTED: { color: 'var(--color-success)', width: 2.25 },
  OBSERVED: { color: 'var(--color-border-strong)', width: 1.5 },
  FAILED: { color: 'var(--color-destructive)', dash: '5 4' },
  UNKNOWN: { color: 'var(--color-border)', dash: '3 4', width: 1.5 },
};

export interface StructureGraphProps {
  projectId: string;
  siteMap: SiteMap;
  /** 화면마다 상태가 채워진 확인 지도 (resolveCoverage) */
  coverage: Coverage;
  issues: IssueItem[];
  onIssueAction: IssueActionHandler;
  busyKey: string | null;
  onNodeUpdated: (node: SiteMapNode) => void;
  onNodeDeleted?: (routeKey: string) => void;
  /** 툴바 오른쪽 끝에 넣을 그래프 ↔ 목록 전환 버튼 */
  viewSwitch?: ReactNode;
  /** 실행이 끝나면 그 흐름을 한 번 자동 재생한다. nonce 가 바뀔 때마다 한 번 */
  autoPlay?: { executionId: number; specPath: string | null; nonce: number } | null;
  /** 요약 카드의 [막힌 곳 보기] 처럼 바깥에서 오른쪽 패널을 여는 요청 */
  panelRequest?: { tab: SidePanelTab; nonce: number } | null;
  /** 실행 · 탐색 중이라 지도가 계속 바뀌는 중 */
  live?: boolean;
  loadDetail?: (projectId: string, routeKey: string) => Promise<SiteMapNodeDetail>;
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

interface Playing {
  flow: CoverageFlow;
  plan: PlaybackPlan;
  /** 몇 박자째인지. 한 박자마다 한 단계씩 켜진다 */
  tick: number;
  paused: boolean;
  /** 다시 재생할 때마다 늘려 흐름 선을 새로 그리게 한다 */
  run: number;
}

function GraphCanvas({
  projectId, siteMap, coverage, issues, onIssueAction, busyKey, onNodeUpdated, onNodeDeleted, viewSwitch,
  autoPlay, panelRequest, live = false, loadDetail = api.getSiteMapNode,
}: StructureGraphProps) {
  const flow = useReactFlow<GraphNode, PathFlowEdge>();
  const { theme } = useTheme();
  const { active: aiActive } = useAiEnabled();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const canvasRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 탐색 중에도 찾은 화면을 바로 그린다. 새 화면은 페이드인으로 나타난다.
  // 녹화 · 테스트 흐름이 지나간 전환은 지도(sitemap.edges)에 없고 coverage.edges 에만 있으므로 합쳐서 배치 · 선 · 경로 연결에 쓴다.
  const graphEdges = useMemo(() => withCoverageEdges(siteMap, coverage.edges), [siteMap, coverage.edges]);
  const shown = useMemo<SiteMap>(() => (graphEdges === siteMap.edges ? siteMap : { ...siteMap, edges: graphEdges }), [siteMap, graphEdges]);

  const laid = useMemo(() => layoutGraph(shown), [shown]);
  const [moved, setMoved] = useState<Record<string, Point>>({});
  const positions = useMemo(() => ({ ...laid.positions, ...moved }), [laid, moved]);
  const groups = useMemo(() => groupBoxes(shown.layouts, positions), [shown.layouts, positions]);
  const nodeByRoute = useMemo(() => new Map(shown.nodes.map((n) => [n.routeKey, n])), [shown.nodes]);
  const covByRoute = useMemo(() => new Map(coverage.nodes.map((n) => [n.routeKey, n])), [coverage.nodes]);
  const edgeStates = useMemo(() => new Map(coverage.edges.map((e) => [edgeKey(e.from, e.to), e.state])), [coverage.edges]);
  // 서버가 전환 상태를 하나도 주지 않았으면(응답 없음) 예전처럼 회색 실선으로 그린다.
  const defaultEdgeState: CoverageEdgeState = coverage.edges.length === 0 ? 'OBSERVED' : 'UNKNOWN';
  const stateOf = useCallback((route: string): CoverageNodeState => covByRoute.get(route)?.state ?? 'UNSEEN', [covByRoute]);

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
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<SidePanelTab>(() => (issues.length > 0 ? 'issues' : 'flows'));
  const [playing, setPlaying] = useState<Playing | null>(null);

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
      (filters.statuses.length === 0 || filters.statuses.includes(stateOf(node.routeKey))) &&
      (!filters.authOnly || node.authRequired) &&
      (q === '' || matchSet.has(node.routeKey)),
    [filters, q, matchSet, stateOf]
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

  // ---------------------------------------------------------------- 새 화면 · 바뀐 화면

  // 지난번 상태와 비교해 새로 나타난 화면은 페이드인, 상태가 바뀐 화면은 잠깐 반짝이게 한다.
  const prevStates = useRef<Map<string, CoverageNodeState> | null>(null);
  const [appeared, setAppeared] = useState<Set<string>>(() => new Set());
  const [changed, setChanged] = useState<Set<string>>(() => new Set());
  const effectTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const next = new Map(coverage.nodes.map((n) => [n.routeKey, n.state]));
    const diff = diffNodeStates(prevStates.current, next);
    prevStates.current = next;
    if (reduceMotion) return;
    if (diff.appeared.length > 0) {
      setAppeared(new Set(diff.appeared));
      effectTimers.current.push(setTimeout(() => setAppeared(new Set()), 900));
    }
    if (diff.changed.length > 0) {
      setChanged(new Set(diff.changed));
      effectTimers.current.push(setTimeout(() => setChanged(new Set()), 2400));
    }
  }, [coverage.nodes, reduceMotion]);
  useEffect(() => () => effectTimers.current.forEach(clearTimeout), []);

  // ---------------------------------------------------------------- 카메라

  /** 상세 패널이 열려 있으면 패널에 가리지 않도록, 남은 왼쪽 캔버스의 가운데로 옮긴다. */
  const centerOn = useCallback(
    (route: string, withPanel: boolean, minZoom = 0.85) => {
      const p = positions[route];
      if (!p) return;
      const zoom = Math.max(flow.getZoom(), minZoom);
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
  /** 막힌 곳 카드를 누르면 그 화면으로 옮겨 크게 보여 준다. */
  const focusScreen = useCallback(
    (route: string) => {
      flashNode(route);
      if (focused) openDetail(route);
      else centerOn(route, false, 1.15);
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

  // 화면 · 전환 구성이 바뀔 때(분석 완료 · 탐색 중 새 화면)와 전체 화면을 오갈 때만 다시 맞춘다. 메모 저장으로는 움직이지 않는다.
  const signature = useMemo(
    () => shown.nodes.map((n) => n.routeKey).join('|') + '#' + laid.edges.map((e) => e.id).join('|'),
    [shown.nodes, laid.edges]
  );
  const fitKey = `${signature}@${fullscreen}@${panelOpen}`;
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

  // ---------------------------------------------------------------- 흐름 재생

  const startPlay = useCallback(
    (target: CoverageFlow) => {
      const plan = playbackPlan(target);
      setPlaying((prev) => ({
        flow: target,
        plan,
        tick: reduceMotion ? plan.steps.length : 0,
        paused: false,
        run: (prev?.run ?? 0) + 1,
      }));
      const ids = [...new Set(target.steps.map((s) => s.routeKey))].filter((r) => positions[r]);
      if (ids.length > 0) {
        requestAnimationFrame(() =>
          flow.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.35, maxZoom: 1.1, duration: reduceMotion ? 0 : 600 })
        );
      }
    },
    [flow, positions, reduceMotion]
  );

  // 0.6초마다 한 단계씩 켠다. 막힌 단계까지 켜지면 멈추고 말풍선을 띄운다.
  useEffect(() => {
    if (!playing || playing.paused || playing.tick >= playing.plan.steps.length) return;
    const timer = setTimeout(
      () => setPlaying((p) => (p ? { ...p, tick: p.tick + 1 } : p)),
      playing.tick === 0 ? 300 : PLAYBACK_INTERVAL_MS
    );
    return () => clearTimeout(timer);
  }, [playing]);

  const replay = () =>
    setPlaying((p) => (p ? { ...p, tick: reduceMotion ? p.plan.steps.length : 0, paused: false, run: p.run + 1 } : p));
  const togglePause = () => setPlaying((p) => (p ? { ...p, paused: !p.paused } : p));

  // 실행이 끝나면 그 흐름을 한 번 자동 재생한다.
  const lastAuto = useRef<number | null>(null);
  useEffect(() => {
    if (!autoPlay || lastAuto.current === autoPlay.nonce) return;
    lastAuto.current = autoPlay.nonce;
    const target = flowForExecution(coverage.flows, { id: autoPlay.executionId, specPath: autoPlay.specPath });
    if (!target) return;
    setPanelOpen(true);
    setPanelTab('flows');
    startPlay(target);
  }, [autoPlay, coverage.flows, startPlay]);

  // 바깥(요약 카드)에서 패널을 열어 달라는 요청
  const lastPanelRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!panelRequest || lastPanelRequest.current === panelRequest.nonce) return;
    lastPanelRequest.current = panelRequest.nonce;
    setPanelOpen(true);
    setPanelTab(panelRequest.tab);
  }, [panelRequest]);

  const frame = useMemo(() => (playing ? playbackFrame(playing.plan, playing.tick) : null), [playing]);
  /** 재생 중인 흐름에서 각 화면의 모습. 같은 화면을 두 번 지나면 나중에 켜진 단계를 보인다 */
  const playByRoute = useMemo(() => {
    const map = new Map<string, ScreenPlayback>();
    if (!playing || !frame) return map;
    const { plan } = playing;
    const litIndex = new Map(plan.steps.slice(0, frame.lit).map((s, i) => [s.index, i]));
    playing.flow.steps.forEach((step, index) => {
      const at = litIndex.get(index);
      const lit = at != null;
      const prev = map.get(step.routeKey);
      if (prev?.lit && !lit) return;
      map.set(step.routeKey, {
        order: index + 1,
        lit,
        tone: plan.tone,
        bubble: lit && frame.showBubble && at === plan.stopAt ? plan.message : null,
      });
    });
    return map;
  }, [playing, frame]);

  // Esc: 상세 닫기 → 재생 끝내기 → 전체 화면 끝내기. / : 검색. F: 전체 보기. 입력 중일 때는 / · F 를 가로채지 않는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable="true"]');
      if (e.key === 'Escape') {
        if (focused) setFocused(null);
        else if (playing) setPlaying(null);
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
  }, [fullscreen, focused, playing, flow]);

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
        dimmed: (filtering && !g.layout.routeKeys.some((r) => nodeByRoute.has(r) && passes(nodeByRoute.get(r)!))) || playing != null,
      },
    }));
    for (const node of shown.nodes) {
      const cov = covByRoute.get(node.routeKey) ?? fallbackCoverageNode(node);
      const play = playByRoute.get(node.routeKey) ?? null;
      list.push({
        id: node.routeKey,
        type: 'screen',
        position: positions[node.routeKey],
        width: SCREEN_W,
        height: SCREEN_H,
        // 말풍선이 이웃 화면 위로 보이도록 막힌 화면을 위로 올린다
        zIndex: play?.bubble ? 20 : undefined,
        // 키보드로 노드에 초점이 갈 때 나오는 테두리가 카드 모서리를 따라 둥글게 보이도록
        className: 'rounded-lg',
        ariaLabel: `${node.title ?? node.routeKey} 화면 · ${NODE_STATE_META[cov.state].label}`,
        data: {
          node,
          status: nodeStatus(node),
          state: cov.state,
          coverage: cov,
          entry: laid.entry === node.routeKey,
          orders: path.orders.get(node.routeKey) ?? [],
          dimmed: (filtering && !passes(node)) || (playing != null && play == null),
          hot: hotSet.has(node.routeKey),
          focused: focused === node.routeKey,
          flash: flash === node.routeKey,
          appeared: appeared.has(node.routeKey),
          changed: changed.has(node.routeKey),
          play,
          onAdd: addToPath,
          onOpen: openDetail,
        },
      });
    }
    return list;
  }, [groups, shown.nodes, covByRoute, playByRoute, positions, laid, path.orders, filtering, passes, playing, hotSet, hovered, focused, flash, appeared, changed, nodeByRoute, addToPath, openDetail]);

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
          dimmed: (hovered != null && !hot) || dimByFilter(e.from, e.to) || playing != null,
          coverage: edgeStates.get(edgeKey(e.from, e.to)) ?? defaultEdgeState,
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
            data: { kind: 'layout', steps: [], labels: [], count: 0, hot, dimmed: (hovered != null && !hot) || playing != null },
          });
        }
      }
    }
    // 재생 중인 흐름: 켜진 단계 사이에 선을 하나씩 그려 나간다. 막힌 단계로 들어가는 선은 빨갛다.
    if (playing && frame) {
      const { plan, run } = playing;
      for (let i = 1; i < frame.lit; i++) {
        const from = plan.steps[i - 1].routeKey;
        const to = plan.steps[i].routeKey;
        if (from === to || !nodeByRoute.has(from) || !nodeByRoute.has(to)) continue;
        list.push({
          id: `f:${run}:${i}`,
          source: from,
          target: to,
          type: 'path',
          zIndex: 8,
          data: {
            kind: 'flow',
            steps: [],
            labels: [],
            count: 0,
            hot: false,
            dimmed: false,
            flowTone: plan.stopAt === i ? 'fail' : plan.tone === 'pending' ? 'pending' : 'pass',
          },
        });
      }
    }
    return list;
  }, [laid.edges, path.segments, filtering, passes, nodeByRoute, hovered, showMenuLinks, groups, edgeStates, defaultEdgeState, playing, frame]);

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
    const c = { TESTED: 0, OBSERVED: 0, UNSEEN: 0, BLOCKED: 0, auth: 0, screens: shown.nodes.length, transitions: laid.edges.length };
    for (const node of shown.nodes) {
      c[stateOf(node.routeKey)] += 1;
      if (node.authRequired) c.auth += 1;
    }
    return c;
  }, [shown.nodes, laid.edges, stateOf]);

  const edgeStatesUsed = useMemo(() => {
    const used = new Set<CoverageEdgeState>();
    for (const e of laid.edges) used.add(edgeStates.get(edgeKey(e.from, e.to)) ?? defaultEdgeState);
    return used;
  }, [laid.edges, edgeStates, defaultEdgeState]);

  const playTitle = playing?.flow.title;
  const playSteps = playing?.plan.steps.length ?? 0;

  return (
    <div
      className={cn(
        '@container flex flex-col overflow-hidden bg-background',
        fullscreen ? 'fixed inset-0 z-50' : 'relative h-[calc(100dvh-12rem)] min-h-[660px] rounded-lg border border-border',
        live && 'coverage-live'
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

      <div className="flex min-h-0 flex-1">
        <div ref={canvasRef} className="relative min-w-0 flex-1">
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

            {/* 표시 전용 패널이라 바탕 클릭은 아래 캔버스로 흘려보낸다. 항목에만 마우스를 올려 설명을 볼 수 있다. */}
            <Panel
              position="top-left"
              className="pointer-events-none !m-3 flex max-w-[min(640px,calc(100%-24px))] flex-wrap items-center gap-x-3.5 gap-y-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm select-none"
              role="group"
              aria-label="범례"
            >
              {(['TESTED', 'OBSERVED', 'UNSEEN', 'BLOCKED'] as const).map((state) => (
                <LegendItem key={state} label={NODE_STATE_META[state].label} hint={NODE_STATE_META[state].hint}>
                  <i className={cn('relative h-3 w-4 rounded-[3px] border', LEGEND_BOX[state])}>
                    {state === 'BLOCKED' && <TriangleAlert className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 text-destructive" />}
                  </i>
                </LegendItem>
              ))}
              <span aria-hidden="true" className="h-3 w-px bg-border" />
              {(['TESTED', 'OBSERVED', 'FAILED', 'UNKNOWN'] as const)
                .filter((state) => edgeStatesUsed.has(state))
                .map((state) => (
                  <LegendItem key={state} label={EDGE_STATE_META[state].label} hint={EDGE_STATE_META[state].hint}>
                    <LegendLine {...LEGEND_LINE[state]} />
                  </LegendItem>
                ))}
              {path.chips.length > 0 && (
                <LegendItem label="선택한 경로" hint="테스트로 만들려고 고른 화면 순서">
                  <LegendLine color="var(--color-primary)" width={2.5} />
                </LegendItem>
              )}
              {showMenuLinks && (
                <LegendItem label="공용 메뉴" hint="모든 화면에 붙어 있는 메뉴에서 가는 길">
                  <LegendLine color="var(--color-info)" dash="2 4" />
                </LegendItem>
              )}
              {path.brokenCount > 0 && (
                <LegendItem label="전환 없음" hint="고른 두 화면 사이에 찾은 길이 없어요">
                  <LegendLine color="var(--color-warning)" dash="5 4" />
                </LegendItem>
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

            {playing && frame && (
              <Panel position="bottom-center" className="!mb-4">
                <div
                  className="flex items-center gap-2 rounded-full border border-border bg-card py-1.5 pl-4 pr-1.5 text-xs shadow-md"
                  role="status"
                  aria-live="polite"
                  data-testid="structure-flow-player"
                >
                  <span className="max-w-56 truncate font-semibold text-foreground" title={playTitle}>
                    {playTitle}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {frame.lit}/{playSteps}단계
                  </span>
                  {frame.done && (
                    <span
                      className={cn(
                        'font-semibold',
                        frame.showBubble ? 'text-destructive' : playing.plan.tone === 'pending' ? 'text-primary' : 'text-success'
                      )}
                    >
                      {frame.showBubble ? '여기서 막혔어요' : playing.plan.tone === 'pending' ? '아직 돌려 보지 않은 길이에요' : '끝까지 통과했어요'}
                    </span>
                  )}
                  {!frame.done && (
                    <Button size="xs" variant="outline" className="h-7 rounded-full" onClick={togglePause}>
                      {playing.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                      {playing.paused ? '이어서' : '멈춤'}
                    </Button>
                  )}
                  <Button size="xs" variant="outline" className="h-7 rounded-full" onClick={replay}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    다시 재생
                  </Button>
                  <button
                    type="button"
                    onClick={() => setPlaying(null)}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="재생 끝내기 (Esc)"
                    aria-label="재생 끝내기"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </Panel>
            )}

            {showMiniMap && (
              <MiniMap<GraphNode>
                position="bottom-right"
                pannable
                zoomable
                className="overflow-hidden rounded-lg border border-border shadow-sm"
                bgColor="var(--color-card)"
                nodeBorderRadius={3}
                nodeStrokeWidth={0}
                nodeColor={(n) => (n.type === 'screen' ? MINIMAP_COLOR[(n as ScreenFlowNode).data.state] : MINIMAP_GROUP_COLOR)}
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
              onNodeUpdated={onNodeUpdated}
              onDeleteNode={(route) => onNodeDeleted?.(route)}
              coverage={covByRoute.get(focused)}
              flows={coverage.flows}
              issues={issues.filter((i) => i.routeKey === focused)}
              onIssueAction={onIssueAction}
              busyKey={busyKey}
              loadDetail={loadDetail}
            />
          )}
        </div>

        <FlowPanel
          open={panelOpen}
          onOpen={setPanelOpen}
          tab={panelTab}
          onTab={setPanelTab}
          flows={coverage.flows}
          issues={issues}
          nodeByRoute={nodeByRoute}
          playingSpec={playing?.flow.specPath ?? null}
          onPlay={(target) => (playing?.flow.specPath === target.specPath ? replay() : startPlay(target))}
          aiActive={aiActive}
          onAction={onIssueAction}
          busyKey={busyKey}
          onSelectScreen={focusScreen}
        />
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
