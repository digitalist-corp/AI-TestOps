package com.playops.api.service;

import com.playops.api.dto.PlanDtos.EntryPatch;
import com.playops.api.dto.PlanDtos.EntryRequest;
import com.playops.api.dto.PlanDtos.LinkSuggestion;
import com.playops.api.dto.PlanDtos.PlanItem;
import com.playops.api.entity.AiJob;
import com.playops.api.entity.Project;
import com.playops.api.entity.PlanEntry;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.PlanEntryRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 계획 행 쓰기 · AI 생성 · 연결 추천 (계획 우선 흐름). */
class PlanEntryServiceTest {

    private PlanService planService;
    private PlanEntryRepository entries;
    private AiJobService aiJobs;
    private LlmGatewayService llm;
    private PlanEntryService service;

    @BeforeEach
    void setUp() {
        planService = mock(PlanService.class);
        entries = mock(PlanEntryRepository.class);
        when(entries.save(any())).thenAnswer(inv -> {
            PlanEntry e = inv.getArgument(0);
            if (e.getId() == null) e.setId(5L);
            return e;
        });
        ProjectService projects = mock(ProjectService.class);
        when(projects.getProject("p1")).thenReturn(new Project());
        aiJobs = mock(AiJobService.class);
        llm = mock(LlmGatewayService.class);
        service = new PlanEntryService(planService, entries, projects, aiJobs, llm);
    }

    private PlanEntry stored(long id, String title) {
        PlanEntry e = new PlanEntry();
        e.setId(id);
        e.setProjectId("p1");
        e.setTitle(title);
        when(planService.entry("p1", id)).thenReturn(e);
        return e;
    }

    private static PlanEntry linkedTo(PlanEntry e, String spec, String grep) {
        e.setSpecPath(spec);
        e.setGrepFilter(grep);
        return e;
    }

    private static EntryRequest request(String title) {
        return new EntryRequest(title, null, null, null, null, null);
    }

    private static PlanItem test(String spec, String title) {
        return new PlanItem(spec, title, title, "", 1, true, true, null, null, null, null, null,
                null, null, null, null, null, 0, null, null);
    }

    private static PlanItem plan(long id, String title) {
        return new PlanItem("", "", title, "", 0, true, true, null, null, null, null, null,
                null, null, null, null, null, 0, null, null, id, "UNWRITTEN", null, null, null, null);
    }

    private void tracked(PlanItem... items) {
        List<PlanService.Tracked> out = new ArrayList<>();
        for (PlanItem i : items) out.add(new PlanService.Tracked(i, List.of()));
        when(planService.tracked("p1")).thenReturn(out);
    }

    private static void assert400(Runnable call) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(400));
    }

    // ── 만들기 ──

    @Test
    void createReturnsAnUnwrittenRow() {
        when(planService.assigneeName("p1", 7L)).thenReturn("김윤재");

        PlanItem item = service.create("p1", new EntryRequest("  결제한다 ", "/pay", " 완료 문구 ", 7L,
                LocalDate.of(2026, 11, 24), "HIGH"));

        assertThat(item.planId()).isEqualTo(5L);
        assertThat(item.stage()).isEqualTo("UNWRITTEN");
        assertThat(item.title()).isEqualTo("결제한다");
        assertThat(item.specPath()).isEmpty();
        assertThat(item.screenRouteKey()).isEqualTo("/pay");
        assertThat(item.expected()).isEqualTo("완료 문구");
        assertThat(item.assignee()).isEqualTo("김윤재");
        assertThat(item.priority()).isEqualTo("HIGH");
        assertThat(item.enabled()).isTrue();
    }

    @Test
    void titlesThatPlaywrightCannotGrepExactlyAreRejected() {
        assert400(() -> service.create("p1", request(" ")));
        assert400(() -> service.create("p1", request("로그인 @smoke")));
        assert400(() -> service.create("p1", request("로그인\n한다")));
        assert400(() -> service.create("p1", request("가".repeat(201))));
        assert400(() -> service.create("p1", new EntryRequest("로그인", null, null, null, null, "URGENT")));
        verify(entries, never()).save(any());
    }

    @Test
    void assigneeMustBeAProjectMember() {
        when(planService.assigneeName("p1", 9L)).thenThrow(new ApiException(400, "VALIDATION_ERROR", "멤버 아님"));

        assert400(() -> service.create("p1", new EntryRequest("로그인", null, null, 9L, null, null)));
    }

    @Test
    void bulkCreatesAllOrNothing() {
        assertThat(service.createAll("p1", List.of(request("로그인"), request("검색")))).isEqualTo(2);

        assert400(() -> service.createAll("p1", List.of(request("로그인"), request("@태그"))));
        List<EntryRequest> tooMany = new ArrayList<>();
        for (int i = 0; i < 201; i++) tooMany.add(request("계획 " + i));
        assert400(() -> service.createAll("p1", tooMany));
        verify(entries, org.mockito.Mockito.times(1)).saveAll(any());
    }

    // ── 고치기 · 지우기 ──

    @Test
    void updatingAnUnwrittenRowOverwritesPlanColumns() {
        PlanEntry e = stored(5, "결제한다");
        e.setPriority("LOW");
        e.setAssignee("김윤재");
        e.setAssigneeUserId(7L);
        e.setAutoLink(false);

        service.update("p1", 5L, new EntryPatch("결제가 끝난다", "/pay", "문구", false, null, null, "HIGH"));

        assertThat(e.getTitle()).isEqualTo("결제가 끝난다");
        assertThat(e.getAutoLink()).isTrue();
        assertThat(e.getScreenRouteKey()).isEqualTo("/pay");
        assertThat(e.getExpected()).isEqualTo("문구");
        assertThat(e.getEnabled()).isFalse();
        assertThat(e.getPriority()).isEqualTo("HIGH");
        assertThat(e.getAssigneeUserId()).isNull();
        assertThat(e.getAssignee()).isNull();
        verify(entries).save(e);
    }

    @Test
    void writtenRowKeepsItsTitleAndIgnoresPlanColumns() {
        PlanEntry e = linkedTo(stored(5, "로그인"), "tests/a.spec.ts", "로그인");
        e.setPriority("LOW");

        assert400(() -> service.update("p1", 5L, new EntryPatch("로그아웃", null, null, null, null, null, null)));

        service.update("p1", 5L, new EntryPatch("로그인", "/login", "환영 문구", false, null, null, "HIGH"));
        assertThat(e.getScreenRouteKey()).isEqualTo("/login");
        assertThat(e.getExpected()).isEqualTo("환영 문구");
        assertThat(e.getPriority()).isEqualTo("LOW");
        assertThat(e.getEnabled()).isTrue();
    }

    @Test
    void deleteRemovesOnlyThePlanRow() {
        PlanEntry e = linkedTo(stored(5, "로그인"), "tests/a.spec.ts", "로그인");

        service.delete("p1", 5L);

        verify(entries).delete(e);
        verifyNoInteractions(aiJobs);
    }

    // ── 연결 ──

    @Test
    void linkingATestOfAnotherPlanIsAConflict() {
        stored(5, "로그인");
        PlanEntry other = linkedTo(stored(6, "로그인 확인"), "tests/a.spec.ts", "로그인");
        tracked(test("tests/a.spec.ts", "로그인"));
        when(entries.findByProjectIdOrderByIdAsc("p1")).thenReturn(List.of(other));

        assertThatThrownBy(() -> service.link("p1", 5L, "tests/a.spec.ts", "로그인"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(409));
        verify(planService, never()).link(anyString(), any(), anyString(), anyString());
    }

    @Test
    void linkingAFreeTestCopiesThroughPlanService() {
        PlanEntry e = stored(5, "결제");
        tracked(test("tests/a.spec.ts", "로그인"));
        when(entries.findByProjectIdOrderByIdAsc("p1")).thenReturn(List.of(e));

        service.link("p1", 5L, "tests/a.spec.ts", "로그인");

        verify(planService).link("p1", e, "tests/a.spec.ts", "로그인");
    }

    @Test
    void linkingAMissingTestIs404() {
        stored(5, "결제");
        tracked(test("tests/a.spec.ts", "로그인"));

        assertThatThrownBy(() -> service.link("p1", 5L, "tests/a.spec.ts", "검색"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(404));
    }

    // ── AI 생성 ──

    private AiJob job(long id) {
        AiJob job = new AiJob();
        ReflectionTestUtils.setField(job, "id", id);
        return job;
    }

    @Test
    void generateStartsATemplateJobForThePlansOwnFile() {
        PlanEntry e = stored(5, "결제한다");
        e.setExpected("결제 완료 문구가 보인다");
        e.setScreenRouteKey("/pay");
        when(aiJobs.createTemplateGenerateJob(eq("p1"), anyString(), anyString(), any(), eq(3L))).thenReturn(job(77));

        var res = service.generate("p1", 5L, 3L);

        ArgumentCaptor<String> instruction = ArgumentCaptor.forClass(String.class);
        verify(aiJobs).createTemplateGenerateJob(eq("p1"), eq("tests/plan/plan-5.spec.ts"), instruction.capture(),
                eq(List.of("/pay")), eq(3L));
        assertThat(instruction.getValue()).contains("결제한다").contains("결제 완료 문구가 보인다")
                .contains("test 하나만").contains("정확히 '결제한다'");
        assertThat(res.id()).isEqualTo(77L);
        assertThat(e.getAiJobId()).isEqualTo(77L);
        verify(entries).save(e);
    }

    @Test
    void generateWithoutScreenUsesAllScreens() {
        stored(5, "결제한다");
        when(aiJobs.createTemplateGenerateJob(any(), any(), any(), any(), any())).thenReturn(job(77));

        service.generate("p1", 5L, null);

        verify(aiJobs).createTemplateGenerateJob(eq("p1"), eq("tests/plan/plan-5.spec.ts"), anyString(), isNull(), isNull());
    }

    @Test
    void generatingAWrittenPlanIsAConflict() {
        linkedTo(stored(5, "로그인"), "tests/a.spec.ts", "로그인");

        assertThatThrownBy(() -> service.generate("p1", 5L, null))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(409));
        verifyNoInteractions(aiJobs);
    }

    @Test
    void bulkGenerateIsLimitedToTenAndChecksAllFirst() {
        stored(5, "결제한다");
        linkedTo(stored(6, "로그인"), "tests/a.spec.ts", "로그인");

        assert400(() -> service.generateAll("p1", List.of(1L, 2L, 3L, 4L, 5L, 6L, 7L, 8L, 9L, 10L, 11L), null));
        assertThatThrownBy(() -> service.generateAll("p1", List.of(5L, 6L), null))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(409));
        verifyNoInteractions(aiJobs);

        when(aiJobs.createTemplateGenerateJob(any(), any(), any(), any(), any())).thenReturn(job(77));
        stored(7, "검색한다");
        assertThat(service.generateAll("p1", List.of(5L, 7L, 5L), null)).hasSize(2);
    }

    // ── 연결 추천 ──

    @Test
    void noPairsNoModelCall() {
        tracked(plan(5, "결제"));
        assertThat(service.suggest("p1")).isEmpty();
        tracked(test("tests/a.spec.ts", "로그인"));
        assertThat(service.suggest("p1")).isEmpty();
        verifyNoInteractions(llm);
    }

    @Test
    void suggestionsKeepOnlyKnownPairsOnce() {
        tracked(plan(5, "로그인 확인"), plan(6, "검색"), test("tests/a.spec.ts", "로그인"), test("tests/b.spec.ts", "검색한다"));
        when(llm.chat(isNull(), anyString(), anyString(), anyString(), eq("p1"))).thenReturn("""
                답입니다.
                ```json
                {"suggestions":[
                  {"planId":5,"specPath":"tests/a.spec.ts","grep":"로그인","reason":"같은 화면"},
                  {"planId":5,"specPath":"tests/b.spec.ts","grep":"검색한다","reason":"중복 계획"},
                  {"planId":99,"specPath":"tests/b.spec.ts","grep":"검색한다","reason":"없는 계획"},
                  {"planId":"6","specPath":"tests/zz.spec.ts","grep":"검색한다","reason":"없는 파일"},
                  {"planId":"6","specPath":"tests/b.spec.ts","grep":"검색한다"}
                ]}
                ```""");

        List<LinkSuggestion> out = service.suggest("p1");

        assertThat(out).containsExactly(
                new LinkSuggestion(5L, "tests/a.spec.ts", "로그인", "로그인", "같은 화면"),
                new LinkSuggestion(6L, "tests/b.spec.ts", "검색한다", "검색한다", null));
    }

    @Test
    void unreadableAnswerGivesNoSuggestions() {
        tracked(plan(5, "로그인 확인"), test("tests/a.spec.ts", "로그인"));
        when(llm.chat(any(), anyString(), anyString(), anyString(), anyString())).thenReturn("짝이 없습니다 {not json");

        assertThat(service.suggest("p1")).isEmpty();
    }

    @Test
    void testsAlreadyInAPlanAreNotOffered() {
        PlanItem inPlan = new PlanItem("tests/a.spec.ts", "로그인", "로그인", "", 1, true, true, null, null, null, null, null,
                null, null, null, null, null, 0, null, null, 4L, "WRITTEN", null, null, null, null);
        tracked(plan(5, "로그인 확인"), inPlan);

        assertThat(service.suggest("p1")).isEmpty();
        verifyNoInteractions(llm);
    }

    @Test
    void unlinkDelegates() {
        PlanEntry e = linkedTo(stored(5, "로그인"), "tests/a.spec.ts", "로그인");
        service.unlink("p1", 5L);
        verify(planService).unlink("p1", e);
    }

    @Test
    void entryLookupIsScopedToTheProject() {
        when(planService.entry("p1", 8L)).thenThrow(new ApiException(404, "NOT_FOUND", "없음"));
        when(entries.findByIdAndProjectId(8L, "p1")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.delete("p1", 8L))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(404));
    }
}
