import type {
  Coverage,
  CoverageAction,
  CoverageEdgeState,
  CoverageFlow,
  CoverageFlowSource,
  CoverageFlowStatus,
  CoverageIssue,
  CoverageIssueKind,
  CoverageNode,
  CoverageNodeState,
  CoverageStepState,
  CoverageSummary,
  Execution,
  SiteMap,
  SiteMapElement,
  SiteMapNode,
  SiteMapNodeDetail,
} from '@/types';

/**
 * 구조 탭 "확인 지도"의 순수 로직. 화면이 쓰는 이름 · 색, 요약 문장, 흐름 재생 순서, 다시 읽기(폴링) 판단을
 * 여기에 모아 두고 단위 테스트로 지킨다. 계약: docs/design/structure-coverage-contract.md
 */

type Tone = 'success' | 'info' | 'neutral' | 'destructive' | 'warning';

// ---------------------------------------------------------------- 이름 · 색

/** 화면(노드) 상태. 요약 막대 · 범례 · 필터 · 상세 패널이 함께 쓴다. 순서가 곧 화면에 놓이는 순서다. */
export const NODE_STATES: CoverageNodeState[] = ['TESTED', 'OBSERVED', 'UNSEEN', 'BLOCKED'];

export const NODE_STATE_META: Record<CoverageNodeState, { label: string; hint: string; bar: string; tone: Tone }> = {
  TESTED: { label: '테스트 통과', hint: '테스트가 이 화면을 지나가 통과했어요', bar: 'bg-success', tone: 'success' },
  OBSERVED: { label: '화면에서 확인됨', hint: '실제 화면을 열어 봤어요. 아직 이 화면을 지나는 테스트는 없어요', bar: 'bg-info', tone: 'info' },
  UNSEEN: { label: '아직 안 봄', hint: '코드로만 알고 있어요. 실제 화면은 아직 열어 보지 않았어요', bar: 'bg-border-strong', tone: 'neutral' },
  BLOCKED: { label: '막힘', hint: '테스트나 탐색이 이 화면에서 멈췄어요. 고칠 방법을 확인해 보세요', bar: 'bg-destructive', tone: 'destructive' },
};

/** 요소 하나의 확인 상태 */
export const ELEMENT_STATE_META: Record<SiteMapElement['verification'], { label: string; hint: string; tone: Tone }> = {
  PASSED: { label: '테스트 통과', hint: '테스트가 이 요소를 써 보고 통과했어요', tone: 'success' },
  OBSERVED: { label: '화면에서 확인됨', hint: '실제 화면에서 이 요소를 정확히 하나 찾았어요', tone: 'info' },
  UNVERIFIED: { label: '아직 안 봄', hint: '코드에서만 찾았어요. 실제 화면에서는 아직 확인 전이에요', tone: 'neutral' },
  FAILED: { label: '실패', hint: '테스트가 이 요소에서 실패했어요', tone: 'destructive' },
};

/** 화면 사이 이동(전환선) 상태 */
export const EDGE_STATE_META: Record<CoverageEdgeState, { label: string; hint: string }> = {
  TESTED: { label: '테스트로 지나감', hint: '통과한 테스트가 이 길로 이동했어요' },
  OBSERVED: { label: '화면에서 이동 확인', hint: '탐색 · 녹화 중에 실제로 이 길로 이동했어요' },
  FAILED: { label: '여기서 막힘', hint: '테스트가 이 길로 가다 멈췄어요' },
  UNKNOWN: { label: '아직 모름', hint: '코드로만 알고 있는 이동이에요' },
};

export const FLOW_SOURCE_META: Record<CoverageFlowSource, { label: string; hint: string }> = {
  RECORDED: { label: '녹화', hint: '화면을 직접 클릭해 녹화한 테스트' },
  GENERATED: { label: 'AI', hint: 'AI 가 만든 테스트' },
  PATH: { label: '경로', hint: '지도에서 화면을 이어 골라 만든 테스트' },
  OTHER: { label: '직접 작성', hint: '직접 작성한 테스트' },
};

export const FLOW_STATUS_META: Record<CoverageFlowStatus, { label: string; tone: Tone }> = {
  PASSED: { label: '통과', tone: 'success' },
  FAILED: { label: '막힘', tone: 'destructive' },
  NEVER_RUN: { label: '아직 안 돌림', tone: 'neutral' },
};

export const STEP_STATE_META: Record<CoverageStepState, { mark: string; label: string }> = {
  PASSED: { mark: '✓', label: '통과' },
  FAILED: { mark: '✗', label: '여기서 막힘' },
  NOT_REACHED: { mark: '○', label: '가 보지 못함' },
  PENDING: { mark: '○', label: '아직 안 돌림' },
};

export const ISSUE_KIND_META: Record<CoverageIssueKind, { title: string }> = {
  LOGIN_REQUIRED: { title: '로그인이 필요해요' },
  OPEN_FAILED: { title: '화면이 열리지 않았어요' },
  SELECTOR_FAILED: { title: '버튼이나 입력칸을 찾지 못했어요' },
  EXPLORE_STOPPED: { title: '탐색이 여기서 멈췄어요' },
  NOT_REACHED: { title: '여기까지 가지 못했어요' },
};

export const ACTION_META: Record<Exclude<CoverageAction, 'NONE'>, { label: string; hint: string }> = {
  SET_LOGIN: {
    label: '로그인 정보 넣기',
    hint: '환경변수에 LOGIN_ID · LOGIN_PASSWORD 를 넣으면 로그인 뒤 화면까지 열어 볼 수 있어요',
  },
  RECORD_AGAIN: { label: '다시 녹화하기', hint: '이 화면에서 녹화를 다시 시작해 테스트를 새로 만들어요' },
  FIX_WITH_AI: { label: 'AI로 고치기', hint: '실패한 실행을 보고 AI 가 테스트 수정안을 만들어요. AI 검토에서 승인하면 반영돼요' },
  RERUN: { label: '다시 실행', hint: '이 테스트를 지금 다시 돌려요' },
};

/** 막힌 곳 목록에서 위에 둘 순서. 로그인은 뒤의 화면을 모두 막으므로 맨 먼저 푼다. */
const ISSUE_PRIORITY: Record<CoverageIssueKind, number> = {
  LOGIN_REQUIRED: 0,
  OPEN_FAILED: 1,
  SELECTOR_FAILED: 2,
  EXPLORE_STOPPED: 3,
  NOT_REACHED: 4,
};

/** 막힘으로 치는 원인. NOT_REACHED 는 앞에서 막혀 못 간 것이라 그 화면 자체는 막힘이 아니다. */
const BLOCKING_KINDS: CoverageIssueKind[] = ['SELECTOR_FAILED', 'LOGIN_REQUIRED', 'OPEN_FAILED', 'EXPLORE_STOPPED'];

// ---------------------------------------------------------------- 화면 · 요소 이름

/** 화면 이름: 제목 → 화면 파일 이름 → 주소 */
export function screenName(node: Pick<SiteMapNode, 'title' | 'sourceFile' | 'routeKey'> | undefined, routeKey: string): string {
  if (!node) return routeKey;
  return node.title ?? node.sourceFile?.split('/').pop() ?? node.routeKey;
}

const ELEMENT_KIND_LABEL: Record<string, string> = {
  button: '버튼',
  link: '링크',
  a: '링크',
  input: '입력칸',
  textbox: '입력칸',
  textarea: '입력칸',
  searchbox: '검색칸',
  checkbox: '체크박스',
  radio: '선택 버튼',
  select: '선택 상자',
  combobox: '선택 상자',
  tab: '탭',
  menuitem: '메뉴',
  form: '폼',
  switch: '스위치',
};

export function elementKindLabel(kind: string | null): string {
  if (!kind) return '요소';
  return ELEMENT_KIND_LABEL[kind.toLowerCase()] ?? kind;
}

/** 요소를 사람이 알아볼 이름. 셀렉터는 쓰지 않는다. */
export function elementName(element: Pick<SiteMapElement, 'name' | 'text' | 'label' | 'placeholder' | 'testId'>): string {
  return element.name || element.text || element.label || element.placeholder || element.testId || '이름 없는 요소';
}

/** 화면 상자 안의 비율 한 줄. 예: "요소 20개 중 3개 통과" */
export function elementRatioText(counts: CoverageNode['counts']): string {
  const { total, passed, failed, observed } = counts;
  if (total === 0) return '찾은 요소 없음';
  let text: string;
  if (passed > 0) text = `요소 ${total}개 중 ${passed}개 통과`;
  else if (observed > 0) text = `요소 ${total}개 중 ${observed}개 확인`;
  else text = `요소 ${total}개 · 아직 안 봄`;
  return failed > 0 ? `${text} · ${failed}개 실패` : text;
}

/** "방금 전" · "18분 전" · "3시간 전" · "2일 전", 일주일이 넘으면 날짜 */
export function timeAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '';
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

// ---------------------------------------------------------------- 요약

/** 맨 위 요약 카드의 문장. 예: "화면 12개 중 8개를 테스트로 확인했어요." + "2곳에서 막혔어요." */
export function summaryText(summary: CoverageSummary): { headline: string; blocked: string | null; next: string | null } {
  const { screens, tested, observed, unseen, blocked, flows } = summary;
  if (screens === 0) {
    return { headline: '아직 지도에 화면이 없어요.', blocked: null, next: '사이트 주소로 찾기나 코드로 찾기로 화면을 모아 보세요.' };
  }
  const headline =
    tested === screens && blocked === 0
      ? `화면 ${screens}개를 모두 테스트로 확인했어요.`
      : tested > 0
        ? `화면 ${screens}개 중 ${tested}개를 테스트로 확인했어요.`
        : `화면 ${screens}개를 찾았어요. 아직 테스트로 확인한 화면은 없어요.`;
  const blockedText = blocked > 0 ? `${blocked}곳에서 막혔어요.` : null;
  let next: string | null = null;
  if (blocked > 0) next = '막힌 곳부터 풀면 뒤의 화면도 이어서 확인할 수 있어요.';
  else if (flows === 0) next = '녹화하거나 지도에서 경로를 골라 첫 테스트를 만들어 보세요.';
  else if (unseen > 0) next = `아직 안 본 화면 ${unseen}개는 사이트 탐색이나 녹화로 열어 볼 수 있어요.`;
  else if (observed > 0) next = `화면에서 확인된 ${observed}개는 테스트를 만들면 '테스트 통과'로 바뀌어요.`;
  return { headline, blocked: blockedText, next };
}

/** 요약 문장 한 줄 (제목 + 막힘) */
export function summarySentence(summary: CoverageSummary): string {
  const { headline, blocked } = summaryText(summary);
  return blocked ? `${headline} ${blocked}` : headline;
}

/** 4칸 진행 막대. 순서는 NODE_STATES(테스트 통과 · 화면에서 확인됨 · 아직 안 봄 · 막힘). */
export function progressSegments(summary: CoverageSummary): { state: CoverageNodeState; count: number; percent: number }[] {
  const counts: Record<CoverageNodeState, number> = {
    TESTED: summary.tested,
    OBSERVED: summary.observed,
    UNSEEN: summary.unseen,
    BLOCKED: summary.blocked,
  };
  const total = NODE_STATES.reduce((sum, s) => sum + counts[s], 0);
  return NODE_STATES.map((state) => ({
    state,
    count: counts[state],
    percent: total === 0 ? 0 : (counts[state] / total) * 100,
  }));
}

// ---------------------------------------------------------------- 서버 응답이 없을 때

const SEEN_ORIGINS = new Set(['SITE', 'URL', 'RECORDED']);

/**
 * coverage 를 못 받았을 때(서버가 아직 없거나 그 화면이 응답에 없을 때) 지도 숫자만으로 정하는 상태.
 * 실패 요소 → 막힘, 통과 요소 → 테스트 통과, 실제로 본 요소 · 사이트에서 찾은 화면 → 화면에서 확인됨.
 */
export function fallbackNodeState(
  node: Pick<SiteMapNode, 'failedCount' | 'passedCount' | 'origin'> & { observedCount?: number }
): CoverageNodeState {
  if (node.failedCount > 0) return 'BLOCKED';
  if (node.passedCount > 0) return 'TESTED';
  if ((node.observedCount ?? 0) > 0 || SEEN_ORIGINS.has(node.origin)) return 'OBSERVED';
  return 'UNSEEN';
}

export function fallbackCoverageNode(node: SiteMapNode): CoverageNode {
  const state = fallbackNodeState(node);
  const observed = node.observedCount ?? 0;
  return {
    routeKey: node.routeKey,
    state,
    counts: {
      passed: node.passedCount,
      failed: node.failedCount,
      observed,
      unseen: Math.max(0, node.elementCount - node.passedCount - node.failedCount - observed),
      total: node.elementCount,
    },
    issues:
      state === 'BLOCKED'
        ? [{ kind: 'SELECTOR_FAILED', message: '테스트가 이 화면에서 실패했어요', action: 'NONE' }]
        : [],
  };
}

function summarize(nodes: CoverageNode[], excluded: Set<string>, flows: CoverageFlow[]): CoverageSummary {
  const summary: CoverageSummary = { screens: 0, tested: 0, observed: 0, unseen: 0, blocked: 0, flows: flows.length, lastRunAt: null };
  const key: Record<CoverageNodeState, 'tested' | 'observed' | 'unseen' | 'blocked'> = {
    TESTED: 'tested',
    OBSERVED: 'observed',
    UNSEEN: 'unseen',
    BLOCKED: 'blocked',
  };
  for (const node of nodes) {
    if (excluded.has(node.routeKey)) continue;
    summary.screens += 1;
    summary[key[node.state]] += 1;
  }
  for (const flow of flows) {
    if (flow.lastRunAt && (!summary.lastRunAt || flow.lastRunAt > summary.lastRunAt)) summary.lastRunAt = flow.lastRunAt;
  }
  return summary;
}

/**
 * 화면에 쓸 coverage. 지도에 있는 모든 화면이 상태를 갖도록 빠진 화면은 지도 숫자로 채운다.
 * 서버 응답이 없으면 통째로 지도 숫자에서 만든다(흐름 · 막힌 이유는 비어 있다).
 */
export function resolveCoverage(siteMap: Pick<SiteMap, 'nodes' | 'edges'>, coverage: Coverage | null): Coverage {
  const byRoute = new Map((coverage?.nodes ?? []).map((n) => [n.routeKey, n]));
  const nodes = siteMap.nodes.map((node) => byRoute.get(node.routeKey) ?? fallbackCoverageNode(node));
  if (coverage) {
    const missing = siteMap.nodes.some((n) => !byRoute.has(n.routeKey));
    const excluded = new Set(siteMap.nodes.filter((n) => n.excluded).map((n) => n.routeKey));
    // 탐색 중에 막 나타난 화면처럼 응답에 아직 없는 화면이 있으면 요약도 다시 센다.
    const summary = missing ? { ...summarize(nodes, excluded, coverage.flows), lastRunAt: coverage.summary.lastRunAt } : coverage.summary;
    return { ...coverage, summary, nodes };
  }
  const excluded = new Set(siteMap.nodes.filter((n) => n.excluded).map((n) => n.routeKey));
  return { summary: summarize(nodes, excluded, []), nodes, edges: [], flows: [] };
}

export function edgeKey(from: string, to: string) {
  return `${from}->${to}`;
}

// ---------------------------------------------------------------- 막힌 곳

export interface IssueItem {
  routeKey: string;
  name: string;
  issue: CoverageIssue;
}

/** 화면별 막힌 이유를 카드 목록으로 편다. 로그인 → 열기 실패 → 요소 실패 순, 같은 종류는 지도 순서대로. */
export function issueItems(coverage: Coverage, nodeByRoute: Map<string, SiteMapNode>): IssueItem[] {
  const items: (IssueItem & { order: number })[] = [];
  coverage.nodes.forEach((node, order) => {
    for (const issue of node.issues) {
      items.push({ routeKey: node.routeKey, name: screenName(nodeByRoute.get(node.routeKey), node.routeKey), issue, order });
    }
  });
  return items
    .sort((a, b) => ISSUE_PRIORITY[a.issue.kind] - ISSUE_PRIORITY[b.issue.kind] || a.order - b.order)
    .map(({ order: _order, ...item }) => item);
}

export function isBlockingIssue(issue: Pick<CoverageIssue, 'kind'>) {
  return BLOCKING_KINDS.includes(issue.kind);
}

/**
 * 카드에 보일 행동 버튼. 첫째가 추천 행동이다.
 * - AI 로 고치기는 AI 가 켜져 있고 실패한 실행 · 테스트를 알 때만. 안 되면 다시 녹화하기로 바꾼다.
 * - 다시 실행은 테스트를 알 때만. 요소를 못 찾은 경우엔 고친 뒤 다시 돌려 볼 수 있게 덧붙인다.
 */
export function issueActions(issue: CoverageIssue, aiActive: boolean): Exclude<CoverageAction, 'NONE'>[] {
  const actions: Exclude<CoverageAction, 'NONE'>[] = [];
  const push = (action: CoverageAction) => {
    if (action !== 'NONE' && !actions.includes(action)) actions.push(action);
  };
  let primary: CoverageAction = issue.action;
  if (primary === 'FIX_WITH_AI' && !(aiActive && issue.executionId != null && issue.specPath)) primary = 'RECORD_AGAIN';
  if (primary === 'RERUN' && !issue.specPath) primary = 'NONE';
  push(primary);
  if (issue.kind === 'SELECTOR_FAILED' && issue.specPath) push('RERUN');
  return actions;
}

/** 다시 녹화하기: 녹화 탭을 그 화면 주소로 연다. */
export function recorderLink(projectId: string, routeKey: string, node?: Pick<SiteMapNode, 'url'>): string {
  return `/projects/${projectId}/recorder?url=${encodeURIComponent(node?.url || routeKey)}`;
}

// ---------------------------------------------------------------- 흐름 재생

/** 재생할 때 한 단계씩 켜지는 간격 */
export const PLAYBACK_INTERVAL_MS = 600;

export interface PlaybackPlan {
  specPath: string;
  /** 차례로 켜질 단계. 막힌 단계가 있으면 거기까지만 담는다. index 는 흐름의 steps 에서의 위치 */
  steps: { routeKey: string; state: CoverageStepState; index: number }[];
  /** 막힌 단계의 위치. 없으면 null */
  stopAt: number | null;
  /** 막힌 단계에서 보여 줄 이유 */
  message: string | null;
  tone: 'pass' | 'fail' | 'pending';
}

/** 흐름의 단계를 재생 순서로 만든다. 막힌(FAILED) 단계에서 멈추고, 그 뒤(가 보지 못한 단계)는 켜지 않는다. */
export function playbackPlan(flow: CoverageFlow): PlaybackPlan {
  const steps: PlaybackPlan['steps'] = [];
  let stopAt: number | null = null;
  let message: string | null = null;
  for (const [index, step] of flow.steps.entries()) {
    if (step.state === 'NOT_REACHED') continue;
    steps.push({ routeKey: step.routeKey, state: step.state, index });
    if (step.state === 'FAILED') {
      stopAt = steps.length - 1;
      message = step.message || '테스트가 이 화면에서 멈췄어요';
      break;
    }
  }
  const tone = flow.lastStatus === 'PASSED' ? 'pass' : flow.lastStatus === 'FAILED' ? 'fail' : 'pending';
  return { specPath: flow.specPath, steps, stopAt, message, tone };
}

/** tick 번째 박자의 모습. tick 0 이면 아무것도 안 켜졌고, 한 박자마다 한 단계씩 켜진다. */
export function playbackFrame(plan: PlaybackPlan, tick: number): { lit: number; done: boolean; showBubble: boolean } {
  const lit = Math.max(0, Math.min(tick, plan.steps.length));
  const done = lit >= plan.steps.length;
  return { lit, done, showBubble: done && plan.stopAt != null };
}

// ---------------------------------------------------------------- 다시 읽기(폴링)

/** 지도를 다시 읽는 간격 */
export const LIVE_POLL_MS = 5000;

const ACTIVE_EXECUTION: Execution['status'][] = ['PENDING', 'RUNNING', 'CANCEL_REQUESTED'];

export function isActiveExecution(execution: Pick<Execution, 'status'>) {
  return ACTIVE_EXECUTION.includes(execution.status);
}

/** 실행 중인 테스트가 있거나 사이트 탐색(분석) 중이면 5초마다 다시 읽는다. */
export function shouldPoll(input: { analysisRunning: boolean; executions: Pick<Execution, 'status'>[] }): boolean {
  return input.analysisRunning || input.executions.some(isActiveExecution);
}

/** 지난번엔 돌고 있었는데 이번엔 끝난 실행. 지도에 "방금 결과"를 재생하는 데 쓴다. */
export function finishedExecutions<T extends Pick<Execution, 'id' | 'status'>>(prev: T[], next: T[]): T[] {
  const wasActive = new Set(prev.filter(isActiveExecution).map((e) => e.id));
  return next.filter((e) => wasActive.has(e.id) && !isActiveExecution(e));
}

/** 실행 하나에 해당하는 흐름. 실행 번호가 같으면 그것, 아니면 같은 테스트 파일. */
export function flowForExecution(flows: CoverageFlow[], execution: Pick<Execution, 'id' | 'specPath'>): CoverageFlow | null {
  return (
    flows.find((f) => f.executionId === execution.id) ??
    (execution.specPath ? flows.find((f) => f.specPath === execution.specPath) : undefined) ??
    null
  );
}

/** 지난번과 비교해 새로 나타난 화면과 상태가 바뀐 화면. 처음 읽을 때(prev 없음)는 둘 다 비운다. */
export function diffNodeStates(
  prev: Map<string, CoverageNodeState> | null,
  next: Map<string, CoverageNodeState>
): { appeared: string[]; changed: string[] } {
  if (!prev) return { appeared: [], changed: [] };
  const appeared: string[] = [];
  const changed: string[] = [];
  for (const [route, state] of next) {
    const before = prev.get(route);
    if (before == null) appeared.push(route);
    else if (before !== state) changed.push(route);
  }
  return { appeared, changed };
}

// ---------------------------------------------------------------- 데이터 출처

/** 구조 탭이 읽는 데이터. 개발용 가짜 응답(?coverageMock=1)과 실제 서버가 같은 모양을 쓴다. */
export interface StructureSource {
  getSiteMap: (projectId: string) => Promise<SiteMap>;
  getCoverage: (projectId: string) => Promise<Coverage>;
  getExecutions: (projectId: string) => Promise<Execution[]>;
  getSiteMapNode: (projectId: string, routeKey: string) => Promise<SiteMapNodeDetail>;
  runSpec: (projectId: string, specPath: string) => Promise<Execution>;
}
