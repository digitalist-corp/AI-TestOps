# A트랙 — 계획 기반 테스트 관리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메뉴를 입력 → 계획 → 실행 → 대시보드 → 설정으로 바꾸고, 케이스 단위 계획 표와 그 표 기준의 품질 지표 첫 화면을 만든다 (이슈 #75~#78).

**Architecture:** 계획 칸은 기존 `scenario_case_settings`(TEST 행)에 붙인다. 서버 `PlanService`가 시나리오 트리 + 설정 행 + 최근 케이스 결과를 합쳐 `{items, summary}` 하나로 돌려주고, 계획 표와 대시보드가 같은 응답을 쓴다. 화면 매핑은 웹의 기존 `casesByScreen`을 재사용한다.

**Tech Stack:** Spring Boot 3.3 / Java 21 / JPA / Flyway · React 19 + Vite + TS · ag-grid-community 33 · JUnit5 + AssertJ + Mockito · Vitest

**Spec:** `docs/superpowers/specs/2026-11-17-plan-table-design.md`

## Global Constraints

- DB 변경은 `V11__plan_columns.sql` 하나. V12는 B트랙 몫이라 쓰지 않는다.
- 기존 탭 id는 바꾸지 않는다. 새 탭 id는 `input`, `plan` 둘.
- 화면 문구에 spec · grep 같은 코드 용어를 쓰지 않는다 (파일 이름은 툴팁만).
- 완료율 = 최근 성공 ÷ 사용 중 항목. 미사용은 분모에서 뺀다. 사용 중 0건이면 0.
- 우선순위 값은 `HIGH` | `MEDIUM` | `LOW` | null. 화면 표기는 높음 · 보통 · 낮음.
- 결함 칸 · 미해결 결함 지표는 만들지 않는다 (B트랙 #81).
- 실행 로직(`TestExecutionService`)은 건드리지 않는다.
- 커밋 메시지는 한국어 + conventional prefix, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- API 테스트: 개발 컨테이너와 build/ 가 겹치므로 스크래치 사본에서 돈다.
  `rsync -a --delete --exclude build --exclude .gradle apps/api/ $SCRATCH/api/ && docker run --rm -v "$SCRATCH/api":/app -v api-gradle-cache:/home/gradle/.gradle -w /app gradle:8.10.2-jdk21 ./gradlew test --no-daemon --console=plain --tests '<클래스>'`
- 웹 테스트: `docker exec playops-web npx vitest run <파일>` · 빌드: `npm run build --workspace apps/web`

## Review Focus

1. 파일(spec)이나 묶음(describe)을 테스트 탭에서 꺼 둔 경우 — 계획 표의 그 케이스들은 "미사용"으로 보여야 하고 완료율 분모에서 빠져야 한다 (Task 2 `effectiveEnabledFollowsSpecAndDescribe`).
2. 한 번도 안 돌린 프로젝트 — 결과 칸은 "미수행", 완료율 0, 대시보드가 0으로 나눠 깨지지 않음 (Task 2 `summaryWithNoRunsIsZero`).
3. 순서를 일부만 정한 경우 — 순서 있는 항목이 앞, 나머지는 파일 경로 → 줄 번호 (Task 2 `itemsSortByOrderThenPathThenLine`).
4. 이미 결과가 있던 케이스가 다음 실행에서 SKIPPED — 최근 결과는 마지막으로 실제 돈 결과(성공/실패)를 쓴다 (Task 2 `latestResultIgnoresSkipped`).
5. 셀 저장 실패(네트워크·400) — 표 값이 원래대로 돌아가고 알림이 뜬다 (Task 3 `revertsCellWhenSaveFails`).

---

## 브랜치와 PR

- **PR 1 (Task 1)**: `feat/a1-menu-flow` — B트랙이 메뉴 위에서 작업하므로 11/18 안에 먼저 머지. 설계 문서와 이 계획도 이 PR에 넣는다.
- **PR 2 (Task 2~4)**: `feat/a-plan-table` — PR 1 머지 후 dev에서 다시 딴다.
- Task 5(#79 여유)는 11/20 범위 점검 때 정한다. 이 계획에 넣지 않는다.

---

### Task 1: 메뉴 5단계와 입력 단계 분석 패널 (#75)

**Files:**
- Modify: `apps/web/src/config/projectWorkspace.ts` (ProjectTabId · PROJECT_WORKSPACE_TABS에 `input`, `plan` 추가)
- Modify: `apps/web/src/config/shellNav.ts` (WorkspaceGroupId · WORKSPACE_GROUPS)
- Modify: `apps/web/src/config/shellNav.test.ts`
- Modify: `apps/web/src/components/project/StructureTab.tsx` (`mode` prop)
- Modify: `apps/web/src/pages/ProjectDetailPage.tsx` (`input`, `plan` 탭 렌더)

**Interfaces:**
- Produces: `ProjectTabId`에 `'input' | 'plan'`. `WorkspaceGroupId = 'input' | 'plan' | 'runs' | 'dashboard' | 'settings' | 'ai'`. `StructureTab`의 `mode?: 'input' | 'map'` (기본 `'map'`). Task 3은 `activeTab === 'plan'` 자리에 `PlanTab`을 꽂는다.

- [ ] **Step 1: shellNav 테스트를 새 메뉴로 고친다**

```ts
it('상단 그룹은 입력 → 계획 → 실행 → 대시보드 → 설정 순서다', () => {
  expect(visibleWorkspaceGroups(false).map((g) => g.label)).toEqual(['입력', '계획', '실행', '대시보드', '설정']);
  expect(WORKSPACE_GROUPS.find((g) => g.id === 'plan')?.tabs).toEqual(['plan', 'scenarios', 'recorder', 'structure']);
  expect(WORKSPACE_GROUPS.find((g) => g.id === 'runs')?.tabs).toEqual(['runs', 'results', 'schedules']);
  expect(WORKSPACE_GROUPS.find((g) => g.id === 'settings')?.tabs).toEqual(['settings', 'source']);
  expect(tabLabel('structure')).toBe('맵 보기');
  expect(groupOfTab('recorder').id).toBe('plan');
});
```
기존 `'scenarios'` 그룹을 가정한 테스트(`'클릭으로 만들기'…`)는 그룹 id를 `plan`으로 바꾼다. "모든 탭이 정확히 한 그룹" 테스트는 그대로 통과해야 한다.

- [ ] **Step 2: 실패 확인** — `docker exec playops-web npx vitest run src/config/shellNav.test.ts` → FAIL (라벨 순서 불일치)

- [ ] **Step 3: 구현**
  - `input` 탭: label `입력`, description `저장소를 연결하고 코드·사이트에서 화면을 찾기`. `plan` 탭: label `계획`, description `테스트 계획 표 — 담당자·마감일·우선순위·실행 대상`. `structure` 탭 label을 `맵 보기`로.
  - `WORKSPACE_GROUPS` = 입력(Download 아이콘, `['input']`) · 계획(ClipboardList, `['plan','scenarios','recorder','structure']`) · 실행(Play, `['runs','results','schedules']`) · 대시보드(LayoutDashboard, `['dashboard']`) · 설정(Settings, `['settings','source']`) · AI(aiOnly, 그대로).
  - `StructureTab`에 `mode`: `'input'`이면 분석 상태 줄 + 버튼(화면 추가 · 로그인 탐색 · 저장소 설정 · 사이트 주소로 찾기 · 코드로 찾기) + 저장소 설정 패널만, 그래프·목록은 숨김 + "결과는 계획 › 맵 보기에서 봅니다" 링크. `'map'`이면 그 버튼 줄 대신 "화면 다시 찾기는 입력 단계에서" 링크 하나. 상태·폴링 코드는 공유(컴포넌트 하나에 prop 하나).
  - `ProjectDetailPage`: `activeTab === 'input'` → `<StructureTab mode="input" …/>`, `'plan'`은 Task 3 전까지 "준비 중" 자리표시.

- [ ] **Step 4: 통과 확인** — 같은 vitest 명령 PASS, `npm run build --workspace apps/web` 성공.

- [ ] **Step 5: 브라우저로 확인** — `npm run dev` 후 http://localhost:3000 에서 프로젝트 진입: 상단에 다섯 그룹 순서, 입력 탭에서 "코드로 찾기" 동작, 계획 › 맵 보기에 그래프. 자체 회귀(`playwright-projects/playops-self`) 중 메뉴 클릭 테스트가 깨지면 셀렉터만 고친다.

- [ ] **Step 6: 커밋 · PR 1**

```bash
git add apps/web/src/config apps/web/src/components/project/StructureTab.tsx apps/web/src/pages/ProjectDetailPage.tsx docs/superpowers
git commit -m "feat: 메뉴를 입력 → 계획 → 실행 → 대시보드 → 설정 순서로 재배치 (#75)"
```

---

### Task 2: 계획 항목 서버 — V11 · PlanService · API (#76)

**Files:**
- Create: `apps/api/src/main/resources/db/migration/V11__plan_columns.sql`
- Modify: `apps/api/src/main/java/com/playops/api/entity/ScenarioCaseSetting.java` (4칸 + getter/setter)
- Create: `apps/api/src/main/java/com/playops/api/service/PlanService.java`
- Create: `apps/api/src/main/java/com/playops/api/controller/PlanController.java`
- Create: `apps/api/src/main/java/com/playops/api/dto/PlanDtos.java` (record들을 한 파일에 nested로)
- Test: `apps/api/src/test/java/com/playops/api/service/PlanRulesTest.java`, `PlanServiceTest.java`

**Interfaces:**
- Consumes: `PlaywrightScenarioService.analyze(projectId) → ScenarioTreeResponse` (spec.enabled, 노드 enabled 포함), `ScenarioCaseSettingRepository.findByProjectId`, `findByProjectIdAndNodeTypeAndSpecPathAndGrepFilter`, `ExecutionCaseResultRepository.findEarlierInProject(projectId, Long.MAX_VALUE)` (SKIPPED 제외 · 최신 실행부터 — 이미 그렇게 동작).
- Produces (JSON, Task 3·4가 씀):
  - `PlanDtos.PlanItem(String specPath, String grep, String title, String describePath, int line, boolean enabled, Integer sortOrder, String assignee, LocalDate dueDate, String priority, String lastStatus, Instant lastRunAt)`
  - `PlanDtos.PlanSummary(int total, int enabled, int disabled, int passed, int failed, int notRun, double completionRate)` — passed/failed/notRun은 **사용 중 항목만** 센다. completionRate는 0~1.
  - `PlanDtos.PlanResponse(List<PlanItem> items, PlanSummary summary)`
  - `PlanDtos.ItemKey(String specPath, String grep)`, `PlanDtos.ItemPatch(String specPath, String grep, Boolean enabled, String assignee, LocalDate dueDate, String priority)`, `PlanDtos.OrderRequest(List<ItemKey> items)`, `PlanDtos.BulkEnabledRequest(List<ItemKey> items, boolean enabled)`
  - 엔드포인트: `GET /api/projects/{id}/plan` → PlanResponse · `PATCH …/plan/items` (ItemPatch) → 204 · `PUT …/plan/order` (OrderRequest) → 204 · `PATCH …/plan/items/enabled` (BulkEnabledRequest) → 204
  - 순수 규칙(테스트용 package-private static): `PlanService.flatten(ScenarioTreeResponse) → List<PlanItem>`(결과·계획 칸 비어 있음), `PlanService.sort(List<PlanItem>)`, `PlanService.summarize(List<PlanItem>) → PlanSummary`, `PlanService.latestByCase(List<ExecutionCaseResult>) → Map<String, ExecutionCaseResult>` (키 = specPath + "\n" + 마지막 제목)

- [ ] **Step 1: 규칙 테스트 작성** (`PlanRulesTest`, `TestRoundRulesTest`처럼 엔티티를 직접 만든다)

```java
@Test void effectiveEnabledFollowsSpecAndDescribe() {
  // spec a(사용) > describe "결제"(미사용) > test "카드"(사용 행 없음) ; spec b(미사용) > test "검색"
  List<PlanItem> items = PlanService.flatten(tree);
  assertThat(items).extracting(PlanItem::title, PlanItem::enabled, PlanItem::describePath)
      .containsExactly(tuple("카드", false, "결제"), tuple("검색", false, ""));
}
@Test void summaryCountsOnlyEnabledAndExcludesDisabledFromRate() {
  // 사용: 성공2 실패1 미수행1, 미사용: 성공1
  assertThat(PlanService.summarize(items)).isEqualTo(new PlanSummary(5, 4, 1, 2, 1, 1, 0.5));
}
@Test void summaryWithNoRunsIsZero() {
  assertThat(PlanService.summarize(List.of()).completionRate()).isEqualTo(0.0);
  assertThat(PlanService.summarize(twoEnabledNotRun).completionRate()).isEqualTo(0.0);
}
@Test void itemsSortByOrderThenPathThenLine() {
  // (b.spec 3줄, order null) (a.spec 9줄, order null) (c.spec 1줄, order 1) (a.spec 2줄, order 0)
  assertThat(PlanService.sort(items)).extracting(PlanItem::specPath, PlanItem::line)
      .containsExactly(tuple("a.spec.ts", 2), tuple("c.spec.ts", 1), tuple("a.spec.ts", 9), tuple("b.spec.ts", 3));
}
@Test void latestResultIgnoresSkipped() {
  // 실행 7: "로그인" SKIPPED (쿼리가 이미 거름 — 입력에 없음), 실행 4: "로그인" FAILED, 실행 2: "로그인" PASSED, caseTitle은 "a.spec.ts > 묶음 > 로그인" 형태
  assertThat(PlanService.latestByCase(results).get("a.spec.ts\n로그인").getStatus()).isEqualTo("FAILED");
}
```

- [ ] **Step 2: 실패 확인** — 위 Global Constraints의 API 테스트 명령, `--tests 'com.playops.api.service.PlanRulesTest'` → 컴파일 실패(PlanService 없음)

- [ ] **Step 3: 마이그레이션 · 엔티티 · 규칙 구현**
  - V11: `ALTER TABLE scenario_case_settings ADD COLUMN sort_order INT, ADD COLUMN assignee VARCHAR(100), ADD COLUMN due_date DATE, ADD COLUMN priority VARCHAR(10);`
  - `flatten`: 트리를 깊이 우선으로 펼쳐 TEST 노드만. enabled = spec.enabled && 조상 DESCRIBE 모두 enabled && 자기 enabled. describePath = 조상 DESCRIBE 제목을 `" > "`로 이음.
  - `latestByCase`: 입력이 최신 실행부터이므로 키별 첫 값만 남긴다. 마지막 제목 = caseTitle을 `" > "`로 나눈 마지막 조각(웹 `caseLeaf`와 같은 규칙). specPath 비교는 그대로(정규화된 경로끼리).
  - `summarize`: 반올림 없이 passed / enabled.

- [ ] **Step 4: 통과 확인** — `PlanRulesTest` PASS

- [ ] **Step 5: 서비스 저장 동작 테스트** (`PlanServiceTest`, Mockito로 리포지토리를 흉내 — `PlaywrightScenarioServiceTest` 방식)

```java
@Test void patchCreatesTestRowAndOnlyTouchesSentFields() {
  // 기존 행 없음 → PATCH {assignee:"윤재"} → save된 행: nodeType "TEST", enabled true, assignee "윤재", dueDate null
}
@Test void patchRejectsUnknownPriority() {
  assertThatThrownBy(() -> service.patch("p1", new ItemPatch("a.spec.ts", "로그인", null, null, null, "URGENT")))
      .isInstanceOf(ApiException.class); // 400
}
@Test void reorderWritesZeroBasedOrder() { /* [b, a] → b.sortOrder 0, a.sortOrder 1 */ }
@Test void bulkEnabledUpdatesEveryKey() { /* 3건 enabled=false → 3행 저장 */ }
```
- [ ] **Step 6: 실패 확인 → `PlanService`(생성자: PlaywrightScenarioService, ScenarioCaseSettingRepository, ExecutionCaseResultRepository, ProjectService) 의 `get` · `patch` · `reorder` · `setEnabled` 와 `PlanController` 구현 → 통과 확인.** 저장은 TEST 행 하나를 찾아(없으면 생성) 고친다. specPath·grep 검증은 `updateUsage`와 같은 규칙(빈 값 400, `..`·절대경로 400). 일괄·순서 변경은 `@Transactional`.
- [ ] **Step 7: 전체 API 테스트** — `--tests` 없이 `./gradlew test` PASS (V11이 Flyway 테스트에서 적용되는지 포함)
- [ ] **Step 8: 커밋**

```bash
git add apps/api
git commit -m "feat: 계획 항목 칸(V11)과 계획 표 조회·수정 API (#76)"
```

---

### Task 3: 엑셀형 계획 표 화면 (#77)

**Files:**
- Modify: `apps/web/src/types/index.ts` (PlanItem · PlanSummary · PlanResponse · ItemKey · ItemPatch — Task 2 JSON과 같은 이름, 날짜는 `string | null`)
- Modify: `apps/web/src/api/client.ts` (`api.plan.get / patch / reorder / setEnabled`)
- Create: `apps/web/src/lib/plan.ts`, `apps/web/src/lib/plan.test.ts`
- Create: `apps/web/src/components/project/PlanTab.tsx`, `PlanTab.test.tsx`
- Modify: `apps/web/src/pages/ProjectDetailPage.tsx` (자리표시를 PlanTab으로)

**Interfaces:**
- Consumes: Task 2 엔드포인트, `casesByScreen`(lib/rounds), 기존 `api.getScenarios` · `api.getSiteMap` · `api.getSiteMapCoverage`, 실행 시작 콜백 `onRun`(대시보드의 '전체 실행'과 같은 것).
- Produces:
  - `planAsResults(items: PlanItem[]): TestRoundCase[]` — lastStatus 있는 항목만, `caseTitle = title`, change `'FIRST_RUN'`, previousRound null.
  - `screenNameByCase(groups: ScreenCases[]): Map<string, string>` — 키 `${specPath}\n${title}`, 여러 화면이면 `"로그인 외 1"`, 없으면 키 없음(표는 `미지정`).
  - `PRIORITY_LABEL: Record<'HIGH'|'MEDIUM'|'LOW', string>` = 높음/보통/낮음.

- [ ] **Step 1: lib 테스트**

```ts
it('여러 화면을 지나는 케이스는 첫 화면 외 N', () => {
  const m = screenNameByCase([{ routeKey: '/login', name: '로그인', cases: [c('a.spec.ts', '가입')], counts }, { routeKey: '/home', name: '홈', cases: [c('a.spec.ts', '가입')], counts }]);
  expect(m.get('a.spec.ts\n가입')).toBe('로그인 외 1');
});
it('화면을 모르는 묶음(routeKey null)은 이름을 주지 않는다', () => { /* get → undefined */ });
it('결과 없는 항목은 결과 목록에서 빠진다', () => { expect(planAsResults([item({ lastStatus: null })])).toEqual([]); });
```
- [ ] **Step 2: 실패 확인 → `lib/plan.ts` 구현 → 통과** (`docker exec playops-web npx vitest run src/lib/plan.test.ts`)

- [ ] **Step 3: PlanTab 테스트** (`ProjectDashboardTab.test.tsx`처럼 `api`를 vi.mock)

```ts
it('코드 용어 없이 업무 열 이름을 보여 준다', async () => {
  // 헤더: 사용 · 순서 · 계획 항목 · 화면 · 담당자 · 마감일 · 우선순위 · 최근 결과 ; 'spec' 'grep' 텍스트 없음
});
it('사용 체크를 끄면 PATCH enabled=false 를 보낸다', async () => { /* api.plan.patch 호출 인자 확인 */ });
it('revertsCellWhenSaveFails', async () => { /* patch reject → 담당자 셀이 원래 값, 알림 '저장하지 못했어요' 표시 */ });
it('체크한 N건 실행 버튼에 사용 중 건수가 나온다', async () => { /* summary.enabled = 3 → '체크한 3건 실행' */ });
```
- [ ] **Step 4: 실패 확인 → PlanTab 구현 → 통과**
  - ag-grid (`theme="legacy"`, quartz — ExecutionsTab과 같게). 열: 사용(체크박스 셀) · 순서(`rowDrag`, `rowDragManaged`, 끝나면 `onRowDragEnd`에서 전체 순서로 `reorder`) · 계획 항목(제목 + describePath 흐리게, 툴팁에 파일 이름) · 화면 · 담당자(text editor) · 마감일(`agDateStringCellEditor`) · 우선순위(`agSelectCellEditor`, 높음/보통/낮음/없음) · 최근 결과(성공/실패/미수행 배지).
  - 셀 변경(`onCellValueChanged`) → `api.plan.patch`(바뀐 칸만). 실패 시 `oldValue`로 되돌리고 알림.
  - 맨 위: 요약 한 줄("사용 중 N건 · 미사용 M건") + "선택 항목 사용/미사용" 일괄 버튼(행 선택) + "체크한 N건 실행"(`onRun`).
  - 정렬 · 필터는 ag-grid 기본(정렬 켜면 끌어 옮기기 꺼짐 — 정렬 중엔 `rowDrag` 숨김).
- [ ] **Step 5: 브라우저 확인** — 계획 탭에서 담당자·마감일·우선순위 수정 → 새로고침 후 유지, 한 건 미사용 → 실행 → 그 케이스가 결과에 없음.
- [ ] **Step 6: 커밋**

```bash
git add apps/web/src
git commit -m "feat: 엑셀형 테스트 계획 표 (#77)"
```

---

### Task 4: 품질 지표 첫 화면 (#78)

**Files:**
- Create: `apps/web/src/components/dashboard/PlanMetrics.tsx`
- Modify: `apps/web/src/lib/plan.ts` (+ `failingScreens`), `apps/web/src/lib/plan.test.ts`
- Modify: `apps/web/src/components/project/ProjectDashboardTab.tsx`, `ProjectDashboardTab.test.tsx`

**Interfaces:**
- Consumes: `api.plan.get`, `planAsResults`, `casesByScreen`, Task 2 `PlanSummary`.
- Produces: `failingScreens(groups: ScreenCases[]): { name: string; failed: number }[]` — failed > 0만, 많은 순, 같으면 이름순, `routeKey null` 묶음 포함("화면을 모르는 테스트").

- [ ] **Step 1: 테스트**

```ts
it('실패가 있는 화면만 많은 순으로', () => {
  expect(failingScreens([g('홈', 1), g('로그인', 3), g('설정', 0)])).toEqual([{ name: '로그인', failed: 3 }, { name: '홈', failed: 1 }]);
});
// ProjectDashboardTab.test.tsx
it('계획 기준 지표를 첫 줄에 보여 준다', async () => {
  // plan.summary = {total 10, enabled 8, disabled 2, passed 6, failed 1, notRun 1, completionRate 0.75}
  // '완료율 75%', '사용 8 · 미사용 2', '성공 6', '실패 1', '미수행 1' 이 보임
});
it('실패한 화면이 없으면 "오류 난 화면이 없어요"', async () => { /* … */ });
```
- [ ] **Step 2: 실패 확인 → 구현 → 통과**
  - `ProjectDashboardTab`: `api.plan.get`을 `runKey`가 바뀔 때마다 다시 읽는다(차수 목록과 같은 effect). 맨 위 `SummaryCards`를 `PlanMetrics`(지표 6칸: 전체 계획 · 사용/미사용 · 성공 · 실패 · 미수행 · 완료율 %, 정수 반올림)로 바꾸고, 그 아래 "오류 난 화면" 목록(`failingScreens(casesByScreen({..., results: planAsResults(plan.items)}))`, 이름 옆 실패 건수, 누르면 아래 화면별 케이스로 스크롤). 차수 비교·케이스 트리는 그대로 아래에.
  - 기존 `SummaryCards`에서 쓰던 "다음 예약 실행" 정보는 PlanMetrics 아래 한 줄 문장으로 남긴다. `SummaryCards.tsx`는 다른 곳에서 안 쓰면 지운다.
- [ ] **Step 3: 일치 확인** — 브라우저에서 계획 표의 성공/실패/미수행 배지 개수와 대시보드 숫자가 같음, 계획 표에서 한 건 미사용 → 대시보드로 오면 사용/미사용·완료율 바뀜.
- [ ] **Step 4: 웹 전체 테스트 · 빌드** — `docker exec playops-web npx vitest run` PASS, `npm run build --workspace apps/web` 성공.
- [ ] **Step 5: 커밋 · PR 2**

```bash
git add apps/web/src
git commit -m "feat: 계획 기준 품질 지표와 오류 화면을 대시보드 첫 줄에 (#78)"
```
PR 2 본문에 계획 표 · 대시보드 스크린샷, "결함 칸은 B #81에서" 명시.
