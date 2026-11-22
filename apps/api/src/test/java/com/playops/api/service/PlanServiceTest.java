package com.playops.api.service;

import com.playops.api.dto.PlanDtos.ItemKey;
import com.playops.api.dto.PlanDtos.ItemPatch;
import com.playops.api.dto.PlanDtos.PlanItem;
import com.playops.api.dto.ScenarioCaseNode;
import com.playops.api.dto.ScenarioSpecFile;
import com.playops.api.dto.ScenarioTreeResponse;
import com.playops.api.dto.MemberDtos.Member;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.ProjectRole;
import com.playops.api.entity.Project;
import com.playops.api.entity.ScenarioCaseSetting;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ExecutionCaseResultRepository;
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
        service = new PlanService(scenarios, repository, caseResults, projectService, members);
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
}
