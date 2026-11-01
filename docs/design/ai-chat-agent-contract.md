# AI 채팅 에이전트 — 서버 · 화면 계약 (P1)

AI 채팅을 Claude Code 처럼 바꾸는 1단계의 **고정 계약**이다. 서버(`apps/api`)와 화면(`apps/web`)은 이 문서만 보고 따로 만든다.
바꿔야 하면 이 문서를 먼저 고친다.

## 원칙
- 파일을 직접 고치는 도구는 없다. 변경은 AI 작업(AiJob)을 만들어 사람 승인(NEEDS_REVIEW)을 거친다.
- 도구 권한 3단계(`com.playops.api.chat.ToolTier`): `READ` 바로 실행 · `RUN` 사용자 허락 후 실행 · `CHANGE` 승인 대기 작업만 만듦(허락 묻지 않음).
- 답변은 SSE 로 실시간 전송한다. 모델 글은 글자 단위(`text_delta`)로 흐른다.
- 대화는 서버 DB 에 세션으로 저장된다.

## 인증 · 전송
- 모든 요청은 기존과 같이 `Authorization: Bearer <token>` 헤더. 그래서 브라우저 `EventSource` 는 못 쓰고, **`fetch` 의 POST 응답 본문(ReadableStream)을 SSE 로 읽는다.**
- SSE 형식: `event: <type>\ndata: <JSON 한 줄>\n\n`. 15초마다 `: ping\n\n` 주석 줄(무시).

## REST
| 메서드 · 경로 | 요청 | 응답 |
|---|---|---|
| `POST /api/ai/chat/sessions` | `{ projectId?: string }` | `ChatSession` |
| `GET /api/ai/chat/sessions?projectId=` | — | `ChatSession[]` (내 세션, 최근 수정순 30개. projectId 없으면 프로젝트 없는 세션) |
| `GET /api/ai/chat/sessions/{id}` | — | `{ session: ChatSession, messages: ChatMessage[] }` |
| `DELETE /api/ai/chat/sessions/{id}` | — | 204 |
| `POST /api/ai/chat/sessions/{id}/messages` | `{ content: string, userLevel?: 'NON_DEVELOPER'\|'JUNIOR'\|'SENIOR' }` | **`text/event-stream`** — 이번 답변 하나가 끝날 때까지 이벤트를 흘리고 닫는다 |
| `POST /api/ai/chat/sessions/{id}/permissions/{requestId}` | `{ decision: 'ALLOW'\|'ALLOW_SESSION'\|'DENY' }` | 204 |
| `POST /api/ai/chat/sessions/{id}/cancel` | — | 204 (진행 중인 답변을 멈춘다. 스트림은 `message_end{stopReason:'CANCELLED'}` 로 닫힘) |

- 남의 세션에 접근하면 404. 한 세션에서 답변이 진행 중일 때 또 `messages` 를 보내면 409.
- 기존 `POST /api/ai/chat`(한 번에 답) 은 AI 분석 탭이 쓰므로 그대로 둔다.

```ts
type ChatSession = { id: number; projectId: string | null; title: string; createdAt: string; updatedAt: string };

type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  createdAt: string;
  blocks: ChatBlock[];          // user 는 text 블록 하나
  stopReason?: StopReason;      // assistant 만
};

type ChatBlock =
  | { type: 'text'; text: string }
  | { type: 'tool'; callId: string; name: string; tier: 'READ' | 'RUN' | 'CHANGE'; input: Record<string, unknown>;
      status: 'running' | 'ok' | 'error' | 'denied' | 'cancelled'; summary?: string; output?: string;
      display?: ToolDisplay; durationMs?: number;
      permission?: { requestId: string; reason: string; decision?: 'ALLOW' | 'ALLOW_SESSION' | 'DENY' } };

type StopReason = 'END' | 'CANCELLED' | 'MAX_TURNS' | 'ERROR';
```
제목(`title`)은 첫 사용자 메시지 앞 40자로 서버가 정한다.

## SSE 이벤트 (`POST .../messages` 응답)
순서: `message_start` → (`text_delta` | `tool_start` → [`permission_request` → `permission_resolved`] → `tool_end`)* → [`usage`] → `message_end`

| event | data |
|---|---|
| `message_start` | `{ userMessageId, messageId }` — 저장된 사용자 메시지 id 와 이번 assistant 메시지 id |
| `text_delta` | `{ delta: string }` — 모델 글 조각. 이어 붙이면 현재 text 블록. 도구 호출 뒤에 오는 글은 새 text 블록 |
| `tool_start` | `{ callId, name, tier, input }` |
| `permission_request` | `{ requestId, callId, name, input, reason }` — RUN 도구. 사용자 응답 전까지 루프가 멈춘다(최대 5분, 넘으면 DENY 처리) |
| `permission_resolved` | `{ requestId, decision }` |
| `tool_end` | `{ callId, status: 'ok'\|'error'\|'denied'\|'cancelled', summary?, output?, display?, durationMs }` — output 은 화면용으로 최대 4000자 |
| `usage` | `{ inputTokens, outputTokens }` — 이번 답변 합계 |
| `error` | `{ message }` — 치명적 오류. 곧 `message_end{ERROR}` |
| `message_end` | `{ messageId, stopReason }` |

`ALLOW_SESSION` 으로 허락한 도구 이름은 그 세션 동안 다시 묻지 않는다(바로 `tool_start` → `tool_end`).

## display (도구 결과 표시 힌트, `com.playops.api.chat.ToolDisplay`)
| kind | data | 화면 |
|---|---|---|
| `table` | `{ columns: string[], rows: (string\|number\|boolean\|null)[][], truncated: boolean, sql?: string }` | 표. sql 이 있으면 위에 쿼리 원문 |
| `code` | `{ path?: string, language?: string, content: string }` | 코드 블록 |
| `job` | `{ jobId: number, jobType: string, status: string, specPath?: string }` | 기존 AI 작업 카드(AiActionCard) — 관리자는 채팅 안에서 diff 보고 승인 |
| `execution` | `{ executionId: number, status: string, projectId: string }` | 실행 카드 + 실행 탭으로 이동 링크 |
| `list` | `{ items: { label: string, detail?: string }[] }` | 짧은 목록 |
| 없음 | — | output 을 접힌 텍스트로 |

## 도구 목록 (P1)
| 이름 | tier | 담당 |
|---|---|---|
| `list_files`, `read_file`, `list_executions`, `get_execution_detail`, `get_sitemap`, `get_job_status` | READ | 기존 도구를 ChatTool 로 옮김 |
| `fix_test`, `generate_scenario` | CHANGE | 기존 도구 옮김 (display=job) |
| `propose_test_run` | — | 없앰. `run_tests` 로 대체 |
| `sql_query` | READ | 신규 — 아래 "SQL 안전" |
| `grep_files` | READ | 신규 — 프로젝트 파일에서 정규식/문자열 검색 (최대 100줄) |
| `search_logs` | READ | 신규 — 실행 로그에서 검색 (executionId 지정 또는 최근 N개) |
| `get_case_history` | READ | 신규 — 케이스 이름으로 최근 실행 결과 이력 |
| `run_tests` | RUN | 신규 — spec 경로/케이스 grep 으로 실행 시작 (display=execution) |
| `set_env_variables` | RUN | 프로젝트 환경변수 저장 (허락 필요, 비밀 값은 화면 · DB 에서 가림) |

## SQL 안전 (`sql_query`)
- 별도 스키마 `ai_ro` 에 **안전한 열만 고른 뷰**를 만들고, NOLOGIN 역할 `ai_readonly` 에 `USAGE ON SCHEMA ai_ro` + 뷰 `SELECT` 만 준다.
  뷰 대상: projects, executions, execution_case_results, test_suites, execution_schedules, ai_jobs, ai_usage, site_node, site_edge, notifications.
  비밀(비밀번호 해시 · 저장소/Slack 토큰 · AI 키 · 세션 토큰 · 암호화 값)과 users/user_sessions/ai_provider_settings/slack_settings 는 뷰에 넣지 않는다.
- 실행: 한 트랜잭션 안에서 `SET TRANSACTION READ ONLY` → `SET LOCAL ROLE ai_readonly` → `SET LOCAL statement_timeout = '5s'` → `SET LOCAL app.project_id = ?` · `app.is_admin` → **PreparedStatement 한 문장**(여러 문장 불가), `setMaxRows(201)` 로 200행 + 잘림 표시. 끝나면 롤백.
- 뷰는 `project_id = current_setting('app.project_id', true) OR current_setting('app.is_admin', true) = 'true'` 로 거른다. AI 가 쿼리 안에서 설정을 바꾸지 못하게 `set_config` 실행권을 `ai_readonly` 에서 막는다(PUBLIC 회수 후 앱 계정에만 부여).
- `SELECT`/`WITH` 로 시작하지 않으면 실행 전에 거절. 도구 설명에 `ai_ro` 뷰 목록과 열 이름을 넣어 모델이 스키마를 추측하지 않게 한다.
