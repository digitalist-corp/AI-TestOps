# 구조 탭 "확인 지도" — 서버 · 화면 계약

구조 탭을 **어디까지 확인됐고 어디서 막혔는지** 한눈에 보이는 지도로 바꾼다. 대상은 비개발자도 포함.
기존 `GET /api/projects/{id}/sitemap`(화면 · 전환 · 레이아웃)은 그대로 두고, 확인 상태를 모은 **coverage** 를 새로 둔다.

## 요소 확인 상태 (3단계 + 실패)
요소(`site_node.elements[].verification`) 값은 그대로 쓰고, 화면에 보일 이름을 정한다.

| 값 | 화면 이름 | 뜻 |
|---|---|---|
| `PASSED` | 테스트 통과 | 이 셀렉터를 쓴 테스트가 실행돼 통과 |
| `FAILED` | 실패 | 테스트가 이 셀렉터에서 실패 |
| `OBSERVED` | 화면에서 확인됨 | 사이트 탐색 · 녹화로 실제 화면에서 정확히 하나를 가리키는 걸 봄 (테스트는 아직) |
| `UNVERIFIED` | 아직 안 봄 | 코드 분석으로만 찾음 |

**녹화도 반영한다**: 녹화 테스트를 저장할 때 `scenario_origin` 에 그 spec 이 지나간 화면(routeKeys, 순서대로)과 쓴 셀렉터(selectorKeys)를 기록한다. 그래야 실행 결과가 지도에 반영되고, 녹화 중 클릭한 요소가 지도에 없으면 그 화면에 `OBSERVED` 요소로 더한다(화면이 지도에 없으면 화면도 더한다, origin=`RECORDED`).

## `GET /api/projects/{projectId}/sitemap/coverage`
```ts
type Coverage = {
  summary: {
    screens: number;          // 지도에 있는 화면 수 (excluded 제외)
    tested: number;           // 테스트가 지나가 통과한 화면 수 (화면 상태 TESTED)
    observed: number;         // 테스트 전이지만 실제 화면에서 본 화면 수
    unseen: number;           // 코드로만 아는 화면 수
    blocked: number;          // 막힌 화면 수 (화면 상태 BLOCKED)
    flows: number;            // 테스트 흐름 수
    lastRunAt: string | null; // 지도에 반영된 마지막 실행 시각
  };
  nodes: CoverageNode[];
  edges: CoverageEdge[];
  flows: CoverageFlow[];
};

type CoverageNode = {
  routeKey: string;
  state: 'TESTED' | 'OBSERVED' | 'UNSEEN' | 'BLOCKED';
  counts: { passed: number; failed: number; observed: number; unseen: number; total: number };
  issues: CoverageIssue[];    // 비어 있으면 막힌 곳 없음
};

type CoverageIssue = {
  kind: 'SELECTOR_FAILED' | 'LOGIN_REQUIRED' | 'OPEN_FAILED' | 'NOT_REACHED' | 'EXPLORE_STOPPED';
  message: string;            // 비개발자용 한국어 한 줄. 예: "'결제하기' 버튼을 찾지 못했습니다"
  selector?: string | null;   // SELECTOR_FAILED 일 때
  specPath?: string | null;   // 이 문제를 낸 테스트
  executionId?: number | null;
  at?: string | null;
  action: 'SET_LOGIN' | 'RECORD_AGAIN' | 'FIX_WITH_AI' | 'RERUN' | 'NONE'; // 화면이 보여줄 추천 행동
};

type CoverageEdge = {
  from: string; to: string;
  state: 'TESTED' | 'OBSERVED' | 'FAILED' | 'UNKNOWN';  // TESTED: 통과한 흐름이 지나감, FAILED: 이 전환에서 흐름이 막힘
};

type CoverageFlow = {
  specPath: string;
  title: string;                       // 테스트 이름(첫 test 제목) 또는 파일 이름
  source: 'RECORDED' | 'GENERATED' | 'PATH' | 'OTHER';
  lastStatus: 'PASSED' | 'FAILED' | 'NEVER_RUN';
  lastRunAt: string | null;
  executionId: number | null;
  steps: { routeKey: string; state: 'PASSED' | 'FAILED' | 'NOT_REACHED' | 'PENDING'; message?: string | null }[];
};
```

### 판정 규칙
- 화면 상태: issues 에 `SELECTOR_FAILED` · `LOGIN_REQUIRED` · `OPEN_FAILED` · `EXPLORE_STOPPED` 가 있으면 `BLOCKED` → 아니면 통과한 흐름이 그 화면을 지났으면 `TESTED` → 아니면 OBSERVED 요소가 하나라도 있거나 origin 이 URL/RECORDED 면 `OBSERVED` → 그 밖 `UNSEEN`.
- 흐름의 단계: origin 의 routeKeys 순서. 마지막 실행이 통과면 모두 `PASSED`. 실패면 실패 메시지의 셀렉터가 속한 화면이 `FAILED`, 그 앞은 `PASSED`, 뒤는 `NOT_REACHED`. 셀렉터로 화면을 못 찾으면 마지막 단계를 `FAILED`. 한 번도 안 돌렸으면 모두 `PENDING`.
- 막힌 원인: 실패 흐름의 FAILED 단계 → `SELECTOR_FAILED`(셀렉터를 알면, action `FIX_WITH_AI` 또는 `RECORD_AGAIN`) · 마지막 사이트 탐색 경고(로그인 화면에서 멈춤 → `LOGIN_REQUIRED`, action `SET_LOGIN` / 열기 실패 → `OPEN_FAILED`) · `auth_required` 화면인데 프로젝트 환경변수에 LOGIN_ID 가 없으면 `LOGIN_REQUIRED`.
- 메시지는 Playwright 오류를 그대로 쓰지 말고 쉬운 말로: 타임아웃+셀렉터 → "'<이름>' <역할>을(를) 찾지 못했습니다", expect 실패 → "'<이름>'이(가) 기대와 다릅니다", 그 밖 → "테스트가 이 화면에서 멈췄습니다".
- `SiteMapNode` 에 `observedCount` 를 더하고, `unverifiedCount` 는 OBSERVED 를 빼고 센다(기존 화면 호환: passed+failed+observed+unverified = elementCount).

## 실시간 (P1 은 폴링)
- 화면은 실행 중인 실행(실행 목록의 RUNNING)이 있으면 5초마다 coverage 를 다시 읽는다. 실행이 끝나면 한 번 더 읽고 "방금 결과" 애니메이션을 재생한다.
- 사이트 탐색 중(analysis.status RUNNING)에도 sitemap 과 coverage 를 5초마다 다시 읽어 화면이 하나씩 나타나게 한다.
