package com.playops.api.chat.tools;

import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolTier;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.repository.ExecutionCaseResultRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Pageable;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GetCaseHistoryToolTest {

    private final ExecutionCaseResultRepository repository = mock(ExecutionCaseResultRepository.class);
    private final GetCaseHistoryTool tool = new GetCaseHistoryTool(repository);

    private static ExecutionCaseResult result(long executionId, String title, String status, String error, String createdAt) {
        ExecutionCaseResult r = new ExecutionCaseResult();
        r.setExecutionId(executionId);
        r.setCaseTitle(title);
        r.setStatus(status);
        r.setErrorMessage(error);
        ReflectionTestUtils.setField(r, "createdAt", Instant.parse(createdAt));
        return r;
    }

    private static LlmToolCall call(Map<String, Object> args) {
        return new LlmToolCall("c1", "get_case_history", args);
    }

    private static ChatToolContext context() {
        return new ChatToolContext("p1", 7L, false, 1L);
    }

    private Pageable askedPage() {
        ArgumentCaptor<Pageable> page = ArgumentCaptor.forClass(Pageable.class);
        verify(repository).findRecentByProjectAndCaseTitle(eq("p1"), anyString(), page.capture());
        return page.getValue();
    }

    @Test
    void isAReadToolWithCaseNameRequired() {
        assertThat(tool.tier()).isEqualTo(ToolTier.READ);
        assertThat(tool.spec().name()).isEqualTo("get_case_history");
        assertThat(tool.spec().inputSchema().get("required")).isEqualTo(List.of("caseName"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void returnsExecutionTimeStatusAndTheFirstLineOfTheErrorAsATable() {
        when(repository.findRecentByProjectAndCaseTitle(eq("p1"), anyString(), any())).thenReturn(List.of(
                result(12, "로그인 성공", "FAILED", "Error: locator not found\n  at login.spec.ts:10\n  at ...", "2026-10-30T15:03:00Z"),
                result(11, "로그인 성공", "PASSED", null, "2026-10-29T01:00:00Z")));

        ChatToolOutput output = tool.execute(call(Map.of("caseName", "로그인")), context());

        assertThat(output.error()).isFalse();
        assertThat(output.summary()).isEqualTo("2건");
        assertThat(output.content()).isEqualTo(String.join("\n",
                "실행 | 케이스 | 시각(KST) | 상태 | 오류(첫 줄)",
                "#12 | 로그인 성공 | 2026-10-31 00:03 | FAILED | Error: locator not found",
                "#11 | 로그인 성공 | 2026-10-29 10:00 | PASSED | -"));

        assertThat(output.display().kind()).isEqualTo("table");
        Map<String, Object> data = output.display().data();
        assertThat(data.get("columns")).isEqualTo(List.of("실행", "케이스", "시각(KST)", "상태", "오류(첫 줄)"));
        assertThat((List<List<Object>>) data.get("rows")).containsExactly(
                List.of("#12", "로그인 성공", "2026-10-31 00:03", "FAILED", "Error: locator not found"),
                List.of("#11", "로그인 성공", "2026-10-29 10:00", "PASSED", ""));
        assertThat(data.get("truncated")).isEqualTo(false);
    }

    @Test
    void matchesPartOfTheNameIgnoringCaseWithinTheProject() {
        when(repository.findRecentByProjectAndCaseTitle(eq("p1"), anyString(), any())).thenReturn(List.of());

        tool.execute(call(Map.of("caseName", "Login")), context());

        verify(repository).findRecentByProjectAndCaseTitle(eq("p1"), eq("%login%"), any());
    }

    @Test
    void percentAndUnderscoreInTheNameAreSearchedAsPlainCharacters() {
        assertThat(GetCaseHistoryTool.likePattern("100%_done!")).isEqualTo("%100!%!_done!!%");
    }

    @Test
    void defaultsToTenResultsAndAsksForOneMoreToDetectMore() {
        when(repository.findRecentByProjectAndCaseTitle(eq("p1"), anyString(), any())).thenReturn(List.of());

        tool.execute(call(Map.of("caseName", "x")), context());

        assertThat(askedPage().getPageSize()).isEqualTo(11);
    }

    @Test
    void limitIsClampedToBetweenOneAndFifty() {
        when(repository.findRecentByProjectAndCaseTitle(eq("p1"), anyString(), any())).thenReturn(List.of());

        tool.execute(call(Map.of("caseName", "x", "limit", 3)), context());
        tool.execute(call(Map.of("caseName", "x", "limit", 1000)), context());
        tool.execute(call(Map.of("caseName", "x", "limit", 0)), context());
        tool.execute(call(Map.of("caseName", "x", "limit", "many")), context());

        ArgumentCaptor<Pageable> page = ArgumentCaptor.forClass(Pageable.class);
        verify(repository, org.mockito.Mockito.times(4)).findRecentByProjectAndCaseTitle(eq("p1"), anyString(), page.capture());
        assertThat(page.getAllValues()).extracting(Pageable::getPageSize).containsExactly(4, 51, 2, 11);
    }

    @Test
    void reportsThatThereAreMoreWhenTheRepositoryReturnsOneOverTheLimit() {
        List<ExecutionCaseResult> found = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            found.add(result(100 - i, "케이스", "FAILED", "e", "2026-10-30T00:00:00Z"));
        }
        when(repository.findRecentByProjectAndCaseTitle(eq("p1"), anyString(), any())).thenReturn(found);

        ChatToolOutput output = tool.execute(call(Map.of("caseName", "케이스", "limit", 3)), context());

        assertThat(output.summary()).isEqualTo("3건 이상");
        assertThat((List<?>) output.display().data().get("rows")).hasSize(3);
        assertThat(output.display().data().get("truncated")).isEqualTo(true);
        assertThat(output.content()).contains("더 오래된 결과가 있습니다");
    }

    @Test
    void noHistoryIsNotAnError() {
        when(repository.findRecentByProjectAndCaseTitle(eq("p1"), anyString(), any())).thenReturn(List.of());

        ChatToolOutput output = tool.execute(call(Map.of("caseName", "없는 케이스")), context());

        assertThat(output.error()).isFalse();
        assertThat(output.content()).contains("없는 케이스").contains("결과가 없습니다");
        assertThat(output.summary()).isEqualTo("0건");
        assertThat(output.display()).isNull();
    }

    @Test
    void aVeryLongErrorAndTitleAreShortened() {
        when(repository.findRecentByProjectAndCaseTitle(eq("p1"), anyString(), any())).thenReturn(List.of(
                result(1, "t".repeat(500), "FAILED", "e".repeat(1000), "2026-10-30T00:00:00Z")));

        ChatToolOutput output = tool.execute(call(Map.of("caseName", "t")), context());

        assertThat(output.content()).contains("t".repeat(120) + "…").doesNotContain("t".repeat(121));
        assertThat(output.content()).contains("e".repeat(200) + "…").doesNotContain("e".repeat(201));
    }

    @Test
    void missingCaseNameFails() {
        ChatToolOutput output = tool.execute(call(Map.of()), context());

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("caseName");
        verify(repository, never()).findRecentByProjectAndCaseTitle(anyString(), anyString(), any());
    }

    @Test
    void needsAProject() {
        ChatToolOutput output = tool.execute(call(Map.of("caseName", "x")), new ChatToolContext(null, 7L, false, 1L));

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("projectId");
        verify(repository, never()).findRecentByProjectAndCaseTitle(anyString(), anyString(), any());
    }

    @Test
    void aNonAdminCannotReadAnotherProjectsHistory() {
        ChatToolOutput output = tool.execute(call(Map.of("caseName", "x", "projectId", "someone-elses")), context());

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("다른 프로젝트");
        verify(repository, never()).findRecentByProjectAndCaseTitle(anyString(), anyString(), any());
    }
}
