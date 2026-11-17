# A-5 스위트 필터 · 맵 노드 스크린샷 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 계획 표를 스위트 단위로 거르고 그 스위트의 성공 · 실패 · 미수행 · 미사용 건수를 보여 주며, 맵 보기 화면 노드에 저장된 스크린샷 썸네일을 띄운다 (이슈 #79).

**Architecture:** 웹만 바꾼다. 스위트 소속 판정은 `lib/plan.ts`의 순수 함수, 썸네일은 화면 상세 패널과 같은 `api.fetchSiteMapScreenshot` 을 모듈 캐시로 한 번만 받는 훅.

**Tech Stack:** React 19 · TypeScript · Vitest

**Spec:** `docs/superpowers/specs/2026-11-17-plan-table-design.md` (여유 A-5) · 이 대화의 짧은 설계 (승인 2026-11-17)

## Global Constraints

- 서버 · DB 변경 없음.
- 화면 노드 크기(256×128)와 그래프 배치는 바꾸지 않는다.
- 스위트 소속 규칙: spec 경로가 스위트 `specPaths` 에 있고(`samePath`), `grep` 이 있으면 `"{specPath} {describePath} {title}"` 이 그 정규식에 맞을 것. 잘못된 정규식이면 글자 포함으로 대신 판정.
- 화면 문구에 spec · grep 같은 코드 용어를 쓰지 않는다.
- 웹 테스트: `docker exec playops-web npx vitest run <파일>` · 타입: `docker exec playops-web npx tsc --noEmit -p .`

## Review Focus

1. 스위트 grep 이 잘못된 정규식(`[`) — 화면이 깨지지 않고 포함 판정으로 대신한다 (Task 1 `invalidGrepFallsBackToContains`).
2. 스위트가 0개인 프로젝트 — 드롭다운을 숨기고 표는 그대로 (Task 1 PlanTab 테스트).
3. 스크린샷 요청 실패 — 썸네일 없이 노드가 그대로 보인다 (Task 2 `hidesThumbnailWhenFetchFails`).
4. 같은 화면을 여러 번 그려도 스크린샷은 한 번만 받는다 (Task 2 `fetchesEachScreenshotOnce`).

---

### Task 1: 계획 표 스위트 필터와 건수

**Files:** Modify `apps/web/src/lib/plan.ts`, `lib/plan.test.ts`, `components/project/PlanTab.tsx`, `PlanTab.test.tsx`

**Interfaces:**
- Produces: `inSuite(suite: Pick<TestSuite, 'specPaths' | 'grep'>, item: PlanItem): boolean`, `planCounts(items: PlanItem[]): { passed: number; failed: number; notRun: number; disabled: number }` (passed · failed · notRun 은 사용 중 항목만, disabled 는 미사용 수)

- [ ] 테스트: `inSuite` — 경로가 목록에 있으면 포함 · 없으면 제외 · grep `로그인` 이면 제목에 로그인 있는 것만 · `invalidGrepFallsBackToContains`. `planCounts` — 사용 2(성공 1, 미수행 1) + 미사용 1 → `{1,0,1,1}`.
- [ ] 테스트: PlanTab — 스위트가 있으면 "스위트" 선택이 보이고, 고르면 그 스위트 항목만 표에 남으며 `성공 1 · 실패 0 · 미수행 1 · 미사용 1` 문구가 보인다. 스위트가 없으면 선택이 없다.
- [ ] 실패 확인 → 구현: PlanTab 이 `api.testSuites.list(projectId)` 를 읽고(실패 시 빈 목록) `<select aria-label="스위트">` (전체 + 이름들). 고른 스위트로 `rowData` 를 거르고 건수 한 줄 표시. 끌어 옮기기 순서 저장은 필터 중에도 전체 순서를 유지하도록, 필터 중에는 끌어 옮기기를 끈다.
- [ ] 통과 확인 · 커밋 `feat: 계획 표를 스위트별로 보고 성공·실패·미수행 건수 표시 (#79)`

### Task 2: 맵 노드 스크린샷 썸네일

**Files:** Create `apps/web/src/components/project/structure/useScreenshot.ts`, `useScreenshot.test.ts`; Modify `ScreenNode.tsx`, `StructureGraph.tsx` (노드 data 에 `projectId`)

**Interfaces:**
- Produces: `useScreenshot(projectId: string, routeKey: string, enabled: boolean): string | null` (object URL). 모듈 캐시 `Map<string, Promise<string | null>>`, 키 `${projectId}\n${routeKey}`. 실패하면 null.
- `ScreenNodeData` 에 `projectId: string` 추가.

- [ ] 테스트: `fetchesEachScreenshotOnce` (같은 키로 훅 두 번 → fetch 1회), `hidesThumbnailWhenFetchFails` (reject → null).
- [ ] 실패 확인 → 구현. ScreenNode: `node.hasScreenshot` 이면 상태 줄 오른쪽(절대 위치, 64×40, 둥근 모서리, `alt="{화면 이름} 화면"`)에 썸네일, 상태 줄은 썸네일만큼 오른쪽 여백.
- [ ] 통과 · 전체 웹 테스트 · tsc · 커밋 `feat: 맵 보기 화면 노드에 스크린샷 썸네일 (#79)`
