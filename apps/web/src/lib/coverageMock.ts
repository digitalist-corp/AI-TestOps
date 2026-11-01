import type {
  Coverage,
  CoverageEdge,
  CoverageFlow,
  CoverageNode,
  Execution,
  SiteMap,
  SiteMapElement,
  SiteMapNode,
  SiteMapNodeDetail,
} from '@/types';
import type { StructureSource } from './coverage';

/**
 * 개발 서버 전용 가짜 확인 지도. 구조 탭 주소에 ?coverageMock=1 을 붙이면 서버 없이 화면을 본다.
 * 화면 6개, 흐름 3개(통과 · 중간에 막힘 · 아직 안 돌림), 로그인 막힘 1곳.
 * 막힌 흐름을 "다시 실행"하면 7초 동안 실행 중으로 보이다 통과로 바뀌어 동적 갱신 · 자동 재생을 확인할 수 있다.
 * StructureTab 이 import.meta.env.DEV 일 때만 동적으로 불러오므로 운영 빌드에는 실리지 않는다.
 */

const RUN_MS = 7000;
const CHECKOUT_SPEC = 'tests/checkout.spec.ts';

function screen(routeKey: string, title: string, counts: { passed: number; failed: number; observed: number; total: number }, patch: Partial<SiteMapNode> = {}): SiteMapNode {
  return {
    routeKey,
    title,
    sourceFile: null,
    origin: 'SITE',
    stale: false,
    elementCount: counts.total,
    excluded: false,
    note: null,
    url: `https://shop.example.com${routeKey === '/' ? '/' : `${routeKey}.html`}`,
    hasScreenshot: false,
    authRequired: routeKey !== '/',
    passedCount: counts.passed,
    failedCount: counts.failed,
    observedCount: counts.observed,
    unverifiedCount: counts.total - counts.passed - counts.failed - counts.observed,
    ...patch,
  };
}

function covNode(node: SiteMapNode, state: CoverageNode['state'], issues: CoverageNode['issues'] = []): CoverageNode {
  return {
    routeKey: node.routeKey,
    state,
    counts: {
      passed: node.passedCount,
      failed: node.failedCount,
      observed: node.observedCount,
      unseen: node.unverifiedCount,
      total: node.elementCount,
    },
    issues,
  };
}

function minutesAgo(min: number) {
  return new Date(Date.now() - min * 60_000).toISOString();
}

function execution(id: number, specPath: string, status: Execution['status'], at: string): Execution {
  return {
    id,
    projectId: 'mock',
    status,
    grepFilter: null,
    specPath,
    caseTitle: null,
    totalTests: 1,
    passedTests: status === 'PASSED' ? 1 : 0,
    failedTests: status === 'FAILED' ? 1 : 0,
    skippedTests: 0,
    durationMs: status === 'RUNNING' ? null : 4200,
    errorMessage: null,
    startedAt: at,
    finishedAt: status === 'RUNNING' ? null : at,
    createdAt: at,
  };
}

/** 고쳐지기 전(처음) 상태와 다시 실행해 통과한 뒤 상태 */
function build(fixed: boolean): { siteMap: SiteMap; coverage: Coverage } {
  const login = screen('/', '로그인', { passed: 3, failed: 0, observed: 0, total: 3 });
  const items = screen('/inventory', '상품 목록', { passed: 4, failed: 0, observed: 6, total: 20 });
  const cart = screen('/cart', '장바구니', fixed ? { passed: 3, failed: 0, observed: 2, total: 6 } : { passed: 0, failed: 0, observed: 5, total: 6 });
  const checkout = screen('/checkout', '결제', fixed ? { passed: 5, failed: 0, observed: 2, total: 8 } : { passed: 2, failed: 1, observed: 4, total: 8 });
  const complete = screen('/complete', '주문 완료', fixed ? { passed: 1, failed: 0, observed: 0, total: 2 } : { passed: 0, failed: 0, observed: 0, total: 2 }, { origin: 'CODE', url: null });
  const account = screen('/account', '내 정보', { passed: 0, failed: 0, observed: 0, total: 5 }, { origin: 'CODE', url: null });
  const nodes = [login, items, cart, checkout, complete, account];

  const lastRun = fixed ? minutesAgo(0) : minutesAgo(18);
  const flows: CoverageFlow[] = [
    {
      specPath: 'tests/login-browse.spec.ts',
      title: '로그인하고 상품 둘러보기',
      source: 'RECORDED',
      lastStatus: 'PASSED',
      lastRunAt: minutesAgo(40),
      executionId: 41,
      steps: [
        { routeKey: '/', state: 'PASSED' },
        { routeKey: '/inventory', state: 'PASSED' },
      ],
    },
    {
      specPath: CHECKOUT_SPEC,
      title: '장바구니에 담아 결제하기',
      source: 'PATH',
      lastStatus: fixed ? 'PASSED' : 'FAILED',
      lastRunAt: lastRun,
      executionId: fixed ? 100 : 42,
      steps: fixed
        ? ['/', '/inventory', '/cart', '/checkout', '/complete'].map((routeKey) => ({ routeKey, state: 'PASSED' as const }))
        : [
            { routeKey: '/', state: 'PASSED' },
            { routeKey: '/inventory', state: 'PASSED' },
            { routeKey: '/cart', state: 'PASSED' },
            { routeKey: '/checkout', state: 'FAILED', message: "'결제하기' 버튼을 찾지 못했습니다" },
            { routeKey: '/complete', state: 'NOT_REACHED' },
          ],
    },
    {
      specPath: 'tests/account-edit.spec.ts',
      title: '내 정보 바꾸기',
      source: 'GENERATED',
      lastStatus: 'NEVER_RUN',
      lastRunAt: null,
      executionId: null,
      steps: [
        { routeKey: '/', state: 'PENDING' },
        { routeKey: '/account', state: 'PENDING' },
      ],
    },
  ];

  const loginIssue = {
    kind: 'LOGIN_REQUIRED' as const,
    message: '로그인 정보가 없어 이 화면을 열지 못했습니다',
    action: 'SET_LOGIN' as const,
    at: minutesAgo(60),
  };
  const coverageNodes = [
    covNode(login, 'TESTED'),
    covNode(items, 'TESTED'),
    covNode(cart, fixed ? 'TESTED' : 'OBSERVED'),
    covNode(
      checkout,
      fixed ? 'TESTED' : 'BLOCKED',
      fixed
        ? []
        : [
            {
              kind: 'SELECTOR_FAILED',
              message: "'결제하기' 버튼을 찾지 못했습니다",
              selector: "getByRole('button', { name: '결제하기' })",
              specPath: CHECKOUT_SPEC,
              executionId: 42,
              at: lastRun,
              action: 'FIX_WITH_AI',
            },
          ]
    ),
    covNode(complete, fixed ? 'TESTED' : 'UNSEEN'),
    covNode(account, 'BLOCKED', [loginIssue]),
  ];
  const edges: CoverageEdge[] = [
    { from: '/', to: '/inventory', state: 'TESTED' },
    { from: '/inventory', to: '/cart', state: fixed ? 'TESTED' : 'OBSERVED' },
    { from: '/cart', to: '/checkout', state: fixed ? 'TESTED' : 'OBSERVED' },
    { from: '/checkout', to: '/complete', state: fixed ? 'TESTED' : 'FAILED' },
    { from: '/inventory', to: '/account', state: 'UNKNOWN' },
    // 아직 안 돌린 AI 흐름이 지나갈 전환. 지도에는 없다.
    { from: '/', to: '/account', state: 'UNKNOWN' },
  ];
  const count = (state: CoverageNode['state']) => coverageNodes.filter((n) => n.state === state).length;

  const siteMap: SiteMap = {
    projectId: 'mock',
    source: { url: null, branch: null, tokenSet: false, usesProjectRepository: false, siteUrl: 'https://shop.example.com' },
    analysis: {
      status: 'COMPLETED',
      commitSha: null,
      framework: 'URL',
      partial: false,
      screenCount: nodes.length,
      processedCount: nodes.length,
      llmCalls: 0,
      etaSeconds: null,
      warnings: [],
      errorMessage: null,
      startedAt: minutesAgo(70),
      finishedAt: minutesAgo(68),
    },
    nodes,
    edges: [
      { from: '/', to: '/inventory', kind: 'submit', label: '로그인', selector: null },
      { from: '/inventory', to: '/cart', kind: 'link', label: '장바구니', selector: null },
      { from: '/cart', to: '/checkout', kind: 'link', label: '주문하기', selector: null },
      // 결제 → 주문 완료는 사이트 탐색이 폼을 제출하지 않아 지도에 없다. coverage.edges 로만 안다.
      { from: '/inventory', to: '/account', kind: 'link', label: '내 정보', selector: null },
    ],
    layouts: [],
  };
  return {
    siteMap,
    coverage: {
      summary: {
        screens: nodes.length,
        tested: count('TESTED'),
        observed: count('OBSERVED'),
        unseen: count('UNSEEN'),
        blocked: count('BLOCKED'),
        flows: flows.length,
        lastRunAt: lastRun,
      },
      nodes: coverageNodes,
      edges,
      flows,
    },
  };
}

function elementsFor(node: SiteMapNode): SiteMapElement[] {
  const names = ['로그인', '아이디', '비밀번호', '장바구니 담기', '결제하기', '상품 이름', '수량', '주문하기', '이전으로', '검색'];
  const list: SiteMapElement[] = [];
  const push = (verification: SiteMapElement['verification'], n: number) => {
    for (let i = 0; i < n; i++) {
      const name = names[list.length % names.length];
      list.push({
        kind: list.length % 3 === 1 ? 'input' : 'button',
        role: null,
        name,
        text: name,
        label: null,
        placeholder: null,
        testId: null,
        selector: `getByRole('button', { name: '${name}' })`,
        selectorKind: 'role',
        duplicate: false,
        conditional: false,
        idx: list.length,
        verification,
      });
    }
  };
  push('PASSED', node.passedCount);
  push('FAILED', node.failedCount);
  push('OBSERVED', node.observedCount);
  push('UNVERIFIED', node.unverifiedCount);
  return list;
}

export function createCoverageMock(): StructureSource {
  let fixed = false;
  let running: { execution: Execution; endsAt: number } | null = null;
  const history: Execution[] = [
    execution(41, 'tests/login-browse.spec.ts', 'PASSED', minutesAgo(40)),
    execution(42, CHECKOUT_SPEC, 'FAILED', minutesAgo(18)),
  ];
  const delay = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(structuredClone(value)), 150));

  /** 돌던 실행이 끝날 때가 됐으면 결과를 지도에 반영한다. */
  const settle = () => {
    if (!running || Date.now() < running.endsAt) return;
    const done = { ...running.execution, status: 'PASSED' as const, passedTests: 1, finishedAt: new Date().toISOString() };
    if (done.specPath === CHECKOUT_SPEC) fixed = true;
    history.unshift(done);
    running = null;
  };

  return {
    getSiteMap: () => {
      settle();
      return delay(build(fixed).siteMap);
    },
    getCoverage: () => {
      settle();
      return delay(build(fixed).coverage);
    },
    getExecutions: () => {
      settle();
      return delay(running ? [running.execution, ...history] : history);
    },
    getSiteMapNode: (_projectId, routeKey) => {
      const { siteMap } = build(fixed);
      const node = siteMap.nodes.find((n) => n.routeKey === routeKey);
      if (!node) return Promise.reject(new Error('화면을 찾지 못했습니다.'));
      const detail: SiteMapNodeDetail = {
        node,
        elements: elementsFor(node),
        edges: siteMap.edges.filter((e) => e.from === routeKey || e.to === routeKey),
        forms: [],
        tests: build(fixed)
          .coverage.flows.filter((f) => f.steps.some((s) => s.routeKey === routeKey))
          .map((f) => ({
            specPath: f.specPath,
            lastStatus: f.lastStatus === 'NEVER_RUN' ? null : f.lastStatus,
            lastRunAt: f.lastRunAt,
            executionId: f.executionId,
            passedCases: f.lastStatus === 'PASSED' ? 1 : 0,
            failedCases: f.lastStatus === 'FAILED' ? 1 : 0,
          })),
      };
      return delay(detail);
    },
    runSpec: (_projectId, specPath) => {
      if (running) return Promise.reject(new Error('이미 실행 중인 테스트가 있습니다.'));
      const started = execution(100 + history.length, specPath, 'RUNNING', new Date().toISOString());
      running = { execution: started, endsAt: Date.now() + RUN_MS };
      return delay(started);
    },
  };
}
