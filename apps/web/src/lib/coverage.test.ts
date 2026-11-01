import { describe, expect, it } from 'vitest';
import { layoutGraph, mergeEdges } from '@/components/project/structure/layoutGraph';
import { createCoverageMock } from './coverageMock';
import type { Coverage, CoverageFlow, CoverageIssue, CoverageSummary, Execution, SiteMapNode } from '@/types';
import {
  NODE_STATE_META,
  diffNodeStates,
  elementRatioText,
  fallbackNodeState,
  finishedExecutions,
  flowForExecution,
  issueActions,
  issueItems,
  playbackFrame,
  playbackPlan,
  progressSegments,
  recorderLink,
  resolveCoverage,
  shouldPoll,
  summarySentence,
  summaryText,
  timeAgo,
  withCoverageEdges,
} from './coverage';

function summary(patch: Partial<CoverageSummary>): CoverageSummary {
  return { screens: 0, tested: 0, observed: 0, unseen: 0, blocked: 0, flows: 0, lastRunAt: null, ...patch };
}

function screen(routeKey: string, patch: Partial<SiteMapNode> = {}): SiteMapNode {
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
    observedCount: 0,
    unverifiedCount: 0,
    ...patch,
  };
}

function flow(patch: Partial<CoverageFlow>): CoverageFlow {
  return {
    specPath: 'tests/a.spec.ts',
    title: '흐름',
    source: 'RECORDED',
    lastStatus: 'PASSED',
    lastRunAt: null,
    executionId: null,
    steps: [],
    ...patch,
  };
}

describe('상태 → 이름 · 색', () => {
  it('네 상태 모두 쉬운 이름과 한 줄 설명이 있고 "미확인"은 쓰지 않는다', () => {
    expect(NODE_STATE_META.TESTED).toMatchObject({ label: '테스트 통과', bar: 'bg-success' });
    expect(NODE_STATE_META.OBSERVED).toMatchObject({ label: '화면에서 확인됨', bar: 'bg-info' });
    expect(NODE_STATE_META.UNSEEN.label).toBe('아직 안 봄');
    expect(NODE_STATE_META.BLOCKED).toMatchObject({ label: '막힘', bar: 'bg-destructive' });
    for (const meta of Object.values(NODE_STATE_META)) {
      expect(meta.hint.length).toBeGreaterThan(0);
      expect(meta.label).not.toContain('미확인');
    }
  });

  it('화면 상자 비율 문장', () => {
    expect(elementRatioText({ passed: 3, failed: 0, observed: 5, unseen: 12, total: 20 })).toBe('요소 20개 중 3개 통과');
    expect(elementRatioText({ passed: 0, failed: 0, observed: 4, unseen: 6, total: 10 })).toBe('요소 10개 중 4개 확인');
    expect(elementRatioText({ passed: 0, failed: 0, observed: 0, unseen: 6, total: 6 })).toBe('요소 6개 · 아직 안 봄');
    expect(elementRatioText({ passed: 2, failed: 1, observed: 0, unseen: 0, total: 3 })).toBe('요소 3개 중 2개 통과 · 1개 실패');
    expect(elementRatioText({ passed: 0, failed: 0, observed: 0, unseen: 0, total: 0 })).toBe('찾은 요소 없음');
  });
});

describe('시각', () => {
  it('지난 시간을 쉬운 말로', () => {
    const now = new Date('2026-11-01T12:00:00Z').getTime();
    expect(timeAgo(null, now)).toBe('');
    expect(timeAgo('2026-11-01T11:59:40Z', now)).toBe('방금 전');
    expect(timeAgo('2026-11-01T11:42:00Z', now)).toBe('18분 전');
    expect(timeAgo('2026-11-01T09:00:00Z', now)).toBe('3시간 전');
    expect(timeAgo('2026-10-30T12:00:00Z', now)).toBe('2일 전');
  });
});

describe('요약 문장', () => {
  it('확인한 화면 수와 막힌 곳 수를 한 문장으로', () => {
    expect(summarySentence(summary({ screens: 12, tested: 8, blocked: 2, flows: 3 }))).toBe(
      '화면 12개 중 8개를 테스트로 확인했어요. 2곳에서 막혔어요.'
    );
  });

  it('막힌 곳이 없으면 막힘 문장을 빼고, 모두 확인했으면 그렇게 말한다', () => {
    expect(summarySentence(summary({ screens: 4, tested: 2, observed: 2, flows: 1 }))).toBe('화면 4개 중 2개를 테스트로 확인했어요.');
    expect(summarySentence(summary({ screens: 3, tested: 3, flows: 1 }))).toBe('화면 3개를 모두 테스트로 확인했어요.');
  });

  it('테스트가 없으면 다음 할 일로 첫 테스트를 권한다', () => {
    const text = summaryText(summary({ screens: 5, observed: 2, unseen: 3 }));
    expect(text.headline).toBe('화면 5개를 찾았어요. 아직 테스트로 확인한 화면은 없어요.');
    expect(text.blocked).toBeNull();
    expect(text.next).toContain('첫 테스트');
  });

  it('화면이 없을 때', () => {
    expect(summaryText(summary({})).headline).toBe('아직 지도에 화면이 없어요.');
  });

  it('4칸 막대는 통과 · 확인됨 · 안 봄 · 막힘 순이고 합이 100', () => {
    const segs = progressSegments(summary({ screens: 10, tested: 5, observed: 2, unseen: 2, blocked: 1 }));
    expect(segs.map((s) => s.state)).toEqual(['TESTED', 'OBSERVED', 'UNSEEN', 'BLOCKED']);
    expect(segs.map((s) => s.count)).toEqual([5, 2, 2, 1]);
    expect(segs.reduce((sum, s) => sum + s.percent, 0)).toBeCloseTo(100);
    expect(progressSegments(summary({})).every((s) => s.percent === 0)).toBe(true);
  });
});

describe('서버 응답이 없을 때의 상태', () => {
  it('실패 → 막힘, 통과 → 테스트 통과, 실제로 봄 → 화면에서 확인됨, 그 밖 → 아직 안 봄', () => {
    expect(fallbackNodeState({ failedCount: 1, passedCount: 3, origin: 'CODE' })).toBe('BLOCKED');
    expect(fallbackNodeState({ failedCount: 0, passedCount: 1, origin: 'CODE' })).toBe('TESTED');
    expect(fallbackNodeState({ failedCount: 0, passedCount: 0, observedCount: 2, origin: 'CODE' })).toBe('OBSERVED');
    expect(fallbackNodeState({ failedCount: 0, passedCount: 0, origin: 'SITE' })).toBe('OBSERVED');
    expect(fallbackNodeState({ failedCount: 0, passedCount: 0, origin: 'CODE' })).toBe('UNSEEN');
  });

  it('응답이 없으면 지도 숫자로 요약을 만들고 제외한 화면은 세지 않는다', () => {
    const cov = resolveCoverage(
      {
        nodes: [
          screen('/a', { passedCount: 2, elementCount: 2 }),
          screen('/b', { failedCount: 1, elementCount: 3 }),
          screen('/c'),
          screen('/d', { excluded: true }),
        ],
        edges: [],
      },
      null
    );
    expect(cov.summary).toMatchObject({ screens: 3, tested: 1, blocked: 1, unseen: 1 });
    expect(cov.nodes.map((n) => n.state)).toEqual(['TESTED', 'BLOCKED', 'UNSEEN', 'UNSEEN']);
    expect(cov.nodes[1].counts).toEqual({ passed: 0, failed: 1, observed: 0, unseen: 2, total: 3 });
  });

  it('응답에 빠진 화면만 지도 숫자로 채우고 요약을 다시 센다', () => {
    const server: Coverage = {
      summary: summary({ screens: 1, tested: 1, flows: 1, lastRunAt: '2026-10-01T00:00:00Z' }),
      nodes: [{ routeKey: '/a', state: 'TESTED', counts: { passed: 1, failed: 0, observed: 0, unseen: 0, total: 1 }, issues: [] }],
      edges: [],
      flows: [flow({})],
    };
    const cov = resolveCoverage({ nodes: [screen('/a'), screen('/new', { origin: 'SITE' })], edges: [] }, server);
    expect(cov.nodes.map((n) => n.state)).toEqual(['TESTED', 'OBSERVED']);
    expect(cov.summary).toMatchObject({ screens: 2, tested: 1, observed: 1, flows: 1, lastRunAt: '2026-10-01T00:00:00Z' });
    // 빠진 화면이 없으면 서버 요약을 그대로 쓴다
    expect(resolveCoverage({ nodes: [screen('/a')], edges: [] }, server).summary).toBe(server.summary);
  });
});

describe('막힌 곳', () => {
  const issue = (patch: Partial<CoverageIssue>): CoverageIssue => ({ kind: 'SELECTOR_FAILED', message: 'x', action: 'NONE', ...patch });

  it('로그인 문제를 맨 위에, 같은 종류는 지도 순서대로', () => {
    const cov = resolveCoverage({ nodes: [screen('/a'), screen('/b', { title: '결제' })], edges: [] }, {
      summary: summary({}),
      nodes: [
        { routeKey: '/a', state: 'BLOCKED', counts: { passed: 0, failed: 1, observed: 0, unseen: 0, total: 1 }, issues: [issue({ message: 'a' })] },
        { routeKey: '/b', state: 'BLOCKED', counts: { passed: 0, failed: 0, observed: 0, unseen: 0, total: 0 }, issues: [issue({ kind: 'LOGIN_REQUIRED', message: 'b' })] },
      ],
      edges: [],
      flows: [],
    });
    const items = issueItems(cov, new Map([['/b', screen('/b', { title: '결제' })]]));
    expect(items.map((i) => [i.name, i.issue.message])).toEqual([['결제', 'b'], ['/a', 'a']]);
  });

  it('AI 로 고치기는 AI 가 켜져 있고 실패 실행을 알 때만, 아니면 다시 녹화하기', () => {
    const fix = issue({ action: 'FIX_WITH_AI', executionId: 7, specPath: 'tests/a.spec.ts' });
    expect(issueActions(fix, true)).toEqual(['FIX_WITH_AI', 'RERUN']);
    expect(issueActions(fix, false)).toEqual(['RECORD_AGAIN', 'RERUN']);
    expect(issueActions(issue({ action: 'FIX_WITH_AI' }), true)).toEqual(['RECORD_AGAIN']);
  });

  it('다시 실행은 테스트를 알 때만, 행동 없음은 버튼 없음', () => {
    expect(issueActions(issue({ kind: 'OPEN_FAILED', action: 'RERUN' }), true)).toEqual([]);
    expect(issueActions(issue({ kind: 'LOGIN_REQUIRED', action: 'SET_LOGIN' }), true)).toEqual(['SET_LOGIN']);
    expect(issueActions(issue({ kind: 'EXPLORE_STOPPED', action: 'NONE' }), true)).toEqual([]);
  });

  it('다시 녹화하기는 그 화면의 실제 주소, 없으면 화면 경로로 녹화 탭을 연다', () => {
    expect(recorderLink('p1', '/cart', { url: 'https://shop.test/cart.html' })).toBe(
      '/projects/p1/recorder?url=https%3A%2F%2Fshop.test%2Fcart.html'
    );
    expect(recorderLink('p1', '/cart')).toBe('/projects/p1/recorder?url=%2Fcart');
  });
});

describe('흐름 재생 순서', () => {
  const failing = flow({
    lastStatus: 'FAILED',
    steps: [
      { routeKey: '/login', state: 'PASSED' },
      { routeKey: '/items', state: 'PASSED' },
      { routeKey: '/checkout', state: 'FAILED', message: "'결제하기' 버튼을 찾지 못했습니다" },
      { routeKey: '/done', state: 'NOT_REACHED' },
    ],
  });

  it('막힌 단계에서 멈추고 그 뒤는 켜지 않는다', () => {
    const plan = playbackPlan(failing);
    expect(plan.steps.map((s) => s.routeKey)).toEqual(['/login', '/items', '/checkout']);
    expect(plan.stopAt).toBe(2);
    expect(plan.message).toBe("'결제하기' 버튼을 찾지 못했습니다");
    expect(plan.tone).toBe('fail');
  });

  it('한 박자마다 한 단계씩 켜지고, 끝나면 막힌 이유 말풍선을 띄운다', () => {
    const plan = playbackPlan(failing);
    expect(playbackFrame(plan, 0)).toEqual({ lit: 0, done: false, showBubble: false });
    expect(playbackFrame(plan, 2)).toEqual({ lit: 2, done: false, showBubble: false });
    expect(playbackFrame(plan, 3)).toEqual({ lit: 3, done: true, showBubble: true });
    expect(playbackFrame(plan, 99).lit).toBe(3);
  });

  it('통과한 흐름은 모든 단계를 켜고 말풍선이 없다', () => {
    const plan = playbackPlan(flow({ steps: [{ routeKey: '/a', state: 'PASSED' }, { routeKey: '/b', state: 'PASSED' }] }));
    expect(plan).toMatchObject({ stopAt: null, message: null, tone: 'pass' });
    expect(playbackFrame(plan, 2)).toEqual({ lit: 2, done: true, showBubble: false });
  });

  it('막힌 단계를 모르는 실패는 이유 없이 모든 단계를 켠다, 안 돌린 흐름은 미리 보기', () => {
    const msgless = playbackPlan(flow({ lastStatus: 'FAILED', steps: [{ routeKey: '/a', state: 'FAILED' }] }));
    expect(msgless.message).toBe('테스트가 이 화면에서 멈췄어요');
    const pending = playbackPlan(flow({ lastStatus: 'NEVER_RUN', steps: [{ routeKey: '/a', state: 'PENDING' }, { routeKey: '/b', state: 'PENDING' }] }));
    expect(pending).toMatchObject({ tone: 'pending', stopAt: null });
    expect(pending.steps).toHaveLength(2);
  });
});

describe('다시 읽기(폴링)', () => {
  it('실행 중인 실행이 있거나 탐색 중이면 다시 읽는다', () => {
    expect(shouldPoll({ analysisRunning: false, executions: [{ status: 'PASSED' }, { status: 'FAILED' }] })).toBe(false);
    expect(shouldPoll({ analysisRunning: false, executions: [{ status: 'RUNNING' }] })).toBe(true);
    expect(shouldPoll({ analysisRunning: false, executions: [{ status: 'PENDING' }] })).toBe(true);
    expect(shouldPoll({ analysisRunning: true, executions: [] })).toBe(true);
  });

  it('돌던 실행이 끝나면 그 실행과 흐름을 찾는다', () => {
    type Run = Pick<Execution, 'id' | 'status' | 'specPath'>;
    const prev: Run[] = [{ id: 1, status: 'RUNNING', specPath: 'tests/b.spec.ts' }, { id: 2, status: 'PASSED', specPath: null }];
    const next: Run[] = [{ id: 1, status: 'FAILED', specPath: 'tests/b.spec.ts' }, { id: 2, status: 'PASSED', specPath: null }];
    const done = finishedExecutions(prev, next);
    expect(done.map((e) => e.id)).toEqual([1]);
    const flows = [flow({ specPath: 'tests/a.spec.ts', executionId: 1 }), flow({ specPath: 'tests/b.spec.ts' })];
    expect(flowForExecution(flows, done[0])?.specPath).toBe('tests/a.spec.ts');
    expect(flowForExecution([flows[1]], done[0])?.specPath).toBe('tests/b.spec.ts');
    expect(flowForExecution([], done[0])).toBeNull();
  });

  it('새로 나타난 화면과 상태가 바뀐 화면을 가른다', () => {
    const prev = new Map([['/a', 'UNSEEN' as const], ['/b', 'OBSERVED' as const]]);
    const next = new Map([['/a', 'TESTED' as const], ['/b', 'OBSERVED' as const], ['/c', 'UNSEEN' as const]]);
    expect(diffNodeStates(prev, next)).toEqual({ appeared: ['/c'], changed: ['/a'] });
    expect(diffNodeStates(null, next)).toEqual({ appeared: [], changed: [] });
  });
});

describe('coverage 에만 있는 전환', () => {
  const siteMap = {
    nodes: [screen('/'), screen('/items'), screen('/cart'), screen('/done')],
    edges: [{ from: '/', to: '/items', kind: 'link', label: '상품', selector: null }],
  };

  it('지도에 없는 전환을 더하고, 이미 있는 전환 · 자기 자신 · 지도에 없는 화면은 빼고, 중복은 한 번만', () => {
    const edges = withCoverageEdges(siteMap, [
      { from: '/', to: '/items' },
      { from: '/items', to: '/cart' },
      { from: '/items', to: '/cart' },
      { from: '/cart', to: '/cart' },
      { from: '/cart', to: '/gone' },
    ]);
    expect(edges.map((e) => `${e.from}->${e.to}`)).toEqual(['/->/items', '/items->/cart']);
    expect(edges[1]).toMatchObject({ kind: 'flow', label: null, selector: null });
  });

  it('더할 것이 없으면 지도 전환을 그대로 돌려준다', () => {
    expect(withCoverageEdges(siteMap, [{ from: '/', to: '/items' }])).toBe(siteMap.edges);
  });

  it('더한 전환이 배치(dagre)에 들어가 흐름 순서대로 왼쪽 → 오른쪽에 놓인다', () => {
    const merged = { ...siteMap, edges: withCoverageEdges(siteMap, [{ from: '/items', to: '/cart' }, { from: '/cart', to: '/done' }]) };
    const { positions, edges } = layoutGraph(merged);
    expect(edges.map((e) => e.id)).toEqual(['e:/->/items', 'e:/items->/cart', 'e:/cart->/done']);
    expect(positions['/items'].x).toBeLessThan(positions['/cart'].x);
    expect(positions['/cart'].x).toBeLessThan(positions['/done'].x);
  });

  it('가짜 확인 지도: 지도에 없는 결제 → 주문 완료 전환도 그려져, 흐름의 모든 단계 사이에 선이 있다', async () => {
    const source = createCoverageMock();
    const map = await source.getSiteMap('p1');
    const cov = await source.getCoverage('p1');
    expect(map.edges.some((e) => e.from === '/checkout' && e.to === '/complete')).toBe(false);
    const ids = new Set(mergeEdges({ nodes: map.nodes, edges: withCoverageEdges(map, cov.edges) }).map((e) => e.id));
    for (const f of cov.flows) {
      for (let i = 1; i < f.steps.length; i++) {
        expect(ids.has(`e:${f.steps[i - 1].routeKey}->${f.steps[i].routeKey}`), f.title).toBe(true);
      }
    }
  });
});
