package com.playops.api.service;

import com.playops.api.dto.PlanDtos.ItemKey;
import com.playops.api.dto.PlanDtos.ItemPatch;
import com.playops.api.dto.MemberDtos.Member;
import com.playops.api.entity.ProjectRole;
import com.playops.api.entity.Project;
import com.playops.api.entity.ScenarioCaseSetting;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.ScenarioCaseSettingRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDate;
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

/** 계획 표 저장: 행이 없으면 TEST 행을 만들고, 순서 · 일괄 사용 여부를 쓴다. */
class PlanServiceTest {

    private ScenarioCaseSettingRepository repository;
    private PlanService service;
    private ProjectMemberService members;

    @BeforeEach
    void setUp() {
        repository = mock(ScenarioCaseSettingRepository.class);
        ProjectService projectService = mock(ProjectService.class);
        when(projectService.getProject("p1")).thenReturn(new Project());
        when(repository.findByProjectIdAndNodeTypeAndSpecPathAndGrepFilter(anyString(), anyString(), anyString(), anyString()))
                .thenReturn(Optional.empty());
        members = mock(ProjectMemberService.class);
        service = new PlanService(mock(PlaywrightScenarioService.class), repository,
                mock(ExecutionCaseResultRepository.class), projectService, members);
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
