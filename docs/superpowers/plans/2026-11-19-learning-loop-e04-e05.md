# 학습 루프 E-04 · E-05 · V22 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 실패를 서명으로 묶고(E-04) 원인 5종으로 나누며(E-05), 사람이 고친 분류와 승인된 수정을 기억해(V22) 다음 실패에 "과거 수정 N건"을 돌려준다.

**Architecture:** 서명 · 분류 · 회상은 Spring 순수 함수(`FailureRules`)와 서비스(`FailureService`)에 둔다. 프로필 `ai` 가 꺼져도 화면이 쓰고, 평가셋 테스트가 결정적으로 돈다. LangGraph(ai-service)는 MCP 도구 `list_failure_clusters` · `recall_fixes` 로 같은 결과를 받는다 (E-06 이후).

**Tech Stack:** Spring Boot 3.3 / JUnit 5 / Flyway, 기존 `CoverageRules.targetSelector`

**Spec:** `docs/handoff/2026-11-19-역할별홈-학습루프-인수인계.md` 2절 [2], `docs/handoff/2026-11-18-LangGraph-개선-인수인계.md` 표 3 · 4행

## 짧은 설계 (brainstorming 대신 — 준호 계획이 설계를 정함)

- **접근 3가지**: ① Spring 규칙 분류 + MCP 로 전달(채택) ② ai-service 에서 LLM 분류 ③ 둘 다. ①은 프로필 `ai` 없이도 화면에 나오고 평가가 결정적이다. ②는 매번 비용 · 비결정이라 "정확도를 테스트로 측정"이 흔들린다. LLM 은 E-06 루프에서 `미분류`일 때만 덧붙인다.
- **서명**: 첫 줄(숫자→N, 주소→`<url>`, `Error:` 제거) + 로케이터(`CoverageRules.targetSelector`) + spec 경로 → sha1 앞 12자. **스택은 저장하지 않으므로**(리포트 파서가 `error.message` 만 저장) 스택 맨 위 프레임에 해당하는 spec 경로로 대신한다. 줄 번호는 수정 뒤 바뀌어 넣지 않는다.
- **분류 순서**: 사람 피드백(같은 서명) → 환경 → 불안정(이전 상태 포함 뒤집힘 2회 이상) → 스크립트 오류 → 제품 결함 → 미분류.
- **회상 점수**: 서명 같음 3 · 로케이터 같음 2 · 첫 줄 같음 1, 0점 제외, 최신순 동점 처리, 상위 3건.

## Global Constraints

- 원인 값: `PRODUCT_DEFECT`(제품 결함) · `SCRIPT_ERROR`(스크립트 오류) · `ENVIRONMENT`(환경) · `FLAKY`(불안정) · `UNCLASSIFIED`(미분류)
- 마이그레이션은 V22 (V21 은 비밀번호 플래그가 씀)
- 평가셋 `docs/eval/failure-classify.json` 20건, 정확도 ≥ 0.70 을 JUnit 이 측정 · 출력. 저장소 루트를 마운트해야 읽힘(아래 명령)
- 시연 데이터 · 기존 화면 문구 변경 없음. 새 API 는 프로젝트 멤버 읽기 권한 그대로
- 테스트 명령: `docker run --rm -v "$PWD":/repo -v api-gradle-cache:/home/gradle/.gradle -w /repo/apps/api gradle:8.10.2-jdk21 ./gradlew test --tests '<패턴>' --no-daemon --console=plain` (먼저 `docker stop playops-api`)

## Review Focus

1. 오류 메시지 null · 빈 문자열 · ANSI 색 코드 → 서명이 만들어지고 미분류
2. 같은 원인인데 시간 초과 ms · 포트 · 주소가 다른 실패 → 같은 서명
3. 다른 프로젝트의 피드백 · 수정 기억이 섞이지 않음
4. 피드백을 두 번 고치면 마지막 값
5. 평가셋 파일이 없을 때 조용히 통과하지 않음(건너뜀으로 보임)

---

### Task 1: 서명 · 군집 (E-04)
- Create `service/FailureRules.java`: `record Signature(String key, String head, String locator)`, `static Signature signature(String specPath, String error)`, `static <T> Map<String, List<T>> cluster(List<T> items, Function<T, Signature> sig)`(처음 나온 순서 유지)
- Test `FailureRulesTest`: `sameCauseDifferentNumbersShareSignature`, `differentLocatorSplits`, `ansiAndBlankAreSafe`, `clusterKeepsFirstSeenOrder`

### Task 2: 분류 + 평가셋 (E-05)
- `enum Cause`, `static Cause classify(String error, List<String> history)` (history = 같은 케이스의 이전 상태, 최신 먼저)
- Create `docs/eval/failure-classify.json`(20건: id · error · history · expected · note) + `docs/eval/README.md`
- Test `FailureClassifyEvalTest`: 정확도 출력, `>= 0.70`. 원인별 단위 테스트 5개(`FailureRulesTest`)

### Task 3: V22 학습 기억 + API
- `V22__ai_learning_memory.sql`: `ai_fix_memory(id, project_id, signature, head, locator, spec_path, cause, ai_job_id, diff, created_at)`, `ai_classify_feedback(id, project_id, signature, cause, user_id, created_at, unique(project_id, signature))`
- `FailureService`: `clusters(projectId, executionId)` → 서명별 묶음(원인 · 원인 출처 RULE/HUMAN · 건수 · 케이스 · 쉬운 말 · 과거 수정 수), `setCause(projectId, signature, cause, user)`, `remember(AiJob)`(승인 · 반영된 CODE_FIX 를 기억), `recall(projectId, signature, head, locator, limit)`
- `AiJobService.applyDiff` 성공 뒤 `remember` 호출 (승인 경로 그대로)
- API: `GET /api/projects/{pid}/executions/{eid}/failure-clusters`, `PUT /api/projects/{pid}/failure-causes/{signature}`(PM 이상)
- Test `FailureLearningIntegrationTest`: 군집 응답, 피드백이 규칙을 이김 · 다른 프로젝트에 안 섞임, 반영된 수정이 다음 같은 실패에 `pastFixes=1`

### Task 4: MCP 도구
- ChatTool `list_failure_clusters`(projectId, executionId — 실행이 그 프로젝트 것인지 확인, #158), `recall_fixes`(projectId, signature) READ 등급, `McpController.ALLOWED` 에 추가
- Test `McpIntegrationTest` 에 남의 프로젝트 실행 번호 → isError 1개, recall 1개
