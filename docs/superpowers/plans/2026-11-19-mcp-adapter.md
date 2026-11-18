# E-02 MCP 어댑터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ai-service 가 작업 토큰으로 Spring `/internal/ai-jobs/{jobId}/mcp` 에 붙어 `list_executions` 결과를 받는다.

**Architecture:** Spring 에 무상태 JSON-RPC 컨트롤러 하나(`McpController`)가 `ChatToolRegistry` 의 허용 목록 도구를 MCP 로 내보낸다. ai-service 는 `langchain-mcp-adapters` 로 그 주소에 붙는 스모크 스크립트를 가진다.

**Tech Stack:** Spring Boot 3.3 / Java 21 (Jackson 2), Python langchain-mcp-adapters 0.3.2 · mcp 2.3.0

**Spec:** `docs/superpowers/specs/2026-11-19-mcp-adapter-design.md`

## Global Constraints

- 새 Java 의존성 없음. 주소 `POST /internal/ai-jobs/{jobId}/mcp`, `GET`/`DELETE` 405
- 인증은 `Authorization: Bearer <callback_token>` → `AiJobService.validateCallbackToken(jobId, token)` (401)
- 허용 목록 `Set.of("list_executions", "get_sitemap")`. 목록 밖 도구는 `tools/list` 에 없고 `tools/call` 은 JSON-RPC 오류 -32602
- 도구 맥락 `new ChatToolContext(job.getProjectId(), job.getRequestedBy(), false, null)`, 인자 `projectId` 가 작업 프로젝트와 다르면 `isError: true`
- 파일 반영 경로는 `applyDiff` 하나 그대로 (`ApprovalGateInventoryTest` 통과)

## Review Focus

1. 만료된 토큰 → 401 (Task 1 테스트)
2. 다른 작업의 토큰으로 이 작업 주소 호출 → 401 (Task 1 테스트)
3. `tools/call` 에 `arguments` 없음 → 빈 맵으로 처리, 오류 없이 작업 프로젝트 기준 (Task 1 테스트)
4. id 없는 알림(`notifications/initialized`) → 202 빈 본문 (Task 1 테스트)
5. 허용 목록 도구가 RUN/CHANGE 로 바뀌면 → 컨트롤러가 READ 가 아니면 내보내지 않음 (Task 1 테스트: 목록의 모든 도구가 READ)

---

### Task 1: Spring MCP 컨트롤러

**Files:** Create `apps/api/src/main/java/com/playops/api/controller/McpController.java`; Test `apps/api/src/test/java/com/playops/api/config/McpIntegrationTest.java` (RolePermissionIntegrationTest 와 같은 H2 설정, `AiJobRepository` 로 토큰 있는 작업을 직접 저장)

**Interfaces:**
- Produces: `POST /internal/ai-jobs/{jobId}/mcp` JSON-RPC 2.0. `McpController.ALLOWED: Set<String>`

- [ ] **Step 1: 실패 테스트**
  - `rejectsMissingWrongOrExpiredToken`: 토큰 없음 · 틀림 · 다른 작업 토큰 · 만료 → 401
  - `initializeEchoesProtocolVersion`: `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18",...}}` → `result.protocolVersion == "2025-06-18"`, `result.capabilities.tools` 존재, `result.serverInfo.name == "ai-testops"`
  - `notificationGets202`: `notifications/initialized`(id 없음) → 202, 본문 비어 있음
  - `listsOnlyAllowedReadTools`: 이름 집합 == `{"list_executions","get_sitemap"}`, 각 `inputSchema.type == "object"`, `fix_test` · `read_file` · `run_tests` 없음
  - `callsListExecutionsForTheJobsProject`: example.com 작업으로 `tools/call list_executions`(arguments 생략) → `result.isError == false`, `content[0].type == "text"`
  - `rejectsOtherProjectAndUnlistedTools`: `projectId: "google.com"` → `isError == true`; `name: "fix_test"` → `error.code == -32602`; 모르는 메서드 → `error.code == -32601`
  - `getAndDeleteAre405`
- [ ] **Step 2: 실패 확인 → Step 3: 구현** — `ChatToolRegistry` 에서 ALLOWED ∩ tier READ 만, 결과 `{"content":[{"type":"text","text": output.content()}], "isError": output.error()}`, 도구 예외는 `isError: true` 와 메시지
- [ ] **Step 4: API 전체 테스트 통과 (ApprovalGateInventoryTest 포함) → Step 5: 커밋** `feat: 작업 토큰으로 허용 목록 조회 도구를 MCP 로 내보냄 (E-02)`

### Task 2: ai-service MCP 스모크

**Files:** Modify `apps/ai-service/requirements.txt`(`langchain-mcp-adapters==0.3.2`), Create `apps/ai-service/ai_service/mcp_smoke.py`

**Interfaces:**
- Produces: `async def call_tool(url: str, token: str, name: str, args: dict) -> str` — `MultiServerMCPClient({"playops": {"transport": "streamable_http", "url": url, "headers": {"Authorization": f"Bearer {token}"}}})`, `get_tools()` 에서 이름으로 찾아 `ainvoke(args)`; `python -m ai_service.mcp_smoke` 는 `MCP_URL` · `MCP_TOKEN` 으로 도구 목록과 `list_executions` 결과 앞부분을 출력

- [ ] **Step 1:** 이미지 재빌드, 로컬 dev 에서 api 를 띄우고 example.com 의 AI 작업 하나에 토큰 · 만료를 넣는다(psql, 로컬 DB 만)
- [ ] **Step 2: 실측(실패 먼저)** — 스크립트 없이 `python -m ai_service.mcp_smoke` → ModuleNotFoundError
- [ ] **Step 3: 구현 → Step 4: ai-service 컨테이너에서 `MCP_URL=http://api:8080/internal/ai-jobs/<id>/mcp` 로 실행 → 도구 2개 · `list_executions` 결과 출력.** 틀린 토큰이면 401 로 실패하는 것도 확인
- [ ] **Step 5: 커밋** `feat: ai-service 가 MCP 로 Spring 도구 list_executions 를 부름 (E-02 스모크)`
