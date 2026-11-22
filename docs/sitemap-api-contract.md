# 사이트 구조 그래프 API 계약 (P-02 초안)

| 항목 | 내용 |
|------|------|
| 상태 | **초안** — 윤재 검토 전. P-01(스키마)이 확정되면 맞춰 고친다 |
| 작성 | 2026-10-03, 준호 |
| 대상 | 웹의 "구조" 탭(4주차 C-02 ~ C-09)이 받는 JSON |
| 근거 | `apps/api/ai-runner/analyze.js`의 `result.json` (version 1), 개선사항 v2.0 4.1 · 4.2절, PRD F-09 · F-10 |

이 문서는 웹이 **무엇을 받아야 화면을 그릴 수 있는가**를 정한다. DB 테이블을 어떻게 나눌지는 P-01에서 정한다.

## 1. 설계 결정

| # | 결정 | 이유 |
|---|------|------|
| 1 | 그래프 조회와 노드 상세를 나눈다 | 화면 하나에 요소가 최대 60개다. 그래프를 그릴 때는 개수만 있으면 되고, 요소 목록은 노드를 눌렀을 때만 필요하다 |
| 2 | 분석이 없어도 `200`으로 빈 그래프를 준다 | 웹이 404와 "아직 분석 안 함"을 구분하는 코드를 따로 두지 않는다. `analysis.status`로 판단한다 |
| 3 | `edges`에는 양 끝이 모두 있는 전환만 넣는다 | React Flow 엣지는 source와 target이 모두 있어야 한다. 가 보지 못한 링크는 `unvisited`로 따로 준다 |
| 4 | 노드 `id`는 재분석해도 바뀌지 않는다 | 제외·메모가 재분석 뒤에도 남아야 한다(PRD F-10). `analyze.js`의 `n1`, `n2`는 실행마다 달라지므로 그대로 쓰지 않는다 |
| 5 | 실행 결과는 노드에 요약해서 붙인다 | 그래프에서는 색만 칠하면 된다. 어떤 케이스가 실패했는지는 노드 상세에서 준다 |
| 6 | `ariaSnapshot`은 웹에 주지 않는다 | 화면당 최대 6,000자이고 생성 프롬프트에만 쓰인다 |
| 7 | 시간은 ISO-8601 문자열, 없는 값은 `null` | 기존 `ExecutionResponse`와 같다 |
| 8 | 오류는 기존과 같이 `{ "message": "..." }` | `ApiException` 관례를 따른다 |

## 2. 엔드포인트

모두 `/api/projects/{projectId}` 아래이고 로그인 토큰이 필요하다.

| 메서드 | 경로 | 용도 | 쓰는 업무 |
|--------|------|------|-----------|
| GET | `/sitemap` | 그래프 전체 조회 (분석 상태 포함) | C-02, B-12 |
| GET | `/sitemap/nodes/{nodeId}` | 노드 상세 | C-06 |
| PATCH | `/sitemap/nodes/{nodeId}` | 제외 · 메모 편집 | C-06 |
| GET | `/sitemap/nodes/{nodeId}/screenshot` | 화면 캡처 이미지 | C-03 |
| POST | `/sitemap/analyze` | 분석 시작 · 재분석 | B-03 |
| POST | `/scenarios/from-path` | 고른 경로로 시나리오 생성 요청 | C-04 |
| POST | `/sitemap/candidates/{candidateId}/adopt` | 후보 채택 | C-09 |
| POST | `/sitemap/candidates/{candidateId}/dismiss` | 후보 숨김 | C-09 |

## 3. GET /sitemap

분석 중에도 같은 엔드포인트를 폴링한다. `analysis.status`가 `RUNNING`이면 `progress`만 채워지고 `nodes`는 이전 분석 결과(없으면 빈 배열)다.

```json
{
  "projectId": "example.com",
  "analysis": {
    "status": "COMPLETED",
    "mode": "DOM",
    "source": "SITE",
    "jobId": 41,
    "analyzedAt": "2026-10-20T05:12:44Z",
    "durationMs": 48211,
    "partial": false,
    "progress": { "pages": 12, "edges": 19 },
    "stats": {
      "pages": 12,
      "edges": 19,
      "unvisited": 3,
      "elements": 214,
      "selectorCoverage": 87.4,
      "forms": 4
    },
    "warnings": []
  },
  "nodes": [
    {
      "id": "sn_7f3a",
      "path": "/login",
      "url": "https://shop.example.com/login",
      "title": "로그인",
      "depth": 1,
      "observation": "DOM",
      "origin": "LINK",
      "elementCount": 6,
      "formCount": 1,
      "hasScreenshot": true,
      "excluded": false,
      "note": null,
      "run": {
        "status": "FAILED",
        "totalCases": 3,
        "failedCases": 1,
        "executionId": 128,
        "ranAt": "2026-10-20T06:00:03Z"
      }
    },
    {
      "id": "sn_02c1",
      "path": "/cart",
      "url": "https://shop.example.com/cart",
      "title": "장바구니",
      "depth": 2,
      "observation": "DOM",
      "origin": "LINK",
      "elementCount": 18,
      "formCount": 0,
      "hasScreenshot": true,
      "excluded": true,
      "note": "결제 연동 전이라 제외",
      "run": null
    }
  ],
  "edges": [
    {
      "id": "se_19",
      "from": "sn_7f3a",
      "to": "sn_02c1",
      "kind": "LINK",
      "label": "장바구니",
      "selector": "getByRole('link', { name: '장바구니', exact: true })",
      "precondition": null
    }
  ],
  "unvisited": [
    {
      "from": "sn_02c1",
      "url": "https://shop.example.com/orders/history",
      "label": "주문 내역",
      "reason": "DEPTH_LIMIT"
    }
  ],
  "candidates": [
    {
      "id": 5,
      "title": "로그인 후 장바구니 확인",
      "rationale": "로그인 폼과 장바구니 화면이 링크로 이어져 있습니다.",
      "nodeIds": ["sn_7f3a", "sn_02c1"],
      "status": "PROPOSED",
      "aiJobId": null
    }
  ]
}
```

분석을 한 번도 하지 않은 프로젝트는 이렇게 온다.

```json
{
  "projectId": "example.com",
  "analysis": {
    "status": "NONE",
    "mode": null,
    "source": null,
    "jobId": null,
    "analyzedAt": null,
    "durationMs": null,
    "partial": false,
    "progress": null,
    "stats": null,
    "warnings": []
  },
  "nodes": [],
  "edges": [],
  "unvisited": [],
  "candidates": []
}
```

### 값의 범위

| 필드 | 값 | 뜻 |
|------|----|----|
| `analysis.status` | `NONE` | 분석한 적 없음 |
| | `RUNNING` | 분석 중. `progress`를 본다 |
| | `COMPLETED` | 완료 |
| | `FAILED` | 실패. `warnings`에 이유 |
| `analysis.partial` | `true` | 깊이·화면 수·시간·비용 상한에 걸려 중간에 멈춤 ("부분 분석" 표시) |
| `analysis.mode` | `DOM` / `VISUAL` | 탐색 경로. `VISUAL`이면 "시각 기반" 표시 |
| `analysis.source` | `SITE` / `CODE` / `BOTH` | 화면만, 코드만, 둘 다 |
| `node.observation` | `DOM` | DOM으로 관찰함 |
| | `VISUAL` | 스크린샷으로 관찰함 |
| | `CODE_ONLY` | 코드에 라우트는 있으나 화면에 닿지 못함 (권한이 필요한 화면일 수 있음) |
| | `FAILED` | 열기 실패 ("관찰 실패" 표시) |
| `node.origin` | `ENTRY` / `LINK` / `CLICK` / `SEED` | 시작 화면, 링크로 발견, 조작으로 발견, 코드 라우트에서 투입 |
| `node.run.status` | `PASSED` / `FAILED` / `SKIPPED` | 이 화면을 지나는 케이스 중 하나라도 실패면 `FAILED`. 실행한 적 없으면 `run`이 `null` |
| `edge.kind` | `LINK` / `CLICK` / `FORM` | 링크 이동, 버튼 조작, 폼 제출 |
| `unvisited.reason` | `DEPTH_LIMIT` / `PAGE_LIMIT` / `EXCLUDED` / `OPEN_FAILED` | 가 보지 못한 이유 |
| `candidate.status` | `PROPOSED` / `ADOPTED` / `DISMISSED` | 제안됨, 채택됨, 숨김 |

## 4. GET /sitemap/nodes/{nodeId}

그래프 조회의 노드 필드를 모두 담고, 요소 · 폼 · 케이스를 더한다.

```json
{
  "id": "sn_7f3a",
  "path": "/login",
  "url": "https://shop.example.com/login",
  "title": "로그인",
  "depth": 1,
  "observation": "DOM",
  "origin": "LINK",
  "elementCount": 6,
  "formCount": 1,
  "hasScreenshot": true,
  "excluded": false,
  "note": null,
  "run": {
    "status": "FAILED",
    "totalCases": 3,
    "failedCases": 1,
    "executionId": 128,
    "ranAt": "2026-10-20T06:00:03Z"
  },
  "elements": [
    {
      "idx": 0,
      "tag": "input",
      "type": "email",
      "role": "textbox",
      "name": "이메일",
      "selector": "getByLabel('이메일', { exact: true })",
      "selectorKind": "label",
      "stability": "VERIFIED",
      "required": true,
      "formIdx": 0
    },
    {
      "idx": 3,
      "tag": "button",
      "type": "submit",
      "role": "button",
      "name": "로그인",
      "selector": "getByRole('button', { name: '로그인', exact: true })",
      "selectorKind": "role",
      "stability": "VERIFIED",
      "required": false,
      "formIdx": 0
    },
    {
      "idx": 5,
      "tag": "a",
      "type": null,
      "role": "link",
      "name": "더보기",
      "selector": "getByRole('link', { name: '더보기', exact: true }).nth(1)",
      "selectorKind": "nth",
      "stability": "FRAGILE",
      "required": false,
      "formIdx": null
    }
  ],
  "forms": [
    { "idx": 0, "fieldIdx": [0, 1], "submitIdx": [3] }
  ],
  "cases": [
    {
      "specPath": "tests/login.spec.ts",
      "caseTitle": "잘못된 비밀번호로 로그인하면 오류가 보인다",
      "status": "FAILED",
      "errorMessage": "expect(locator).toBeVisible() failed",
      "executionId": 128
    }
  ]
}
```

| 필드 | 값 | 뜻 |
|------|----|----|
| `element.stability` | `VERIFIED` | Playwright가 정확히 그 요소 하나를 찾는 것을 확인함 |
| | `FRAGILE` | 같은 이름 중 몇 번째인지로 가리킴. 화면 순서가 바뀌면 깨짐 |
| | `NONE` | 셀렉터를 만들지 못함. `selector`가 `null` |
| `element.selectorKind` | `testid` / `role` / `label` / `placeholder` / `text` / `scoped` / `css` / `nth` | `analyze.js`가 채택한 방식 그대로 |
| `forms[].fieldIdx`, `submitIdx` | `elements[].idx` 값 | 폼에 속한 입력과 제출 버튼 |

## 5. PATCH /sitemap/nodes/{nodeId}

보낸 필드만 바꾼다. 응답은 3절의 노드 한 개(상세가 아닌 요약 형태)다.

```json
{ "excluded": true, "note": "결제 연동 전이라 제외" }
```

- `note`는 최대 500자. 빈 문자열을 보내면 `null`로 저장한다.
- 이 값은 재분석으로 지워지지 않는다.

## 6. POST /sitemap/analyze

본문은 모두 선택이다. 비우면 프로젝트 설정의 상한을 쓴다.

```json
{ "maxPages": 20, "maxDepth": 3, "timeoutMs": 180000 }
```

응답은 3절의 `analysis` 객체 하나다(`status`가 `RUNNING`). 이미 분석 중이면 `409`와 `{ "message": "이미 분석이 진행 중입니다." }`.

## 7. POST /scenarios/from-path

```json
{
  "nodeIds": ["sn_7f3a", "sn_02c1"],
  "title": "로그인 후 장바구니 확인",
  "instructions": "잘못된 비밀번호 케이스도 포함"
}
```

- `nodeIds`는 지나갈 순서대로 1개 이상. `title`과 `instructions`는 선택.
- 응답은 기존 `AiJobResponse`다. 생성은 AI 작업으로 만들어지고 승인 게이트를 거친다.
- 노드가 2개 이상인데 이어지는 전환이 없으면 `400`과 `{ "message": "sn_7f3a 에서 sn_02c1 로 가는 전환이 없습니다." }`.
- 제외된 노드가 섞여 있으면 `400`.

후보 채택(`/sitemap/candidates/{id}/adopt`)은 본문 없이 호출하고, 그 후보의 `nodeIds`로 같은 일을 한다. 응답도 `AiJobResponse`다.

## 8. TypeScript 타입

웹은 이 타입을 `apps/web/src/types/sitemap.ts`에 둔다.

```ts
export type AnalysisStatus = 'NONE' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type Observation = 'DOM' | 'VISUAL' | 'CODE_ONLY' | 'FAILED';
export type CaseStatus = 'PASSED' | 'FAILED' | 'SKIPPED';

export interface SiteAnalysis {
  status: AnalysisStatus;
  mode: 'DOM' | 'VISUAL' | null;
  source: 'SITE' | 'CODE' | 'BOTH' | null;
  jobId: number | null;
  analyzedAt: string | null;
  durationMs: number | null;
  partial: boolean;
  progress: { pages: number; edges: number } | null;
  stats: {
    pages: number;
    edges: number;
    unvisited: number;
    elements: number;
    selectorCoverage: number;
    forms: number;
  } | null;
  warnings: string[];
}

export interface SiteNodeRun {
  status: CaseStatus;
  totalCases: number;
  failedCases: number;
  executionId: number;
  ranAt: string;
}

export interface SiteNode {
  id: string;
  path: string;
  url: string;
  title: string;
  depth: number;
  observation: Observation;
  origin: 'ENTRY' | 'LINK' | 'CLICK' | 'SEED';
  elementCount: number;
  formCount: number;
  hasScreenshot: boolean;
  excluded: boolean;
  note: string | null;
  run: SiteNodeRun | null;
}

export interface SiteEdge {
  id: string;
  from: string;
  to: string;
  kind: 'LINK' | 'CLICK' | 'FORM';
  label: string;
  selector: string | null;
  precondition: string | null;
}

export interface UnvisitedLink {
  from: string;
  url: string;
  label: string;
  reason: 'DEPTH_LIMIT' | 'PAGE_LIMIT' | 'EXCLUDED' | 'OPEN_FAILED';
}

export interface ScenarioCandidate {
  id: number;
  title: string;
  rationale: string;
  nodeIds: string[];
  status: 'PROPOSED' | 'ADOPTED' | 'DISMISSED';
  aiJobId: number | null;
}

export interface SiteMapResponse {
  projectId: string;
  analysis: SiteAnalysis;
  nodes: SiteNode[];
  edges: SiteEdge[];
  unvisited: UnvisitedLink[];
  candidates: ScenarioCandidate[];
}

export interface SiteElement {
  idx: number;
  tag: string;
  type: string | null;
  role: string | null;
  name: string;
  selector: string | null;
  selectorKind: 'testid' | 'role' | 'label' | 'placeholder' | 'text' | 'scoped' | 'css' | 'nth' | null;
  stability: 'VERIFIED' | 'FRAGILE' | 'NONE';
  required: boolean;
  formIdx: number | null;
}

export interface SiteNodeCase {
  specPath: string;
  caseTitle: string;
  status: CaseStatus;
  errorMessage: string | null;
  executionId: number;
}

export interface SiteNodeDetail extends SiteNode {
  elements: SiteElement[];
  forms: { idx: number; fieldIdx: number[]; submitIdx: number[] }[];
  cases: SiteNodeCase[];
}
```

## 9. result.json과의 대응

`analyze.js`가 이미 내는 값과 이 계약의 관계다. P-01에서 스키마를 잡을 때 참고한다.

| 계약 필드 | result.json | 비고 |
|-----------|-------------|------|
| `analysis.mode` | `mode` | `VISUAL_REQUIRED`는 저장하지 않는다. 시각 경로가 돌면 `VISUAL`, 아직 못 돌았으면 분석 `FAILED` + 경고 |
| `analysis.durationMs` | `durationMs` | |
| `analysis.analyzedAt` | `startedAt` + `durationMs` | |
| `analysis.partial` | `warnings`에 상한 문구가 있는지 | **러너가 `partial: true`를 직접 내도록 고치는 편이 낫다** |
| `analysis.stats.*` | `stats.pages` · `edges` · `edgesToUnvisited` · `elements` · `selectorCoverage` · `forms` | |
| `node.id` | 없음 | 서버가 부여. `nodes[].id`(`n1`)는 실행마다 바뀜 |
| `node.path` · `url` · `title` · `depth` | 같은 이름 | |
| `node.origin` | `depth === 0`이면 `ENTRY`, `seed`면 `SEED`, 아니면 `LINK` | `CLICK`은 3주차 B-06에서 추가 |
| `node.observation` | `mode` | `CODE_ONLY`, `FAILED`는 서버가 판정 |
| `node.elementCount` | `elements.length` | `interactiveCount`가 아니다 (보이는 요소만, 최대 60개) |
| `node.formCount` | `forms.length` | |
| `node.hasScreenshot` | `screenshot` 파일이 있는지 | |
| `element.name` | `name` | `nameAlt`, `scope`, `label`, `placeholder`, `text`, `testId`, `id`는 셀렉터를 만드는 재료라 웹에 주지 않는다 |
| `element.stability` | `unique && !fragile` → `VERIFIED`, `fragile` → `FRAGILE`, 그 외 `NONE` | |
| `element.formIdx` | `inForm` | |
| `edge.from` · `to` | `edges[].from` · `to` | 서버 노드 id로 바꿔서 |
| `edge.kind` | `kind` (`link`) | 대문자로 |
| `edge.label` · `selector` | 같은 이름 | |
| `unvisited[]` | `edges[]` 중 `visited: false` | `reason`은 **지금 러너가 내지 않는다.** `stats.skipped`에 개수만 있다 |
| `candidates[]` | 없음 | 3주차 B-09에서 생성 |
| `node.run`, `cases[]` | 없음 | 4주차 C-05에서 실행 결과와 연결 |

## 10. 윤재에게 확인할 것

P-01을 정할 때 함께 결정해야 이 계약이 확정된다.

1. **노드 동일성.** 재분석했을 때 "같은 화면"을 무엇으로 판단하는가. 정규화한 `path`(쿼리 포함)를 쓰면 단순하지만, `/products/1`과 `/products/2`가 각각 노드가 된다. 경로 패턴으로 묶을지 여부.
2. **실행 결과와 노드의 연결.** `ExecutionCaseResult`에는 `specPath`와 `caseTitle`만 있다. 경로에서 만든 시나리오라면 생성할 때 `nodeIds`를 spec과 함께 저장하면 되지만, 사람이 직접 쓴 spec은 연결할 근거가 없다. 그런 케이스는 그래프에 칠하지 않는 것으로 시작해도 되는가.
3. **스크린샷 인증.** `<img>`는 `Authorization` 헤더를 붙이지 못한다. 기존 HTML 리포트와 아티팩트가 어떻게 인증하는지 확인하고 같은 방식을 쓴다.
4. **분석 이력.** 이전 분석 결과를 보관하는가, 최신 한 벌만 두는가. 이 계약은 최신 한 벌만 가정한다.
5. **러너 출력 보강.** `partial`과 가 보지 못한 이유(`reason`)를 러너가 직접 내도록 `result.json`을 version 2로 올릴지, 서버가 추정할지.
6. **id 형식.** 노드는 문자열(`sn_...`), 후보는 숫자로 적었다. DB 키를 그대로 내보낼지 별도 공개 id를 둘지에 따라 바뀐다. 웹은 문자열이기만 하면 된다.
