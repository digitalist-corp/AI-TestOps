# E-02 MCP 어댑터 (짧은 설계)

2026-11-18 밤. 근거: `docs/langgraph-placement-decision.md` E-02 넘김 사항, 인수인계 2-3 순서 2. 완료 기준: **ai-service 가 MCP 로 `list_executions` 를 불러 결과를 받음** (11/19 정오, 안 되면 3안 전환 판단).

## 정해진 것 (결정 문서)

- 도구 정의는 Spring 한 곳(`ChatToolRegistry`). ai-service 는 `tools/list` 로 받는다 (`langchain-mcp-adapters` `MultiServerMCPClient`, streamable HTTP)
- 인증은 작업 전용 토큰 `ai_jobs.callback_token` (`AiJobService.validateCallbackToken`)
- 허용 목록 도구만, 파일 쓰는 도구 금지. 반영은 `applyDiff` 한 곳
- SDK 가 막히면 `initialize` · `tools/list` · `tools/call` 만 받는 무상태 JSON-RPC 컨트롤러

## 접근

| 안 | 판정 |
|---|---|
| MCP Java SDK 코어 + 서블릿 transport | 보류. Boot 3.3(Jackson 2)과 맞는 SDK 버전을 찾고 서블릿을 등록하는 데 시간이 든다(결정 문서 경고) |
| **무상태 JSON-RPC 컨트롤러** | **채택**(내 결정). 의존성 0, 100줄 안팎, 결정 문서가 허용한 대안. 나중에 SDK 로 바꿔도 도구 계층은 그대로 |

## 설계

- 주소 `POST /internal/ai-jobs/{jobId}/mcp` — 기존 콜백(`/internal/ai-jobs/{jobId}/llm`)과 같은 줄. 사용자 인터셉터 밖, 요청마다 `validateCallbackToken`
- JSON-RPC 2.0: `initialize`(클라이언트가 보낸 protocolVersion 을 그대로 돌려줌, capabilities `{tools:{}}`), `tools/list`, `tools/call`(결과 `content:[{type:text}]`, `isError`), 알림(id 없음) → 202 빈 응답, 모르는 메서드 → -32601. `GET` · `DELETE` → 405(무상태)
- 허용 목록(내 결정): **`list_executions`, `get_sitemap`** — 둘 다 READ, projectId 로만 범위가 정해지는 도구. 실행 번호를 받는 도구(`get_execution_detail` 등)는 다른 프로젝트 실행을 볼 수 있어(#158) 소속 확인을 붙여 E-04 에서 추가
- 작업 범위 고정: 도구 맥락은 그 작업의 프로젝트(`ChatToolContext(job.projectId, job.requestedBy, admin=false, null)`). `projectId` 인자가 다른 프로젝트면 거절
- ai-service: `ai_service/mcp_smoke.py` — `MCP_URL` · `MCP_TOKEN` 으로 `tools/list` 후 `list_executions` 호출, 결과 출력

## 확인

- Spring 통합 테스트: 토큰 없음/틀림/만료 401, initialize · tools/list(허용 목록만) · tools/call 결과, 다른 프로젝트 projectId 거절, 허용 밖 도구 거절, 파일 쓰는 도구가 목록에 없음
- 실측: 로컬 dev 에서 작업 토큰 하나로 ai-service 컨테이너가 `list_executions` 결과를 받음
