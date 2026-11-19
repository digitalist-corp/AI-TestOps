# 학습 루프 E-06 · E-07 · E-09 (+ E-10/E-11 간이) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 실패 실행 하나로 "분류 → 과거 수정 참고 → 격리 수정 → 승인 대기 → 승인 → 재실행 측정 → 계속/정지" 루프를 LangGraph(ai-service)로 돌린다.

**Architecture:** Spring 이 루프 작업(`LEARNING_LOOP` AiJob)을 만들고 ai-service `POST /loops` 를 부른다. 그래프는 MCP 로 실패 묶음을 읽고(`list_failure_clusters`), 과거 수정을 예시로 넣은 지시문으로 `start_code_fix`(MCP)를 불러 **기존 CODE_FIX 러너**(격리 사본에서 고치고 다시 돌려 통과해야만 diff 를 냄)를 자식 작업으로 띄운 뒤 `interrupt()` 로 멈춘다. 자식 작업이 바뀌면(`AiJobChanged`) Spring 이 `POST /loops/{id}/resume` 으로 상태를 넘겨 재개한다. 반영은 기존 승인 카드 → `AiJobService.approve` → `applyDiff` 그대로, 재실행은 기존 사후 검증 실행이다.

**Tech Stack:** Spring Boot 3.3 · Flyway V23 · LangGraph 1.2 + AsyncPostgresSaver · FastAPI · React 19

**Spec:** `docs/handoff/2026-11-18-LangGraph-개선-인수인계.md` 2-3 표 6 ~ 9행 · 2-4, 준호 계획 [2] 4 ~ 7 · 금요일 완료 기준

## 짧은 설계 (준호 계획이 설계를 정함)

- **격리 재검증은 새로 만들지 않는다.** 기존 러너가 이미 사본에서 고치고 다시 돌려 `targetCaseFixed=false` 면 REJECTED 로 끝낸다 → "재검증 실패 수정안은 사람에게 안 감"이 이미 성립. 그래프는 지시문에 과거 수정을 넣는 일만 한다.
- **모든 기다림은 interrupt.** 수정 대기 · 승인 대기 둘 다 체크포인트에 남아 ai-service 가 재시작돼도 Spring 의 다음 재개로 이어진다(E-07). 폴링 없음.
- **자식 작업은 `autoCreated=true`** → `canAutoApply` 가 항상 false → 사람 승인 필수. 승인 경로 · `ApprovalGateInventoryTest` 그대로.
- **정지 조건(E-09):** 최대 3바퀴 · 예산(자식 러너 반복 합 15회 = LLM 호출 상한) · 진전 없음 2번 연속 · 사람 거부 · 고칠 수 없는 원인(환경 · 제품 결함).
- **진전 = 재실행 실패 건수 감소.** 0건이면 성공.
- **E-10/E-11 간이:** 노드마다 한 줄 기록을 응답으로 돌려 루프 작업 `summary` 에 쌓는다. 별도 표 · 화면 없음(AI 검토 탭 · 결과 탭 패널이 보여 줌).
- 루프 작업 상태: 진행 중 RUNNING, 성공 APPLIED, 정지 FAILED, 사람 거부 CANCELED. 자식 승인 대기는 자식 카드가 NEEDS_REVIEW.

## Global Constraints

- ai-service 는 compose 프로필 `ai` 에서만. `AI_SERVICE_URL` 이 비었거나 응답이 없으면 버튼 숨김 + 안내, 시작 API 503 `AI_LOOP_UNAVAILABLE`. 기존 기능 · 시연 그대로.
- LLM 은 러너가 Spring 프록시로만 부른다(그래프는 LLM 을 직접 부르지 않음). 도구는 MCP 로만.
- 반영은 승인 뒤 `AiJobService.applyDiff` 로만.
- 시작은 PM 이상(인터셉터 기본 쓰기 규칙). 다른 프로젝트 실행 번호는 404.
- 마이그레이션 V23: `ai_jobs.parent_job_id`.
- **시연 서버에서는 루프를 돌리지 않는다**(시연 spec 이 고쳐지면 미해결 결함 1건이 사라짐). 한 바퀴 증거는 로컬 dev.

## Review Focus

1. 같은 상태 이벤트가 두 번 와도(엔티티 저장마다 `AiJobChanged`) 루프가 두 번 나아가지 않음
2. 기다리는 단계와 맞지 않는 재개(수정 대기 중 검증 결과 등)는 무시
3. ai-service 가 꺼진 상태에서 시작 → 503, 작업이 RUNNING 으로 남지 않음
4. 루프 토큰으로 다른 프로젝트 실행 · 다른 작업에 손대지 못함
5. 자식 작업이 자동 반영되지 않음(autoCreated)

---

### Task 1: Spring 루프 작업 · MCP `start_code_fix` · 재개 전달
- V23 `parent_job_id`, `AiJob.parentJobId`, `AiJobType.LEARNING_LOOP`, `AiJobResponse.parentJobId`
- `AiJobService.createCodeFixJob(..., Long parentJobId)`: 부모가 있으면 `autoCreated=true`
- `AiLoopService`: `available()`, `start(projectId, executionId, userId)`, `startFix(loop, specPath, instruction)`, `onJobChanged`(자식 → `POST /loops/{id}/resume`, 응답으로 루프 상태 · 기록 갱신)
- `McpController`: 루프 작업이면 `start_code_fix` 를 목록 · 호출에 더함
- `AiLoopController`: `GET /api/ai-loop/status`, `POST /api/projects/{pid}/executions/{eid}/ai-loop`
- Test `AiLoopIntegrationTest`(가짜 ai-service HttpServer): 꺼짐 503 · 시작 요청 본문 · 자식 생성(부모 · autoCreated) · 재개 전달 · 응답 반영 · 남의 실행 404. `McpIntegrationTest`: 루프 아닌 작업엔 `start_code_fix` 없음

### Task 2: ai-service 그래프 + HTTP
- `graph.py`: classify → fix → wait_fix → wait_approval → measure → decide, `accepts(wait, child)`
- `app.py`: `POST /loops`, `POST /loops/{id}/resume`, MCP 클라이언트는 요청마다(토큰은 체크포인트에 안 남김)
- Test `test_loop.py`(가짜 도구): 한 바퀴 성공 · 과거 수정이 지시문에 들어감 · 환경/제품 결함 정지 · 3바퀴 · 정체 2번 · 예산 · 사람 거부 · 맞지 않는 재개 무시. `test_postgres.py`: interrupt 뒤 saver 를 닫고 새로 열어 재개(E-07)

### Task 3: 웹 패널
- `AiLoopPanel`(결과 탭, 실패 실행): 실패 묶음 원인 · "과거 수정 N건 참고", PM 이상 "AI 루프로 고치기"(꺼져 있으면 안내), 이 실행의 루프 기록
- Test `AiLoopPanel.test.tsx`

### Task 4: 로컬 한 바퀴 (프로필 ai)
- 시연 실패 → 루프 → 승인 → 재실행 통과 → spec 되돌리고 다시 실패 → "과거 수정 1건 참고"
