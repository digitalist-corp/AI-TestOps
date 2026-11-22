package com.playops.api.service;

import com.playops.api.dto.PlanDtos.DailyCell;
import com.playops.api.dto.PlanDtos.DailyResponse;
import com.playops.api.dto.PlanDtos.DailyTotal;
import com.playops.api.dto.PlanDtos.PlanItem;
import com.playops.api.dto.ScenarioCaseNode;
import com.playops.api.dto.ScenarioSpecFile;
import com.playops.api.dto.ScenarioTreeResponse;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.service.PlanService.Tracked;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Collection;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.groups.Tuple.tuple;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyIterable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 일자별 정기 실행 격자 (F-3): 정기/수동 구분 · 하루 마지막 결과 · 서울 날짜 경계 · 사용 중 항목만 합계 · 기간 제한. */
class PlanDailyServiceTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 11, 22);

    /** 계획 항목은 트리에서 펼쳐 만든다 (PlanItem 칸이 늘어도 이 테스트는 그대로). */
    private static List<PlanItem> items(boolean secondEnabled) {
        ScenarioCaseNode a = new ScenarioCaseNode("TEST", "로그인", "로그인", 3, "로그인", true, List.of());
        ScenarioCaseNode b = new ScenarioCaseNode("TEST", "검색", "검색", 9, "검색", secondEnabled, List.of());
        return PlanService.flatten(new ScenarioTreeResponse("p1", 1, 2, List.of(
                new ScenarioSpecFile("tests/a.spec.ts", 2, true, List.of(a, b)))));
    }

    private static ExecutionCaseResult result(long executionId, String status, String at) {
        ExecutionCaseResult r = new ExecutionCaseResult();
        r.setExecutionId(executionId);
        r.setStatus(status);
        ReflectionTestUtils.setField(r, "createdAt", Instant.parse(at));
        return r;
    }

    private static List<String> statuses(DailyResponse res, int item) {
        return res.items().get(item).cells().stream().map(DailyCell::status).toList();
    }

    @Test
    void onlyScheduledRunsCountAndLastRunOfTheDayWins() {
        List<PlanItem> items = items(true);
        // 최신 실행부터. 11/22 (KST): 정기 12(실패) → 정기 13(성공, 더 늦음), 수동 14(실패)는 빼야 한다
        List<Tracked> tracked = List.of(
                new Tracked(items.get(0), List.of(
                        result(14, "FAILED", "2026-11-22T05:00:00Z"),
                        result(13, "PASSED", "2026-11-22T03:00:00Z"),
                        result(12, "FAILED", "2026-11-21T18:00:00Z"))),
                new Tracked(items.get(1), List.of(result(14, "FAILED", "2026-11-22T05:00:00Z"))));

        DailyResponse res = PlanDailyService.build(tracked, Set.of(12L, 13L), TODAY, 3);

        assertThat(res.days()).containsExactly(TODAY.minusDays(2), TODAY.minusDays(1), TODAY);
        assertThat(statuses(res, 0)).containsExactly(null, null, "PASSED");
        assertThat(res.items().get(0).cells().get(2).executionId()).isEqualTo(13L);
        assertThat(statuses(res, 1)).containsExactly(null, null, null);
        assertThat(res.items().get(1).cells().get(2).executionId()).isNull();
    }

    @Test
    void dateBoundaryIsSeoulMidnight() {
        List<PlanItem> items = items(true);
        // UTC 14:59 = KST 23:59 (11/21), UTC 15:00 = KST 00:00 (11/22)
        List<Tracked> tracked = List.of(
                new Tracked(items.get(0), List.of(result(2, "FAILED", "2026-11-21T15:00:00Z"))),
                new Tracked(items.get(1), List.of(result(1, "PASSED", "2026-11-21T14:59:59Z"))));

        DailyResponse res = PlanDailyService.build(tracked, Set.of(1L, 2L), TODAY, 2);

        assertThat(statuses(res, 0)).containsExactly(null, "FAILED");
        assertThat(statuses(res, 1)).containsExactly("PASSED", null);
    }

    @Test
    void totalsCountEnabledItemsOnlyAndPassRateIsNullWithoutRuns() {
        List<PlanItem> items = items(false); // 검색은 미사용
        List<Tracked> tracked = List.of(
                new Tracked(items.get(0), List.of(
                        result(2, "PASSED", "2026-11-22T00:00:00Z"),
                        result(1, "FAILED", "2026-11-21T00:00:00Z"))),
                new Tracked(items.get(1), List.of(
                        result(2, "FAILED", "2026-11-22T00:00:00Z"),
                        result(1, "FAILED", "2026-11-21T00:00:00Z"))));

        DailyResponse res = PlanDailyService.build(tracked, Set.of(1L, 2L), TODAY, 3);

        assertThat(statuses(res, 1)).containsExactly(null, "FAILED", "FAILED"); // 칸은 보이지만
        assertThat(res.totals()).extracting(DailyTotal::date, DailyTotal::passed, DailyTotal::failed,
                        DailyTotal::enabled, DailyTotal::passRate)
                .containsExactly(
                        tuple(TODAY.minusDays(2), 0, 0, 1, null),
                        tuple(TODAY.minusDays(1), 0, 1, 1, 0.0),
                        tuple(TODAY, 1, 0, 1, 1.0));
    }

    @Test
    void daysAreClampedToOneThroughThirtyOne() {
        assertThat(PlanDailyService.clampDays(null)).isEqualTo(7);
        assertThat(PlanDailyService.clampDays(0)).isEqualTo(1);
        assertThat(PlanDailyService.clampDays(-5)).isEqualTo(1);
        assertThat(PlanDailyService.clampDays(14)).isEqualTo(14);
        assertThat(PlanDailyService.clampDays(400)).isEqualTo(31);
    }

    @Test
    void scheduleIdOrScheduledSourceMarksScheduledRun() {
        Execution manual = new Execution();
        Execution bySchedule = new Execution();
        bySchedule.setScheduleId(3L);
        Execution bySource = new Execution();
        bySource.setSource("SCHEDULED");

        assertThat(PlanDailyService.isScheduled(manual)).isFalse();
        assertThat(PlanDailyService.isScheduled(bySchedule)).isTrue();
        assertThat(PlanDailyService.isScheduled(bySource)).isTrue();
    }

    @Test
    @SuppressWarnings("unchecked")
    void readsRecentExecutionsOnceAndSkipsOldOnes() {
        List<PlanItem> items = items(true);
        Instant now = Instant.now();
        PlanService planService = mock(PlanService.class);
        when(planService.tracked("p1")).thenReturn(List.of(
                new Tracked(items.get(0), List.of(
                        result(5, "PASSED", now.toString()),
                        result(4, "FAILED", now.minus(1, ChronoUnit.DAYS).toString()),
                        result(1, "FAILED", now.minus(60, ChronoUnit.DAYS).toString()))),
                new Tracked(items.get(1), List.of(result(5, "FAILED", now.toString())))));
        Execution scheduled = new Execution();
        scheduled.setId(5L);
        scheduled.setScheduleId(1L);
        Execution manual = new Execution();
        manual.setId(4L);
        ExecutionRepository executions = mock(ExecutionRepository.class);
        when(executions.findAllById(any())).thenReturn(List.of(scheduled, manual));

        DailyResponse res = new PlanDailyService(planService, executions).daily("p1", 99);

        assertThat(res.days()).hasSize(31);
        assertThat(statuses(res, 0).get(30)).isEqualTo("PASSED");
        assertThat(statuses(res, 1).get(30)).isEqualTo("FAILED");
        var captor = org.mockito.ArgumentCaptor.forClass(Iterable.class);
        verify(executions, times(1)).findAllById(captor.capture());
        assertThat((Collection<Long>) captor.getValue()).containsExactlyInAnyOrder(5L, 4L); // 60일 전 실행은 읽지 않는다
    }

    @Test
    void noRecentResultsSkipsExecutionLookup() {
        PlanService planService = mock(PlanService.class);
        when(planService.tracked("p1")).thenReturn(List.of(new Tracked(items(true).get(0), List.of())));
        ExecutionRepository executions = mock(ExecutionRepository.class);

        DailyResponse res = new PlanDailyService(planService, executions).daily("p1", null);

        assertThat(res.days()).hasSize(7);
        assertThat(res.totals()).allMatch(t -> t.passRate() == null);
        verify(executions, never()).findAllById(anyIterable());
    }

    /** 계획 우선 흐름: 미작성 계획 행은 실행되지 않으므로 격자 줄도, 합계의 사용 중 수도 아니다. */
    @Test
    void unwrittenPlansAreLeftOutOfTheGrid() {
        PlanItem unwritten = new PlanItem("", "", "결제한다", "", 0, true, true, null, null, null, null, null,
                null, null, null, null, null, 0, null, null, 5L, "UNWRITTEN", null, null, null, null);
        List<Tracked> tracked = List.of(new Tracked(items(true).get(0), List.of()), new Tracked(unwritten, List.of()));

        DailyResponse res = PlanDailyService.build(tracked, Set.of(), TODAY, 1);

        assertThat(res.items()).hasSize(1);
        assertThat(res.totals().get(0).enabled()).isEqualTo(1);
    }
}
