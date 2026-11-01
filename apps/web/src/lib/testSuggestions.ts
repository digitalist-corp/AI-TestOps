import type { SiteMap, SiteMapNode } from '@/types';

/** AI 테스트 생성 화면의 추천 문장 하나. 누르면 문장과 참고할 화면(routeKeys)이 함께 채워진다. */
export type TestSuggestion = { text: string; routeKeys: string[] };

/** 추천 문장은 많아야 이만큼만 보여 준다. */
export const MAX_SUGGESTIONS = 6;
/** 화면 전환 문장은 많아야 이만큼만 섞는다. */
const MAX_TRANSITIONS = 2;

/** 화면 정보가 없을 때(저장소 미연결 · 분석 전)도 쓸 수 있는 기본 추천. */
export const DEFAULT_SUGGESTIONS: TestSuggestion[] = [
  { text: '첫 화면이 열리고 페이지 제목이 보이는지 확인', routeKeys: [] },
  { text: '첫 화면을 여는 동안 브라우저 콘솔에 오류가 없는지 확인', routeKeys: [] },
  { text: '첫 화면의 주요 링크를 눌렀을 때 깨진 페이지(404)가 없는지 확인', routeKeys: [] },
];

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 사용자가 경로를 신경 쓰지 않도록 생성할 spec 파일 경로를 자동으로 정한다.
 * 로컬 시각 기준 `tests/ai/generated-YYYYMMDD-HHmmss.spec.ts`.
 */
export function autoSpecPath(now: Date): string {
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return `tests/ai/generated-${date}-${time}.spec.ts`;
}

/** 문장 안에서 화면을 부르는 이름. 예: "로그인 화면(/login)", 제목이 없으면 "/login 화면". */
function screenLabel(node: SiteMapNode): string {
  const name = node.title?.trim() || node.routeKey;
  return name === node.routeKey ? `${name} 화면` : `${name} 화면(${node.routeKey})`;
}

function isLoginRoute(routeKey: string): boolean {
  const key = routeKey.toLowerCase();
  return key.includes('login') || key.includes('signin') || key.includes('sign-in');
}

/**
 * 구조 분석 결과로 추천 문장을 만든다.
 * - 제외했거나(excluded) 코드에서 사라진(stale) 화면은 빼고, 요소가 많은 화면부터 고른다.
 * - 로그인 화면에는 잘못된 비밀번호 문장을, 화면 사이 전환이 있으면 이동 문장을 1~2개 섞는다.
 * - 쓸 화면이 없으면 기본 추천을 돌려준다.
 */
export function buildSuggestions(siteMap: SiteMap | null): TestSuggestion[] {
  const candidates = (siteMap?.nodes ?? [])
    .filter((node) => !node.excluded && !node.stale)
    // sort 는 같은 값이면 원래 순서를 지킨다
    .sort((a, b) => b.elementCount - a.elementCount);
  if (candidates.length === 0) return DEFAULT_SUGGESTIONS.map((s) => ({ ...s, routeKeys: [] }));

  const byRoute = new Map(candidates.map((node) => [node.routeKey, node]));

  // 화면 사이 전환: 두 화면 모두 후보에 있고, 같은 화면끼리가 아닌 것. 요소가 많은 쌍부터.
  const seenPairs = new Set<string>();
  const transitions: { from: SiteMapNode; to: SiteMapNode }[] = [];
  for (const edge of siteMap?.edges ?? []) {
    const from = byRoute.get(edge.from);
    const to = byRoute.get(edge.to);
    if (!from || !to || from === to) continue;
    const key = `${from.routeKey}\u0000${to.routeKey}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    transitions.push({ from, to });
  }
  transitions.sort((a, b) => b.from.elementCount + b.to.elementCount - (a.from.elementCount + a.to.elementCount));
  const transitionItems: TestSuggestion[] = transitions.slice(0, MAX_TRANSITIONS).map(({ from, to }) => ({
    text: `${screenLabel(from)}에서 ${screenLabel(to)}으로 이동되는지 확인`,
    routeKeys: [from.routeKey, to.routeKey],
  }));

  const loginNode = candidates.find((node) => isLoginRoute(node.routeKey));
  const loginItem: TestSuggestion | null = loginNode
    ? {
        text: `${screenLabel(loginNode)}에서 잘못된 비밀번호를 넣으면 오류 메시지가 보이는지 확인`,
        routeKeys: [loginNode.routeKey],
      }
    : null;

  // 화면 하나씩 확인하는 문장이 기본이고, 남는 자리에 로그인 · 전환 문장을 넣는다.
  const screenSlots = Math.max(1, MAX_SUGGESTIONS - transitionItems.length - (loginItem ? 1 : 0));
  const result: TestSuggestion[] = candidates.slice(0, screenSlots).map((node) => ({
    text: `${screenLabel(node)}이 열리고 주요 입력란과 버튼이 보이는지 확인`,
    routeKeys: [node.routeKey],
  }));

  if (loginItem) {
    // 로그인 화면 문장 바로 뒤에 둔다. 목록에 없으면 맨 뒤에.
    const at = result.findIndex((s) => s.routeKeys[0] === loginNode?.routeKey);
    result.splice(at === -1 ? result.length : at + 1, 0, loginItem);
  }
  // 전환 문장은 한데 몰지 않고 사이사이에 섞는다.
  transitionItems.forEach((item, i) => {
    result.splice(Math.min(result.length, 2 + i * 3), 0, item);
  });

  return result.slice(0, MAX_SUGGESTIONS);
}
