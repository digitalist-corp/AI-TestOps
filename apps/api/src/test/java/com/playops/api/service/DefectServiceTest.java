package com.playops.api.service;

import com.playops.api.dto.DefectDtos.Defect;
import com.playops.api.dto.DefectDtos.DefectResponse;
import com.playops.api.dto.DefectDtos.DefectRun;
import com.playops.api.dto.PlanDtos.ItemKey;
import com.playops.api.dto.PlanDtos.PlanItem;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.TestSuite;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.repository.TestSuiteRepository;
import com.playops.api.util.PlaywrightGrep;
import com.playops.api.service.PlanService.Tracked;
import com.playops.api.service.SiteCoverageService.Coverage;
import com.playops.api.service.SiteCoverageService.CoverageFlow;
import com.playops.api.service.SiteCoverageService.FlowStep;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.groups.Tuple.tuple;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 결함 판정: 최근 실행이 실패면 미해결, 실패 뒤 통과하면 해결. 필터: 상태 · 담당자 · 스위트 · 화면. */
class DefectServiceTest {

    private PlanService planService;
    private SiteCoverageService coverageService;
    private TestSuiteRepository suiteRepository;
    private ExecutionRepository executionRepository;
    private ExecutionQueryService executionQueryService;
    private DefectService service;

    @BeforeEach
    void setUp() {
        planService = mock(PlanService.class);
        coverageService = mock(SiteCoverageService.class);
        suiteRepository = mock(TestSuiteRepository.class);
        executionRepository = mock(ExecutionRepository.class);
        executionQueryService = mock(ExecutionQueryService.class);
        service = new DefectService(planService, coverageService, suiteRepository, executionRepository, executionQueryService);
        when(coverageService.view("p1")).thenReturn(new Coverage(null, List.of(), List.of(), List.of(
                new CoverageFlow("tests/a.spec.ts", "a", "PATH", "FAILED", null, 3L,
                        List.of(new FlowStep("/login", "PASSED", null), new FlowStep("/cart", "FAILED", null))))));
    }

    private static PlanItem item(String spec, String title, boolean enabled, Long assigneeUserId) {
        return new PlanItem(spec, title, title, "", 1, enabled, true, null, assigneeUserId == null ? null : "윤재",
                assigneeUserId, null, null, null, null, null, null, null, 0, null, null);
    }

    /** 최신 실행부터. "F"=실패, "P"=통과. 실행 번호는 뒤에서부터 1, 2, 3 ... */
    private static List<ExecutionCaseResult> history(String... newestFirst) {
        List<ExecutionCaseResult> out = new ArrayList<>();
        for (int i = 0; i < newestFirst.length; i++) {
            ExecutionCaseResult r = new ExecutionCaseResult();
            r.setExecutionId((long) (newestFirst.length - i));
            r.setStatus(newestFirst[i].equals("F") ? "FAILED" : "PASSED");
            r.setErrorMessage(newestFirst[i].equals("F") ? "\u001B[31m오류 " + (newestFirst.length - i) + "\u001B[39m" : null);
            out.add(r);
        }
        return out;
    }

    @Test
    void neverFailedIsNotADefect() {
        assertThat(DefectService.defectOf(item("a.spec.ts", "로그인", true, null), history("P", "P"))).isNull();
        assertThat(DefectService.defectOf(item("a.spec.ts", "로그인", true, null), List.of())).isNull();
    }

    @Test
    void latestFailureIsOpenAndCountsTheCurrentStreakOnly() {
        // 실행 1 실패 → 2 통과 → 3 실패 → 4 실패
        Defect d = DefectService.defectOf(item("a.spec.ts", "로그인", true, null), history("F", "F", "P", "F"));

        assertThat(d.status()).isEqualTo(DefectService.OPEN);
        assertThat(d.firstFailedExecutionId()).isEqualTo(3L);
        assertThat(d.failCount()).isEqualTo(2);
        assertThat(d.lastExecutionId()).isEqualTo(4L);
        assertThat(d.resolvedExecutionId()).isNull();
        assertThat(d.errorMessage()).isEqualTo("오류 4");
        assertThat(d.runs()).extracting(DefectRun::executionId, DefectRun::status)
                .containsExactly(tuple(3L, "FAILED"), tuple(4L, "FAILED"));
    }

    @Test
    void passAfterFailureResolves() {
        // 실행 1 실패 → 2 실패 → 3 통과 → 4 통과
        Defect d = DefectService.defectOf(item("a.spec.ts", "로그인", true, null), history("P", "P", "F", "F"));

        assertThat(d.status()).isEqualTo(DefectService.RESOLVED);
        assertThat(d.firstFailedExecutionId()).isEqualTo(1L);
        assertThat(d.failCount()).isEqualTo(2);
        assertThat(d.resolvedExecutionId()).isEqualTo(3L);
        assertThat(d.lastExecutionId()).isEqualTo(4L);
        assertThat(d.errorMessage()).isEqualTo("오류 2");
        assertThat(d.runs()).extracting(DefectRun::executionId).containsExactly(1L, 2L, 3L);
    }

    @Test
    void listKeepsEnabledItemsOpenFirstAndAddsScreens() {
        when(planService.tracked("p1")).thenReturn(List.of(
                new Tracked(item("tests/a.spec.ts", "해결됨", true, null), history("P", "F")),
                new Tracked(item("tests/a.spec.ts", "실패", true, 7L), history("F")),
                new Tracked(item("tests/b.spec.ts", "미사용 실패", false, null), history("F")),
                new Tracked(item("tests/b.spec.ts", "통과만", true, null), history("P"))));

        DefectResponse res = service.list("p1", null, null, null, null);

        assertThat(res.defects()).extracting(Defect::title, Defect::status)
                .containsExactly(tuple("실패", "OPEN"), tuple("해결됨", "RESOLVED"));
        assertThat(res.open()).isEqualTo(1);
        assertThat(res.resolved()).isEqualTo(1);
        assertThat(res.defects().get(0).routeKeys()).containsExactly("/login", "/cart");
    }

    @Test
    void filtersByStatusAssigneeAndScreen() {
        when(planService.tracked("p1")).thenReturn(List.of(
                new Tracked(item("tests/a.spec.ts", "가", true, 7L), history("F")),
                new Tracked(item("tests/b.spec.ts", "나", true, 8L), history("F")),
                new Tracked(item("tests/a.spec.ts", "다", true, 7L), history("P", "F"))));

        assertThat(service.list("p1", "OPEN", null, null, null).defects()).extracting(Defect::title).containsExactly("가", "나");
        assertThat(service.list("p1", null, 7L, null, null).defects()).extracting(Defect::title).containsExactly("가", "다");
        assertThat(service.list("p1", null, null, null, "/cart").defects()).extracting(Defect::title).containsExactly("가", "다");
        assertThatThrownBy(() -> service.list("p1", "CLOSED", null, null, null))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void filtersBySuiteFilesAndGrep() {
        TestSuite suite = new TestSuite();
        suite.setProjectId("p1");
        suite.setSpecPaths("[\"a.spec.ts\"]");
        suite.setGrep("결제|가");
        when(suiteRepository.findById(5L)).thenReturn(Optional.of(suite));
        TestSuite other = new TestSuite();
        other.setProjectId("p2");
        when(suiteRepository.findById(6L)).thenReturn(Optional.of(other));
        when(planService.tracked("p1")).thenReturn(List.of(
                new Tracked(item("tests/a.spec.ts", "가", true, null), history("F")),
                new Tracked(item("tests/a.spec.ts", "나", true, null), history("F")),
                new Tracked(item("tests/b.spec.ts", "가", true, null), history("F"))));

        assertThat(service.list("p1", null, null, 5L, null).defects())
                .extracting(Defect::specPath, Defect::title).containsExactly(tuple("tests/a.spec.ts", "가"));
        assertThatThrownBy(() -> service.list("p1", null, null, 6L, null)).isInstanceOf(ApiException.class);
    }

    @Test
    void noDefectsSkipsScreenLookup() {
        when(planService.tracked("p1")).thenReturn(List.of(new Tracked(item("a.spec.ts", "가", true, null), history("P"))));

        assertThat(service.list("p1", null, null, null, null).open()).isZero();
        verify(coverageService, never()).view("p1");
    }

    // ── 결함 다시 실행 (#82) ──

    private void threeDefects() {
        when(planService.tracked("p1")).thenReturn(List.of(
                new Tracked(item("tests/a.spec.ts", "로그인(관리자)", true, null), history("F", "P")),       // 실행 2 실패
                new Tracked(item("tests/b.spec.ts", "결제", true, null), history("F", "F", "F", "P")),       // 실행 4 실패
                new Tracked(item("tests/a.spec.ts", "해결됨", true, null), history("P", "F"))));            // 해결
    }

    @Test
    void rerunWithoutItemsRunsOpenDefectsInListOrderLinkedToTheLatestFailedRun() {
        threeDefects();

        service.rerun("p1", null);

        verify(executionQueryService).triggerRun(eq("p1"), eq(PlaywrightGrep.testTitle("tests/b.spec.ts", "결제") + "|" + PlaywrightGrep.testTitle("tests/a.spec.ts", "로그인(관리자)")), isNull(),
                eq(List.of("tests/b.spec.ts", "tests/a.spec.ts")), eq("결함 다시 실행 2건"), eq(false), eq(4L));
    }

    @Test
    void rerunOfPickedDefectsAllowsResolvedOnesAndRejectsCasesThatAreNotDefects() {
        threeDefects();

        service.rerun("p1", List.of(new ItemKey("tests/a.spec.ts", "해결됨")));
        verify(executionQueryService).triggerRun(eq("p1"), eq(PlaywrightGrep.testTitle("tests/a.spec.ts", "해결됨")), isNull(),
                eq(List.of("tests/a.spec.ts")), eq("결함 다시 실행 1건"), eq(false), eq(1L));

        assertThatThrownBy(() -> service.rerun("p1", List.of(new ItemKey("tests/a.spec.ts", "없는 케이스"))))
                .isInstanceOf(ApiException.class).hasMessageContaining("결함 목록에 없는");
    }

    @Test
    void rerunWithNothingOpenIsRejected() {
        when(planService.tracked("p1")).thenReturn(List.of(new Tracked(item("a.spec.ts", "가", true, null), history("P", "F"))));

        assertThatThrownBy(() -> service.rerun("p1", List.of())).isInstanceOf(ApiException.class)
                .hasMessageContaining("다시 실행할 결함이 없습니다");
        verify(executionQueryService, never()).triggerRun(anyString(), anyString(), any(), any(), anyString(), anyBoolean(), anyLong());
    }

    @Test
    void runsShowWhichRunWasARerun() {
        when(planService.tracked("p1")).thenReturn(List.of(new Tracked(item("tests/a.spec.ts", "가", true, null), history("P", "F"))));
        Execution rerun = mock(Execution.class);
        when(rerun.getId()).thenReturn(2L);
        when(rerun.getRerunOf()).thenReturn(1L);
        when(executionRepository.findAllById(any())).thenReturn(List.of(rerun));

        Defect d = service.list("p1", null, null, null, null).defects().get(0);

        assertThat(d.runs()).extracting(DefectRun::executionId, DefectRun::rerunOf)
                .containsExactly(tuple(1L, null), tuple(2L, 1L));
    }

    @Test
    void tooManyDefectsFallBackToFilesThenToTheWholePlanInsteadOfFailing() {
        String longName = "가".repeat(300);
        when(planService.tracked("p1")).thenReturn(List.of(
                new Tracked(item("tests/a.spec.ts", longName + "1", true, null), history("F")),
                new Tracked(item("tests/b.spec.ts", longName + "2", true, null), history("F"))));

        service.rerun("p1", null);
        // 이름이 칸(500자)을 넘으면 이름 없이 파일 단위로 — 더 돌 뿐 결과는 맞다
        verify(executionQueryService).triggerRun(eq("p1"), isNull(), isNull(),
                eq(List.of("tests/a.spec.ts", "tests/b.spec.ts")), eq("결함 다시 실행 2건"), eq(false), eq(1L));

        List<Tracked> many = new ArrayList<>();
        for (int i = 0; i < 40; i++) {
            many.add(new Tracked(item("tests/very/long/folder/name/case-" + i + ".spec.ts", "가", true, null), history("F")));
        }
        when(planService.tracked("p1")).thenReturn(many);
        service.rerun("p1", null);
        // 이름 · 파일 목록이 둘 다 넘치면 사용 중 전체를 돌린다 (더 돌 뿐 결과는 맞다)
        verify(executionQueryService).triggerRun(eq("p1"), isNull(), isNull(),
                eq(List.of()), eq("결함 다시 실행 40건"), eq(false), eq(1L));
    }
}
