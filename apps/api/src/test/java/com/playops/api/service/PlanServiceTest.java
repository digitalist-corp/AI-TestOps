package com.playops.api.service;

import com.playops.api.dto.PlanDtos.ItemKey;
import com.playops.api.dto.PlanDtos.ItemPatch;
import com.playops.api.dto.PlanDtos.PlanItem;
import com.playops.api.dto.ScenarioCaseNode;
import com.playops.api.dto.ScenarioSpecFile;
import com.playops.api.dto.ScenarioTreeResponse;
import com.playops.api.dto.MemberDtos.Member;
import com.playops.api.dto.PlanDtos.ScreenProgress;
import com.playops.api.entity.AiJob;
import com.playops.api.entity.AiJobStatus;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.PlanEntry;
import com.playops.api.entity.ProjectRole;
import com.playops.api.entity.Project;
import com.playops.api.entity.ScenarioCaseSetting;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.AiJobRepository;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.PlanEntryRepository;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.repository.ScenarioCaseSettingRepository;
import com.playops.api.repository.TestSuiteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 계획 표 저장 및 결과 이력. */
class PlanServiceTest {

    private ScenarioCaseSettingRepository repository;
    private PlanService service;
    private ProjectMemberService members;
    private PlaywrightScenarioService scenarios;
    private ExecutionCaseResultRepository caseResults;
    private PlanEntryRepository entries;
    private AiJobRepository aiJobs;

    @BeforeEach
    void setUp() {
        repository = mock(ScenarioCaseSettingRepository.class);
        ProjectService projectService = mock(ProjectService.class);
        when(projectService.getProject("p1")).thenReturn(new Project());
        when(repository.findByProjectIdAndNodeTypeAndSpecPathAndGrepFilter(anyString(), anyString(), anyString(), anyString()))
                .thenReturn(Optional.empty());
        members = mock(ProjectMemberService.class);
        scenarios = mock(PlaywrightScenarioService.class);
        caseResults = mock(ExecutionCaseResultRepository.class);
        entries = mock(PlanEntryRepository.class);
        aiJobs = mock(AiJobRepository.class);
        service = new PlanService(scenarios, repository, caseResults, projectService, members, entries, aiJobs,
                mock(SiteCoverageService.class));
    }

    private PlanItem planItemWithHistory(boolean enabled, String... newestFirst) {
        var test = new ScenarioCaseNode("TEST", "로그인", "로그인", 1, "로그인", enabled, List.of());
        when(scenarios.analyze("p1")).thenReturn(new ScenarioTreeResponse("p1", 1, 1,
                List.of(new ScenarioSpecFile("tests/a.spec.ts", 1, true, List.of(test)))));
        List<ExecutionCaseResult> history = new ArrayList<>();
        for (int i = 0; i < newestFirst.length; i++) {
            long executionId = newestFirst.length - i;
            ExecutionCaseResult result = new ExecutionCaseResult();
            result.setExecutionId(executionId);
            result.setSpecPath("a.spec.ts");
            result.setCaseTitle("a.spec.ts > 로그인");
            result.setStatus(newestFirst[i]);
            ReflectionTestUtils.setField(result, "createdAt", Instant.ofEpochSecond(executionId));
            history.add(result);
        }
        when(caseResults.findEarlierInProject("p1", Long.MAX_VALUE)).thenReturn(history);
        return service.get("p1").items().getFirst();
    }

    @Test
    void noHistoryHasNoResultsOrDefect() {
        PlanItem item = planItemWithHistory(true);

        assertThat(item.lastStatus()).isNull();
        assertThat(item.lastRunAt()).isNull();
        assertThat(item.prevStatus()).isNull();
        assertThat(item.prevRunAt()).isNull();
        assertThat(item.defectStatus()).isNull();
        assertThat(item.defectFailCount()).isZero();
    }

    @Test
    void oneRunHasNoPreviousResult() {
        PlanItem item = planItemWithHistory(true, "PASSED");

        assertThat(item.lastStatus()).isEqualTo("PASSED");
        assertThat(item.lastRunAt()).isEqualTo(Instant.ofEpochSecond(1));
        assertThat(item.prevStatus()).isNull();
        assertThat(item.prevRunAt()).isNull();
        assertThat(item.defectStatus()).isNull();
        assertThat(item.defectFailCount()).isZero();
    }

    @Test
    void twoRunsExposePreviousResultAndPassingResolvesTheDefect() {
        PlanItem item = planItemWithHistory(true, "PASSED", "FAILED");

        assertThat(item.lastStatus()).isEqualTo("PASSED");
        assertThat(item.lastRunAt()).isEqualTo(Instant.ofEpochSecond(2));
        assertThat(item.prevStatus()).isEqualTo("FAILED");
        assertThat(item.prevRunAt()).isEqualTo(Instant.ofEpochSecond(1));
        assertThat(item.defectStatus()).isEqualTo(DefectService.RESOLVED);
        assertThat(item.defectFailCount()).isEqualTo(1);
    }

    @Test
    void openStreakMatchesDefectListForTheSameHistory() {
        PlanItem item = planItemWithHistory(true, "FAILED", "FAILED", "FAILED", "PASSED", "FAILED");
        SiteCoverageService coverage = mock(SiteCoverageService.class);
        when(coverage.view("p1")).thenReturn(new SiteCoverageService.Coverage(null, List.of(), List.of(), List.of()));
        DefectService defects = new DefectService(service, coverage, mock(TestSuiteRepository.class),
                mock(ExecutionRepository.class), mock(ExecutionQueryService.class));
        var defect = defects.list("p1", null, null, null, null).defects().getFirst();

        assertThat(item.defectStatus()).isEqualTo(DefectService.OPEN).isEqualTo(defect.status());
        assertThat(item.defectFailCount()).isEqualTo(3).isEqualTo(defect.failCount());
    }

    @Test
    void disabledItemRetainsResultsButHasNoDefect() {
        PlanItem item = planItemWithHistory(false, "FAILED", "PASSED");

        assertThat(item.lastStatus()).isEqualTo("FAILED");
        assertThat(item.prevStatus()).isEqualTo("PASSED");
        assertThat(item.defectStatus()).isNull();
        assertThat(item.defectFailCount()).isZero();
    }

    private List<ScenarioCaseSetting> saved(int count) {
        ArgumentCaptor<ScenarioCaseSetting> captor = ArgumentCaptor.forClass(ScenarioCaseSetting.class);
        verify(repository, times(count)).save(captor.capture());
        return captor.getAllValues();
    }

    @Test
    void patchCreatesTestRowWithPlanColumnsAndKeepsUsage() {
        service.patch("p1", new ItemPatch("tests/a.spec.ts", "로그인", null, "윤재", LocalDate.of(2026, 11, 24), "HIGH", null));

        ScenarioCaseSetting row = saved(1).get(0);
        assertThat(row.getNodeType()).isEqualTo("TEST");
        assertThat(row.getSpecPath()).isEqualTo("tests/a.spec.ts");
        assertThat(row.getGrepFilter()).isEqualTo("로그인");
        assertThat(row.getEnabled()).isTrue();
        assertThat(row.getAssignee()).isEqualTo("윤재");
        assertThat(row.getDueDate()).isEqualTo(LocalDate.of(2026, 11, 24));
        assertThat(row.getPriority()).isEqualTo("HIGH");
    }

    @Test
    void patchWithBlanksClearsPlanColumns() {
        ScenarioCaseSetting existing = new ScenarioCaseSetting();
        existing.setAssignee("윤재");
        existing.setPriority("LOW");
        existing.setEnabled(false);
        when(repository.findByProjectIdAndNodeTypeAndSpecPathAndGrepFilter("p1", "TEST", "a.spec.ts", "로그인"))
                .thenReturn(Optional.of(existing));

        service.patch("p1", new ItemPatch("a.spec.ts", "로그인", null, " ", null, "", null));

        ScenarioCaseSetting row = saved(1).get(0);
        assertThat(row.getAssignee()).isNull();
        assertThat(row.getPriority()).isNull();
        assertThat(row.getEnabled()).isFalse();
    }

    @Test
    void patchRejectsUnknownPriority() {
        assertThatThrownBy(() -> service.patch("p1", new ItemPatch("a.spec.ts", "로그인", null, null, null, "URGENT", null)))
                .isInstanceOf(ApiException.class);
        verify(repository, never()).save(any());
    }

    @Test
    void patchRejectsPathEscape() {
        assertThatThrownBy(() -> service.patch("p1", new ItemPatch("../etc/a.spec.ts", "로그인", true, null, null, null, null)))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void reorderWritesZeroBasedOrder() {
        service.reorder("p1", List.of(new ItemKey("b.spec.ts", "검색"), new ItemKey("a.spec.ts", "로그인")));

        List<ScenarioCaseSetting> rows = saved(2);
        assertThat(rows).extracting(ScenarioCaseSetting::getSpecPath, ScenarioCaseSetting::getSortOrder)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("b.spec.ts", 0),
                        org.assertj.core.groups.Tuple.tuple("a.spec.ts", 1));
    }

    @Test
    void bulkEnabledUpdatesEveryKey() {
        service.setEnabled("p1", List.of(new ItemKey("a.spec.ts", "1"), new ItemKey("a.spec.ts", "2"),
                new ItemKey("b.spec.ts", "3")), false);

        assertThat(saved(3)).allMatch(row -> !row.getEnabled());
        verify(repository).findByProjectIdAndNodeTypeAndSpecPathAndGrepFilter(eq("p1"), eq("TEST"), eq("b.spec.ts"), eq("3"));
    }

    @Test
    void patchLinksAProjectMemberAsAssignee() {
        when(members.list("p1")).thenReturn(List.of(new Member(7L, "kim", "김윤재", ProjectRole.MEMBER)));

        service.patch("p1", new ItemPatch("a.spec.ts", "로그인", null, null, null, null, 7L));

        ScenarioCaseSetting row = saved(1).get(0);
        assertThat(row.getAssigneeUserId()).isEqualTo(7L);
        assertThat(row.getAssignee()).isEqualTo("김윤재");
    }

    @Test
    void patchRejectsAnAssigneeWhoIsNotAMember() {
        when(members.list("p1")).thenReturn(List.of(new Member(7L, "kim", null, ProjectRole.MEMBER)));

        assertThatThrownBy(() -> service.patch("p1", new ItemPatch("a.spec.ts", "로그인", null, null, null, null, 9L)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(400));
        verify(repository, never()).save(any());
    }

    @Test
    void patchWithoutAccountKeepsTheOldTextAssignee() {
        ScenarioCaseSetting existing = new ScenarioCaseSetting();
        existing.setAssignee("홍길동");
        existing.setAssigneeUserId(7L);
        when(repository.findByProjectIdAndNodeTypeAndSpecPathAndGrepFilter("p1", "TEST", "a.spec.ts", "로그인"))
                .thenReturn(Optional.of(existing));

        service.patch("p1", new ItemPatch("a.spec.ts", "로그인", null, "홍길동", null, null, null));

        ScenarioCaseSetting row = saved(1).get(0);
        assertThat(row.getAssigneeUserId()).isNull();
        assertThat(row.getAssignee()).isEqualTo("홍길동");
    }

    // ── 계획 우선 흐름: 계획 행 · 자동 연결 ──

    private static PlanEntry entry(long id, String title) {
        PlanEntry e = new PlanEntry();
        e.setId(id);
        e.setProjectId("p1");
        e.setTitle(title);
        return e;
    }

    /** specAndTitles: 파일 경로, 테스트 제목, 파일 경로, 테스트 제목 ... (파일마다 테스트 하나) */
    private void cases(String... specAndTitles) {
        List<ScenarioSpecFile> specs = new ArrayList<>();
        for (int i = 0; i < specAndTitles.length; i += 2) {
            String title = specAndTitles[i + 1];
            specs.add(new ScenarioSpecFile(specAndTitles[i], 1, true,
                    List.of(new ScenarioCaseNode("TEST", title, title, 3, title, true, List.of()))));
        }
        when(scenarios.analyze("p1")).thenReturn(new ScenarioTreeResponse("p1", specs.size(), specs.size(), specs));
    }

    private PlanItem byPlan(List<PlanItem> items, long planId) {
        return items.stream().filter(i -> Long.valueOf(planId).equals(i.planId())).findFirst().orElseThrow();
    }

    @Test
    void unlinkedPlanShowsAsUnwrittenRowWithItsAiJob() {
        cases("tests/a.spec.ts", "로그인");
        PlanEntry e = entry(5, "결제한다");
        e.setExpected("결제 완료 문구가 보인다");
        e.setScreenRouteKey("/pay");
        e.setAiJobId(9L);
        e.setPriority("HIGH");
        when(entries.findByProjectIdOrderByIdAsc("p1")).thenReturn(List.of(e));
        AiJob job = new AiJob();
        ReflectionTestUtils.setField(job, "id", 9L);
        job.setStatus(AiJobStatus.NEEDS_REVIEW);
        when(aiJobs.findAllById(List.of(9L))).thenReturn(List.of(job));

        var plan = service.get("p1");

        PlanItem row = byPlan(plan.items(), 5);
        assertThat(row.stage()).isEqualTo("UNWRITTEN");
        assertThat(row.specPath()).isEmpty();
        assertThat(row.grep()).isEmpty();
        assertThat(row.describePath()).isEmpty();
        assertThat(row.line()).isZero();
        assertThat(row.title()).isEqualTo("결제한다");
        assertThat(row.parentEnabled()).isTrue();
        assertThat(row.lastStatus()).isNull();
        assertThat(row.defectStatus()).isNull();
        assertThat(row.priority()).isEqualTo("HIGH");
        assertThat(row.screenRouteKey()).isEqualTo("/pay");
        assertThat(row.expected()).isEqualTo("결제 완료 문구가 보인다");
        assertThat(row.aiJobId()).isEqualTo(9L);
        assertThat(row.aiJobStatus()).isEqualTo("NEEDS_REVIEW");
        assertThat(plan.items().getFirst().planId()).isEqualTo(5L); // 순서 없는 행 중 미작성이 먼저
        PlanItem test = plan.items().get(1);
        assertThat(test.planId()).isNull();
        assertThat(test.stage()).isEqualTo("WRITTEN");
        assertThat(plan.summary().unwritten()).isEqualTo(1);
        assertThat(plan.screens()).extracting(ScreenProgress::routeKey).containsExactly("/pay");
        verify(repository, never()).save(any());
    }

    @Test
    void planAutoLinksTheOnlyTestWithTheSameTitleAndCopiesPlanColumns() {
        cases("tests/a.spec.ts", "로그인", "tests/b.spec.ts", "검색");
        PlanEntry e = entry(5, " 로그인 ");
        e.setAssignee("김윤재");
        e.setAssigneeUserId(7L);
        e.setPriority("HIGH");
        e.setSortOrder(2);
        e.setEnabled(false);
        e.setDueDate(LocalDate.of(2026, 11, 24));
        e.setScreenRouteKey("/login");
        when(entries.findByProjectIdOrderByIdAsc("p1")).thenReturn(List.of(e));

        List<PlanItem> items = service.get("p1").items();

        assertThat(e.getSpecPath()).isEqualTo("tests/a.spec.ts");
        assertThat(e.getGrepFilter()).isEqualTo("로그인");
        verify(entries).save(e);
        ScenarioCaseSetting row = saved(1).get(0);
        assertThat(row.getSpecPath()).isEqualTo("tests/a.spec.ts");
        assertThat(row.getAssigneeUserId()).isEqualTo(7L);
        assertThat(row.getAssignee()).isEqualTo("김윤재");
        assertThat(row.getPriority()).isEqualTo("HIGH");
        assertThat(row.getSortOrder()).isEqualTo(2);
        assertThat(row.getEnabled()).isFalse();
        assertThat(row.getDueDate()).isEqualTo(LocalDate.of(2026, 11, 24));
        assertThat(items).hasSize(2);
        PlanItem linked = byPlan(items, 5);
        assertThat(linked.stage()).isEqualTo("WRITTEN");
        assertThat(linked.specPath()).isEqualTo("tests/a.spec.ts");
        assertThat(linked.priority()).isEqualTo("HIGH");
        assertThat(linked.screenRouteKey()).isEqualTo("/login");
    }

    @Test
    void twoTestsWithTheSameTitleAreNotAutoLinked() {
        cases("tests/a.spec.ts", "로그인", "tests/b.spec.ts", "로그인");
        PlanEntry e = entry(5, "로그인");
        when(entries.findByProjectIdOrderByIdAsc("p1")).thenReturn(List.of(e));

        List<PlanItem> items = service.get("p1").items();

        assertThat(e.isLinked()).isFalse();
        assertThat(byPlan(items, 5).stage()).isEqualTo("UNWRITTEN");
        assertThat(items).hasSize(3);
        verify(repository, never()).save(any());
    }

    @Test
    void amongSameTitledTestsThePlansOwnAiFileWins() {
        cases("tests/a.spec.ts", "로그인", "tests/plan/plan-5.spec.ts", "로그인");
        PlanEntry e = entry(5, "로그인");
        when(entries.findByProjectIdOrderByIdAsc("p1")).thenReturn(List.of(e));

        service.get("p1");

        assertThat(e.getSpecPath()).isEqualTo("tests/plan/plan-5.spec.ts");
    }

    @Test
    void aTestAlreadyLinkedToAnotherPlanIsNotAutoLinked() {
        cases("tests/a.spec.ts", "로그인");
        PlanEntry first = entry(5, "로그인");
        first.setSpecPath("tests/a.spec.ts");
        first.setGrepFilter("로그인");
        PlanEntry second = entry(6, "로그인");
        when(entries.findByProjectIdOrderByIdAsc("p1")).thenReturn(List.of(first, second));

        List<PlanItem> items = service.get("p1").items();

        assertThat(second.isLinked()).isFalse();
        assertThat(byPlan(items, 5).stage()).isEqualTo("WRITTEN");
        assertThat(byPlan(items, 6).stage()).isEqualTo("UNWRITTEN");
        verify(entries, never()).save(any());
    }

    @Test
    void aPlanUnlinkedByAPersonIsNotAutoLinkedAgain() {
        cases("tests/a.spec.ts", "로그인");
        PlanEntry e = entry(5, "로그인");
        e.setAutoLink(false);
        when(entries.findByProjectIdOrderByIdAsc("p1")).thenReturn(List.of(e));

        service.get("p1");

        assertThat(e.isLinked()).isFalse();
    }

    @Test
    void unlinkCopiesPlanColumnsBackAndStopsAutoLink() {
        PlanEntry e = entry(5, "로그인");
        e.setSpecPath("tests/a.spec.ts");
        e.setGrepFilter("로그인");
        ScenarioCaseSetting row = new ScenarioCaseSetting();
        row.setAssignee("김윤재");
        row.setAssigneeUserId(7L);
        row.setPriority("LOW");
        row.setSortOrder(4);
        row.setEnabled(false);
        when(repository.findByProjectIdAndNodeTypeAndSpecPathAndGrepFilter("p1", "TEST", "tests/a.spec.ts", "로그인"))
                .thenReturn(Optional.of(row));

        service.unlink("p1", e);

        assertThat(e.isLinked()).isFalse();
        assertThat(e.getAutoLink()).isFalse();
        assertThat(e.getAssigneeUserId()).isEqualTo(7L);
        assertThat(e.getAssignee()).isEqualTo("김윤재");
        assertThat(e.getPriority()).isEqualTo("LOW");
        assertThat(e.getSortOrder()).isEqualTo(4);
        assertThat(e.getEnabled()).isFalse();
        verify(entries).save(e);
    }

    @Test
    void reorderPutsCasesAndUnwrittenPlansOnOneAxis() {
        PlanEntry e = entry(5, "결제한다");
        when(entries.findByIdAndProjectId(5L, "p1")).thenReturn(Optional.of(e));

        service.reorder("p1", List.of(new ItemKey(null, null, 5L), new ItemKey("a.spec.ts", "로그인")));

        assertThat(e.getSortOrder()).isZero();
        verify(entries).save(e);
        assertThat(saved(1).get(0).getSortOrder()).isEqualTo(1);
    }

    @Test
    void bulkEnabledOnALinkedPlanChangesItsTestRow() {
        PlanEntry e = entry(5, "로그인");
        e.setSpecPath("tests/a.spec.ts");
        e.setGrepFilter("로그인");
        when(entries.findByIdAndProjectId(5L, "p1")).thenReturn(Optional.of(e));

        service.setEnabled("p1", List.of(new ItemKey("", null, 5L)), false);

        ScenarioCaseSetting row = saved(1).get(0);
        assertThat(row.getSpecPath()).isEqualTo("tests/a.spec.ts");
        assertThat(row.getEnabled()).isFalse();
        verify(entries, never()).save(any());
    }

    @Test
    void unknownPlanIdIs404() {
        assertThatThrownBy(() -> service.setEnabled("p1", List.of(new ItemKey(null, null, 99L)), false))
                .isInstanceOfSatisfying(ApiException.class, ex -> assertThat(ex.getStatus()).isEqualTo(404));
    }

    /** 해제로 꺼진 자동 연결은 사람이 다시 이으면(PUT link) 다시 켜진다. */
    @Test
    void manualLinkTurnsAutoLinkBackOn() {
        PlanEntry e = entry(5, "로그인");
        e.setAutoLink(false);

        service.link("p1", e, "tests/a.spec.ts", "로그인");

        assertThat(e.getAutoLink()).isTrue();
        assertThat(e.getSpecPath()).isEqualTo("tests/a.spec.ts");
        verify(entries).save(e);
    }

    /** 해제 → 다음 조회: 같은 제목의 테스트가 하나뿐이어도 다시 붙지 않는다. */
    @Test
    void unlinkThenReadDoesNotRelink() {
        cases("tests/a.spec.ts", "로그인");
        PlanEntry e = entry(5, "로그인");
        e.setSpecPath("tests/a.spec.ts");
        e.setGrepFilter("로그인");
        when(entries.findByProjectIdOrderByIdAsc("p1")).thenReturn(List.of(e));

        service.unlink("p1", e);
        List<PlanItem> items = service.get("p1").items();

        assertThat(e.isLinked()).isFalse();
        assertThat(byPlan(items, 5).stage()).isEqualTo("UNWRITTEN");
        verify(repository, never()).save(any());
    }
}
