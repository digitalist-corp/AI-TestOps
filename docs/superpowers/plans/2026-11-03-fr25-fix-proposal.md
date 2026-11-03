# FR-25 수정 제안 카드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 실패한 실행에서 "이렇게 고칠까요?" 제안(ai_jobs PROPOSED)을 자동으로 만들고, 사람이 진행을 누르면 기존 CODE_FIX를 돌린다.

**Architecture:** `FixProposalRules`(순수 규칙)가 오류 → 문제·고칠 방법 문장을 만든다. `FixProposalService`가 실행 종료 시 제안을 저장하고 알린 뒤, AI 키가 있으면 비동기로 문장을 다듬는다. `AiJobService`에 proceed/dismiss가 생기고, 웹은 결과 탭에 카드를 띄운다.

**Tech Stack:** Spring Boot 3.3 / Java 21, JUnit5 + Mockito, React 19 + TS.

**Spec:** `docs/superpowers/specs/2026-11-03-fr25-fix-proposal-design.md`

## Global Constraints

- 사용자에게 보이는 문장은 가이드 말투(쉬운 존댓말).
- 제안 생성 실패가 실행 종료 처리를 깨면 안 된다(try/catch, 로그만).
- 진행해도 NEEDS_REVIEW까지만 간다. 승인 게이트 우회 금지.
- 마이그레이션은 V9(기존 DB의 status 체크 제약 삭제) 하나.

## Review Focus

- 케이스 결과가 없는 FAILED 실행(리포트 파싱 실패) → 제안을 만들지 않음 (Task 2 테스트).
- 같은 spec에 실패 케이스 여러 개 → 그 spec에 제안 하나 (Task 2 테스트).
- 이미 진행/닫힌 제안에 proceed/dismiss 재호출 → 409 (Task 3 테스트).
- AI 다듬기 결과가 비거나 300자 초과 → 규칙 문장 유지 (Task 2 테스트).
- 다듬는 사이 사용자가 진행을 눌러 상태가 바뀜 → 덮어쓰지 않음 (Task 2: PROPOSED일 때만 갱신).

---

### Task 1: FixProposalRules

**Files:** Create `apps/api/src/main/java/com/playops/api/service/FixProposalRules.java`, Test `.../service/FixProposalRulesTest.java`

**Interfaces:** Produces `record Proposal(String problem, String plan)` 와 `static Proposal of(String caseTitle, String error)`. problem = `CoverageRules.explain(error).message()` + (" · " + caseTitle, caseTitle 있으면). plan = 설계 문서 표의 문장.

- [ ] 실패 테스트: 찾지 못함/모호/기대와 다름/주소/열기 실패/그 밖 → 표의 문장, problem에 케이스명 포함.
- [ ] 구현 → 통과 → 커밋.

### Task 2: FixProposalService + 실행 종료 연결 + 알림

**Files:** Create `service/FixProposalService.java`; Modify `entity/AiJobStatus.java`(PROPOSED), `repository/AiJobRepository.java`, `service/TestExecutionService.java`(finally에서 호출), `service/NotificationService.java`(`fixProposed`); Test `service/FixProposalServiceTest.java`

**Interfaces:**
- `void onExecutionFinished(Execution execution, Project project)` — 예외를 밖으로 던지지 않음.
- `void polishAsync(List<Long> jobIds)` `@Async("aiJobExecutor")` (self 프록시 호출).
- `String polish(AiJob job, String error)` — null이면 유지.
- Repo: `boolean existsByProjectIdAndTargetSpecPathAndStatusIn(String, String, Collection<AiJobStatus>)`, `long countByProjectIdAndRequestedByIsNullAndCreatedAtAfter(String, Instant)`.
- `NotificationService.fixProposed(Project project, Long executionId, int count)` kind `FIX_PROPOSED`, level `INFO`, 링크 `/projects/{id}/runs?execution={executionId}`.
- 상수: `MAX_PER_EXECUTION = 3`, `DAILY_LIMIT = 20`, 사용량 feature `FIX_PROPOSAL`.

- [ ] 실패 테스트: FAILED + 케이스 2 spec → 제안 2개(PROPOSED, requestedBy null, instruction=plan, summary=problem) + 알림 1회; AI_POST_APPLY/ERROR/“AI 초기 케이스” 제외; 열린 작업 있는 spec 건너뜀; 하루 상한; 케이스 없음 → 아무것도 안 함; polish 결과 빈/긴 문자열 무시.
- [ ] 구현 → 통과 → 커밋.

### Task 3: proceed / dismiss API

**Files:** Modify `service/AiJobService.java`, `controller/AiJobController.java`; Test `service/FixProposalServiceTest.java` 또는 AiJobService 테스트

**Interfaces:** `AiJob proceed(Long jobId, Long userId)` — PROPOSED 아니면 409, AI 키 없으면 400; PENDING·requestedBy·새 콜백토큰·provider 스냅샷 후 `self.runAsync`. `AiJob dismiss(Long jobId, Long userId)` — PROPOSED 아니면 409, CANCELED·reviewedBy. 엔드포인트 `POST /api/ai-jobs/{id}/proceed`, `/dismiss`.

- [ ] 테스트 → 구현 → 커밋.

### Task 4: 웹 카드

**Files:** Modify `web/src/types/index.ts`(PROPOSED), `web/src/api/client.ts`(proceed, dismiss), `web/src/components/project/AiReviewTab.tsx`(라벨 '수정 제안'), `web/src/components/project/ResultsTab.tsx`; Create `web/src/components/project/FixProposalCard.tsx`

- [ ] 결과 탭에서 고른 실행의 PROPOSED 제안 카드. AI 켬: 진행/닫기, 끔: 닫기 + 안내.
- [ ] `npm run build --workspace apps/web` 통과 → 커밋.

### Task 5: 검증·PR

- [ ] API 전체 테스트(Docker gradle), 웹 빌드·테스트.
- [ ] 로컬 dev 서버에서 실패 실행 → 카드 확인.
- [ ] 푸시, PR(dev 대상).
