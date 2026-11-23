# 첫 실행 브리핑 계약 (A2UI 시범 적용)

프로젝트 등록 직후 첫 테스트 생성(`AiBootstrapService`)이 끝나면, 비전공자가 "AI가 무엇을 봤고, 무엇을 확인했고, 다음에 뭘 하면 되는지"를 알 수 있게 브리핑을 보여 준다.
브리핑은 [A2UI v1.0](https://a2ui.org/specification/v1.0-a2ui/) 메시지로 내려 주고 웹은 `@a2ui/react` 로 그린다.

- 화면 틀은 서버 코드가 고정으로 만든다. LLM 은 **내용(쉬운 말 설명 · 추천 계획)만** JSON 으로 만든다. 비전공자에게 매번 다른 배치를 보여 주지 않기 위해서다.
- 진행 상태처럼 메모리에만 둔다(`AiBootstrapService.State`, 6시간). 서버가 다시 뜨면 사라진다 — 시범 범위.

## 상태 응답 (`GET /api/projects/{projectId}/ai/bootstrap/{bootstrapId}`)

`AiBootstrapResponse` 에 두 필드를 더한다.

| 필드 | 값 |
|---|---|
| `briefingStatus` | `null`(아직 시작 안 함 · 브리핑 자료 없이 ERROR 로 끝남) · `PENDING`(정리 중) · `READY` · `FAILED` |
| `briefing` | `READY` 일 때 A2UI v1.0 메시지 배열. 그 밖에는 `[]` |

- phase 가 `PASSED` · `FAILED` 로 끝나면 `briefingStatus=PENDING` 으로 두고 브리핑을 만든다.
- phase 가 `ERROR` 로 끝나도 화면 지도에 화면이 있거나 이번 생성에서 테스트 파일을 저장했다면 기본 브리핑을 만든다. 종료 상태와 `READY` 를 같은 잠금에서 공개한다. 두 자료가 모두 없으면 `briefingStatus` 는 `null` 이다.
- 웹은 phase 가 끝났어도 `briefingStatus === 'PENDING'` 이면 계속 읽는다.

### 오류 브리핑

- LLM 호출 없이 화면 지도와 저장된 테스트 제목을 사용한다. 화면이 있으면 기존 요약인 “화면 N개를 살펴봤어요.”를 쓰고 추천 항목은 비워 둔다.
- `resultNotice` 는 `danger` 다. 원문 오류의 `401` · `Unauthorized` · `API 키` · `api key` 는 관리자 설정의 AI 키 확인을, `Docker Runner` · `러너` 는 프로젝트 설정의 실행 방식 확인을 안내한다. 그 밖의 오류는 관리자에게 오류 내용을 알려 달라고 안내한다. 원문은 대화상자의 오류 문구에만 표시한다.
- 테스트 후보가 있으면 같은 `add_to_plan` 동작으로 계획에 넣는다. 후보가 없으면 `plan` 의 children 은 `[planHint]` 이고 `checkList` · `addButton` 은 보내지 않는다. 안내 문구는 “지금은 계획에 넣을 항목이 없어요. 문제를 해결한 뒤 AI 테스트 생성을 다시 해 보세요.”다.

## A2UI 메시지

- `surfaceId`: `onboarding-{bootstrapId}`
- `catalogId`: `https://playops.dev/a2ui/catalogs/onboarding/v1` (아래 우리 카탈로그. 기본 카탈로그는 쓰지 않는다)
- 순서: `createSurface`(dataModel 포함) → `updateComponents`. 모든 메시지에 `"version": "1.0"`.

### 카탈로그 `onboarding/v1`

| component | 속성 | 화면 |
|---|---|---|
| `Column` | `children: string[]` | 세로 배치 (간격 있음) |
| `Section` | `title: string`, `children: string[]` | 제목 있는 카드 |
| `Text` | `text: string \| {"@path"}`, `variant?: "body" \| "muted"` | 문단 |
| `Notice` | `text: string \| {"@path"}`, `tone: "info" \| "success" \| "warning" \| "danger"` | 아이콘 + 색 배경 한 줄 |
| `ScreenList` | `items: {"@path"}` → `{ title, path, note? }[]` | 살펴본 화면 목록 |
| `CheckList` | `items: {"@path"}` → `{ id, title, detail?, badge? }[]`, `value: {"@path"}` → `string[]` (고른 id, 양방향) | 체크 목록 |
| `Button` | `label: string`, `variant?: "primary" \| "outline"`, `action: { event: { name, context } }` | 버튼. 누르면 `action` 메시지를 보낸다 |

`context` 안의 `{"@path": "/selected"}` 는 누른 순간의 데이터 값으로 바꿔 보낸다(A2UI 규칙).

### 고정 배치

```
root: Column [intro, result, plan]
intro:  Section "AI가 이 사이트를 살펴봤어요"   [summaryText, screenList, caution_0..n (Notice warning)]
result: Section "첫 테스트 결과"                 [resultNotice (Notice success|danger)]
plan:   Section "계획에 넣을 항목을 골라 주세요" [planHint (Text muted), checkList, addButton]
```

추가가 끝나면 `plan` 의 children 을 `[planDone]` (Notice success, "N건을 계획에 넣었어요. 계획 탭에서 볼 수 있어요.") 으로 바꾼다.

### dataModel

```json
{
  "summary": "화면 5개를 살펴봤어요. 로그인 화면과 상품 목록이 있는 쇼핑몰이에요.",
  "resultNote": "AI가 만든 테스트 3개가 모두 통과했어요.",
  "screens": [{ "title": "첫 화면", "path": "/", "note": "검색창과 메뉴가 있어요" }],
  "candidates": [
    { "id": "test-0", "title": "로그인하면 내 이름이 보인다", "detail": "아이디와 비밀번호를 넣고 들어가서 이름이 뜨는지 확인했어요", "badge": "이미 만든 테스트" },
    { "id": "suggest-0", "title": "상품을 장바구니에 담을 수 있다", "detail": "구매 흐름의 첫 단계라 가장 자주 깨지는 곳이에요", "badge": "추천 · 높음" }
  ],
  "selected": ["test-0", "suggest-0"],
  "doneCount": 0
}
```

- `test-*` 는 첫 테스트 파일에 실제로 있는 테스트(제목은 파일의 `test('…')` 제목 그대로). 기본으로 모두 고른다.
- `suggest-*` 는 LLM 추천(최대 5개). 우선순위 `높음` 인 것만 기본으로 고른다.

## 버튼 동작 (`POST /api/projects/{projectId}/ai/bootstrap/{bootstrapId}/briefing/action`)

요청 본문은 A2UI 렌더러가 보내는 `action` 메시지 그대로:

```json
{ "version": "1.0", "action": { "name": "add_to_plan", "surfaceId": "onboarding-…", "sourceComponentId": "addButton",
  "timestamp": "…", "context": { "selected": ["test-0", "suggest-0"] } } }
```

- 받는 `name` 은 `add_to_plan` 하나. 다른 이름 · 다른 surfaceId 는 400.
- 서버는 **자기가 저장한 후보 목록에서 id 로만** 찾는다. 클라이언트가 보낸 제목 · 글은 쓰지 않는다. 모르는 id 는 무시한다.
- `test-*` → 같은 제목의 계획 행을 만든다(제목이 같으면 `PlanService.autoLink` 가 그 테스트에 잇는다). `suggest-*` → 미작성 계획 행을 만든다(`screenRouteKey`, `priority`, `expected` = detail).
- 권한은 `POST /api/projects/{projectId}/plan/entries/bulk` 와 같다.
- 두 번 눌러도 한 번만 반영한다(이미 추가했으면 지금 브리핑을 그대로 돌려준다).
- 응답은 갱신된 `AiBootstrapResponse` (브리핑의 plan 섹션이 planDone 으로 바뀐 것).

## LLM 이 만드는 내용 (서버 내부)

한 번 호출(`LlmGatewayService.chat`), JSON 만 받는다.

```json
{ "summary": "…", "screens": [{ "routeKey": "…", "note": "…" }], "tests": [{ "title": "<주어진 제목 그대로>", "plain": "…" }],
  "resultNote": "…", "cautions": ["…"], "suggestions": [{ "title": "…", "screenRouteKey": "…", "priority": "높음|보통|낮음", "why": "…" }] }
```

- 비전공자용 한국어. spec · 셀렉터 · 크롤링 · DOM · assertion 같은 말 금지. "~했어요" 체, 항목당 한 문장.
- `tests[].title` 은 서버가 넘긴 제목 중 하나여야 하고, 아니면 버린다. `screenRouteKey` 는 화면 목록에 있어야 하고, 아니면 null.
- LLM 호출 · 파싱이 실패하면 LLM 없이 만든 기본 브리핑(화면 제목 목록, 테스트 제목 그대로, 추천 없음)으로 `READY` 를 낸다. 예상 못 한 예외만 `FAILED`.
