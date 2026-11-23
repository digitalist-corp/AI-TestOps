# 채팅 A2UI 계약 (질문 화면)

AI 채팅에서 AI가 사용자에게 **고르게 하거나 짧게 입력받아야 할 때** 글로 되묻는 대신 작은 화면을 띄운다.
예: 실패한 테스트 중 다시 돌릴 것 고르기, 시나리오 만들 화면 · 범위 고르기, 실행 전 조건 확인.
첫 실행 브리핑(`onboarding-briefing-contract.md`)과 같은 렌더러(`@a2ui/react`)를 쓰되, **A2UI 기본 카탈로그는 쓰지 않고 우리 카탈로그만** 쓴다.

화면 틀을 서버가 고정하는 브리핑과 달리, 여기서는 **LLM 이 우리 카탈로그 부품을 조합**하고 서버가 엄격히 검사한다.
기존 채팅 계약(`ai-chat-agent-contract.md`)의 SSE 이벤트는 바꾸지 않는다 — 도구 결과 표시(display)에 `a2ui` 종류를 하나 더한다.

## 카탈로그 `https://playops.dev/a2ui/catalogs/chat/v1`

컴포넌트 id 는 A2UI 규칙상 식별자만(`^[A-Za-z_][A-Za-z0-9_]*$`, 하이픈 금지). 정확히 하나가 `root`.
`{"@path": "/x"}` 는 dataModel 의 JSON Pointer.

| component | 속성 | 화면 |
|---|---|---|
| `Column` | `children: string[]` | 세로 배치 |
| `Section` | `title: string`, `children: string[]` | 제목 있는 카드 |
| `Text` | `text: string \| {"@path"}`, `variant?: "body" \| "muted"` | 문단 |
| `Notice` | `text: string \| {"@path"}`, `tone: "info" \| "success" \| "warning" \| "danger"` | 아이콘 + 색 배경 한 줄 |
| `CheckList` | `items: {id,title,detail?,badge?}[] \| {"@path"}`, `value: {"@path"}` → `string[]` | 여러 개 고르기 |
| `ChoiceList` | `items: {id,title,detail?,badge?}[] \| {"@path"}`, `value: {"@path"}` → `string` | 하나 고르기(라디오) |
| `TextInput` | `label: string`, `value: {"@path"}` → `string`, `placeholder?: string`, `multiline?: boolean` | 짧은 입력. **비밀 값 금지** |
| `Button` | `label: string`, `variant?: "primary" \| "outline"`, `action: { event: { name: "submit" \| "cancel", context: { … } } }` | 누르면 action 메시지 |

- `Column` · `Section` · `Text` · `Notice` · `CheckList` · `Button` 은 브리핑 카탈로그(`onboarding/v1`)와 **같은 구현**을 쓴다. 웹은 부품 구현을 한곳에 두고 두 카탈로그가 나눠 쓴다.
- `context` 안의 `{"@path"}` 는 누른 순간의 값으로 풀려서 나간다(A2UI 규칙).

## 도구 `ask_user` (tier READ, 허락 불필요)

입력:
```json
{
  "question": "다시 돌릴 테스트를 골라 주세요",
  "components": [
    { "id": "root", "component": "Column", "children": ["intro", "pick", "buttons"] },
    { "id": "intro", "component": "Text", "text": "어제 실패한 테스트 3개예요.", "variant": "muted" },
    { "id": "pick", "component": "CheckList", "items": { "@path": "/items" }, "value": { "@path": "/selected" } },
    { "id": "buttons", "component": "Column", "children": ["ok"] },
    { "id": "ok", "component": "Button", "label": "다시 실행", "variant": "primary",
      "action": { "event": { "name": "submit", "context": { "selected": { "@path": "/selected" } } } } }
  ],
  "data": { "items": [{ "id": "login", "title": "로그인 후 이름이 보인다", "badge": "실패" }], "selected": ["login"] }
}
```

서버 검사(어기면 `ChatToolOutput.failed` 로 이유를 돌려줘 모델이 고쳐 다시 부르게 한다):
- 컴포넌트 40개 이하, id 규칙 · 중복 없음, `root` 하나, children 이 가리키는 id 가 모두 있고 한 번씩만 쓰이며 모두 root 에서 닿는다.
- component 이름은 위 표의 8개만. 필수 속성이 있어야 하고 타입이 맞아야 한다. 문자열 500자, 목록 항목 30개 이하.
- `Button.action.event.name` 은 `submit` · `cancel` 만, `submit` 버튼이 하나 이상.
- `@path` 는 `/` 로 시작. `data` 는 JSON 으로 8KB 이하.
- `TextInput` 의 label · placeholder 에 비밀번호 · password · token · 토큰 · secret · 시크릿 · api key 가 들어가면 거절("비밀 값은 set_env_variables 로 받으세요").

성공하면:
- `surfaceId` = `chat-{messageId}-{callId}` (surfaceId 는 식별자 규칙 대상 아님), `catalogId` = 위 chat/v1.
- display: `kind: "a2ui"`, `data: { surfaceId, question, messages: [createSurface{surfaceId, catalogId, dataModel: data}, updateComponents{surfaceId, components}] }` — 모든 메시지에 `"version": "1.0"`.
- summary: question. 모델에게 가는 content(= 이후 대화 기록의 output): `사용자에게 질문 화면을 보여 줬습니다: {question}. 답은 다음 사용자 메시지로 옵니다.`
- **이 턴은 바로 끝낸다.** 같은 턴의 다른 도구 호출은 마저 실행하되 모델을 다시 부르지 않고 `stopReason=END`. (질문을 띄워 놓고 AI 가 혼자 계속 진행하지 않게)

## 답 보내기 (`POST /api/ai/chat/sessions/{id}/messages` 확장)

요청 본문 `SendMessageRequest` 에 선택 필드 `uiAction` 을 더한다:
```json
{ "content": "고른 항목: 로그인 후 이름이 보인다", "userLevel": "…",
  "uiAction": { "messageId": 123, "surfaceId": "chat-123-call_1", "name": "submit", "context": { "selected": ["login"] } } }
```
- `content` 는 웹이 라벨로 만든 사람이 읽는 요약(사용자 말풍선에 그대로 보임). 비어 있으면 서버가 "응답을 보냈어요"로 채운다.
- 서버 검사: messageId 가 이 세션의 **가장 최근 assistant 메시지**이고, 그 안에 `display.kind=a2ui` 이고 `data.surfaceId` 가 같은 tool 블록이 있고, 아직 `answer` 가 없어야 한다. name 은 submit · cancel. context 는 JSON 4KB 이하. 어기면 400(답변 스트림 시작 전).
- 통과하면 그 블록의 `display.data.answer = { name, context, summary: content, answeredAt }` 로 저장하고, 평소처럼 새 답변을 시작한다.
- 모델에게 가는 이번 사용자 메시지:
  ```
  [질문 화면 응답] 질문: {question}
  동작: {name}
  값: {context JSON}
  사용자 표시: {content}
  ```
  cancel 이면 "사용자가 질문을 취소했습니다." 로 시작한다. 대화 기록(DB)의 사용자 메시지 text 는 `content` 만 저장한다(화면용). 다음 질문 때 모델이 보는 기록도 같은 형식이 되도록 `ChatHistory` 를 맞춘다(사용자 블록에 응답 메타를 남기든, 저장 텍스트를 위 형식으로 하든 단순한 쪽).

## 웹 표시

- `display.kind === 'a2ui'` 인 tool 블록은 접힌 도구 카드가 아니라 **질문 카드**로 펼쳐 보인다(제목 = question).
- 가장 최근 assistant 메시지의 답 안 한 질문만 조작 가능. 답한 질문은 고른 값이 보이는 채로 잠기고 "보낸 답: {summary}" 를 붙인다. 지나간(답 안 한 옛) 질문은 잠그고 "지나간 질문이에요" 표시.
- 버튼을 누르면 `context` 와 라벨로 `content` 요약을 만들어 위 요청으로 보낸다(답변 스트림 중에는 막는다).
- 렌더러가 메시지를 거부하면 질문 카드 자리에 "질문 화면을 보여 주지 못했어요." 만 보이고 대화는 계속된다.
