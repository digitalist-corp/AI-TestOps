package com.playops.api.service;

import com.playops.api.dto.PlanDtos.PlanItem;
import com.playops.api.dto.PlanDtos.PlanSummary;
import com.playops.api.dto.PlanDtos.ScreenProgress;
import com.playops.api.dto.ScenarioCaseNode;
import com.playops.api.dto.ScenarioSpecFile;
import com.playops.api.dto.ScenarioTreeResponse;
import com.playops.api.entity.ExecutionCaseResult;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.groups.Tuple.tuple;

/** 계획 표 규칙: 트리 펼치기 · 정렬 · 최근 결과 · 요약. */
class PlanRulesTest {

    private static ScenarioCaseNode test(String title, int line, boolean enabled) {
        return new ScenarioCaseNode("TEST", title, title, line, title, enabled, List.of());
    }

    private static ScenarioCaseNode describe(String title, boolean enabled, ScenarioCaseNode... children) {
        return new ScenarioCaseNode("DESCRIBE", title, title, 1, title, enabled, List.of(children));
    }

    private static PlanItem item(String spec, int line, Integer order, boolean enabled, String lastStatus) {
        return new PlanItem(spec, "t" + line, "t" + line, "", line, enabled, true,
                order, null, null, null, null, lastStatus, null, null, null, null, 0, null, null);
    }

    /** 미작성 계획 행 */
    private static PlanItem plan(long planId, Integer order, boolean enabled, String screen) {
        return new PlanItem("", "", "계획" + planId, "", 0, enabled, true, order, null, null, null, null,
                null, null, null, null, null, 0, null, null, planId, "UNWRITTEN", screen, null, null, null);
    }

    /** 계획 행에 연결된 테스트 */
    private static PlanItem linked(String spec, int line, String screen, String lastStatus) {
        return new PlanItem(spec, "t" + line, "t" + line, "", line, true, true, null, null, null, null, null,
                lastStatus, null, null, null, null, 0, null, null, 100L + line, "WRITTEN", screen, null, null, null);
    }

    private static ExecutionCaseResult result(long executionId, String spec, String title, String status) {
        ExecutionCaseResult r = new ExecutionCaseResult();
        r.setExecutionId(executionId);
        r.setSpecPath(spec);
        r.setCaseTitle(title);
        r.setStatus(status);
        return r;
    }

    @Test
    void effectiveEnabledFollowsSpecAndDescribe() {
        ScenarioTreeResponse tree = new ScenarioTreeResponse("p1", 2, 3, List.of(
                new ScenarioSpecFile("a.spec.ts", 2, true, List.of(
                        describe("결제", false, test("카드", 3, true)),
                        test("로그인", 9, true))),
                new ScenarioSpecFile("b.spec.ts", 1, false, List.of(test("검색", 2, true)))));

        List<PlanItem> items = PlanService.flatten(tree);

        assertThat(items).extracting(PlanItem::specPath, PlanItem::title, PlanItem::enabled, PlanItem::parentEnabled,
                        PlanItem::describePath)
                .containsExactly(
                        tuple("a.spec.ts", "카드", false, false, "결제"),
                        tuple("a.spec.ts", "로그인", true, true, ""),
                        tuple("b.spec.ts", "검색", false, false, ""));
    }

    @Test
    void summaryCountsOnlyEnabledAndExcludesDisabledFromRate() {
        List<PlanItem> items = List.of(
                item("a.spec.ts", 1, null, true, "PASSED"),
                item("a.spec.ts", 2, null, true, "PASSED"),
                item("a.spec.ts", 3, null, true, "FAILED"),
                item("a.spec.ts", 4, null, true, null),
                item("a.spec.ts", 5, null, false, "PASSED"));

        assertThat(PlanService.summarize(items)).isEqualTo(new PlanSummary(5, 4, 1, 0, 4, 1.0, 2, 1, 1, 0.5));
    }

    /** 계획 우선 흐름: 미작성 행도 계획이라 완료율 분모에 들어가고, notRun 은 작성됨인데 결과 없는 것만 센다. */
    @Test
    void summaryCountsUnwrittenPlansInRatesButNotInNotRun() {
        List<PlanItem> items = List.of(
                item("a.spec.ts", 1, null, true, "PASSED"),
                item("a.spec.ts", 2, null, true, null),
                plan(1, null, true, null),
                plan(2, null, true, null),
                plan(3, null, false, null));

        PlanSummary s = PlanService.summarize(items);

        assertThat(s.total()).isEqualTo(5);
        assertThat(s.enabled()).isEqualTo(4);
        assertThat(s.disabled()).isEqualTo(1);
        assertThat(s.unwritten()).isEqualTo(2);
        assertThat(s.written()).isEqualTo(2);
        assertThat(s.writtenRate()).isEqualTo(0.5);
        assertThat(s.passed()).isEqualTo(1);
        assertThat(s.notRun()).isEqualTo(1);
        assertThat(s.completionRate()).isEqualTo(0.25);
    }

    @Test
    void screensUsePlanScreenThenFirstFlowScreen() {
        var flows = List.of(new SiteCoverageService.CoverageFlow("tests/b.spec.ts", "흐름", "CODE", null, null, null,
                List.of(new SiteCoverageService.FlowStep("/cart", null, null), new SiteCoverageService.FlowStep("/pay", null, null))));
        List<PlanItem> items = List.of(
                plan(1, null, true, "/login"),
                plan(2, null, false, "/login"),                    // 사용 안 함 — 빠진다
                linked("tests/a.spec.ts", 1, "/login", "PASSED"),
                item("tests/b.spec.ts", 2, null, true, "FAILED"),   // 계획 행 없음 → 흐름의 첫 화면
                item("tests/c.spec.ts", 3, null, true, null));      // 화면을 모름 — 빠진다

        assertThat(PlanService.screens(items, flows))
                .containsExactly(new ScreenProgress("/login", 2, 1, 1, 0), new ScreenProgress("/cart", 1, 1, 0, 1));
    }

    @Test
    void orderedRowsComeFirstOnOneAxisThenUnwrittenThenFiles() {
        List<PlanItem> sorted = PlanService.sort(List.of(
                item("b.spec.ts", 3, null, true, null),
                plan(9, null, true, null),
                plan(7, 1, true, null),
                item("a.spec.ts", 2, 0, true, null),
                plan(4, null, true, null)));

        assertThat(sorted).extracting(PlanItem::planId, PlanItem::specPath)
                .containsExactly(tuple(null, "a.spec.ts"), tuple(7L, ""), tuple(4L, ""), tuple(9L, ""), tuple(null, "b.spec.ts"));
    }

    @Test
    void summaryWithNoRunsIsZero() {
        assertThat(PlanService.summarize(List.of()).completionRate()).isEqualTo(0.0);
        assertThat(PlanService.summarize(List.of(
                item("a.spec.ts", 1, null, true, null),
                item("a.spec.ts", 2, null, true, null))).completionRate()).isEqualTo(0.0);
    }

    @Test
    void itemsSortByOrderThenPathThenLine() {
        List<PlanItem> sorted = PlanService.sort(List.of(
                item("b.spec.ts", 3, null, true, null),
                item("a.spec.ts", 9, null, true, null),
                item("c.spec.ts", 1, 1, true, null),
                item("a.spec.ts", 2, 0, true, null)));

        assertThat(sorted).extracting(PlanItem::specPath, PlanItem::line)
                .containsExactly(tuple("a.spec.ts", 2), tuple("c.spec.ts", 1), tuple("a.spec.ts", 9), tuple("b.spec.ts", 3));
    }

    private static PlanItem planned(String spec, String describePath, String title) {
        return new PlanItem(spec, title, title, describePath, 1, true, true,
                null, null, null, null, null, null, null, null, null, null, 0, null, null);
    }

    @Test
    void latestResultIgnoresSkipped() {
        // 저장소 쿼리가 SKIPPED 를 이미 거르고 최신 실행부터 준다.
        var byLeaf = PlanService.byLeaf(List.of(
                result(4, "a.spec.ts", "a.spec.ts > 묶음 > 로그인", "FAILED"),
                result(2, "a.spec.ts", "a.spec.ts > 묶음 > 로그인", "PASSED")));

        assertThat(PlanService.historyFor(planned("a.spec.ts", "묶음", "로그인"), byLeaf).get(0).getStatus()).isEqualTo("FAILED");
    }

    @Test
    void latestResultMatchesReportPathRelativeToTestDir() {
        // 저장 경로는 tests/a.spec.ts, 리포트 경로는 testDir(./tests) 기준이라 a.spec.ts
        var byLeaf = PlanService.byLeaf(List.of(result(7, "a.spec.ts", "a.spec.ts > 로그인", "PASSED")));

        assertThat(PlanService.historyFor(planned("tests/a.spec.ts", "", "로그인"), byLeaf).get(0).getStatus()).isEqualTo("PASSED");
        assertThat(PlanService.historyFor(planned("tests/b.spec.ts", "", "로그인"), byLeaf)).isEmpty();
    }

    @Test
    void sameTitleInDifferentDescribesKeepsSeparateResults() {
        var byLeaf = PlanService.byLeaf(List.of(
                result(7, "a.spec.ts", "a.spec.ts > 관리자 > 저장", "FAILED"),
                result(7, "a.spec.ts", "a.spec.ts > 사용자 > 저장", "PASSED")));

        assertThat(PlanService.historyFor(planned("a.spec.ts", "관리자", "저장"), byLeaf).get(0).getStatus()).isEqualTo("FAILED");
        assertThat(PlanService.historyFor(planned("a.spec.ts", "사용자", "저장"), byLeaf).get(0).getStatus()).isEqualTo("PASSED");
    }

    /** ItemKey 는 생성자가 둘이다. 웹이 보내는 JSON(planId 있음 · 없음) 모두 읽혀야 한다. */
    @Test
    void itemKeyReadsWithAndWithoutPlanId() throws Exception {
        var json = new com.fasterxml.jackson.databind.ObjectMapper();
        var withPlan = json.readValue("{\"specPath\":\"\",\"grep\":\"\",\"planId\":5}", com.playops.api.dto.PlanDtos.ItemKey.class);
        var withoutPlan = json.readValue("{\"specPath\":\"a.spec.ts\",\"grep\":\"로그인\"}", com.playops.api.dto.PlanDtos.ItemKey.class);

        assertThat(withPlan.planId()).isEqualTo(5L);
        assertThat(withoutPlan).isEqualTo(new com.playops.api.dto.PlanDtos.ItemKey("a.spec.ts", "로그인", null));
    }
}
