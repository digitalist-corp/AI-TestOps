package com.playops.api.chat.tools;

import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolTier;
import com.playops.api.dto.ExecutionLogResponse;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.service.ExecutionLogService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SearchLogsToolTest {

    private final ExecutionRepository executions = mock(ExecutionRepository.class);
    private final ExecutionLogService logs = mock(ExecutionLogService.class);
    private final SearchLogsTool tool = new SearchLogsTool(executions, logs);

    private static Execution execution(long id, String projectId, ExecutionStatus status) {
        Execution e = new Execution();
        ReflectionTestUtils.setField(e, "id", id);
        e.setProjectId(projectId);
        e.setStatus(status);
        return e;
    }

    private void log(long executionId, String content) {
        when(logs.readLog(executionId, 0)).thenReturn(new ExecutionLogResponse(content, content.length(), true, "FAILED"));
    }

    private static LlmToolCall call(Map<String, Object> args) {
        return new LlmToolCall("c1", "search_logs", args);
    }

    private static ChatToolContext context(boolean admin) {
        return new ChatToolContext("p1", 7L, admin, 1L);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, String>> items(ChatToolOutput output) {
        return (List<Map<String, String>>) output.display().data().get("items");
    }

    @Test
    void isAReadTool() {
        assertThat(tool.tier()).isEqualTo(ToolTier.READ);
        assertThat(tool.spec().name()).isEqualTo("search_logs");
        assertThat(tool.spec().inputSchema().get("required")).isEqualTo(List.of("query"));
    }

    @Test
    void showsMatchesWithTwoLinesOfContextOnEachSide() {
        when(executions.findById(12L)).thenReturn(Optional.of(execution(12, "p1", ExecutionStatus.FAILED)));
        log(12, "l1\nl2\nl3\nl4\nTimeout 30000ms exceeded\nl6\nl7\nl8\nl9\nl10");

        ChatToolOutput output = tool.execute(call(Map.of("query", "timeout", "executionId", 12)), context(false));

        assertThat(output.error()).isFalse();
        assertThat(output.content()).isEqualTo(
                "== 실행 #12 (FAILED) ==\n3- l3\n4- l4\n5: Timeout 30000ms exceeded\n6- l6\n7- l7");
        assertThat(output.summary()).isEqualTo("1건");
        assertThat(output.display().kind()).isEqualTo("list");
        assertThat(items(output)).containsExactly(
                Map.of("label", "실행 #12 · 5번째 줄", "detail", "Timeout 30000ms exceeded"));
    }

    @Test
    void mergesOverlappingContextAndSeparatesDistantGroups() {
        when(executions.findById(5L)).thenReturn(Optional.of(execution(5, "p1", ExecutionStatus.FAILED)));
        log(5, "a\nERR one\nb\nERR two\nc\nd\ne\nf\ng\nERR three\nh");

        ChatToolOutput output = tool.execute(call(Map.of("query", "err", "executionId", 5)), context(false));

        assertThat(output.content()).isEqualTo(String.join("\n",
                "== 실행 #5 (FAILED) ==",
                "1- a", "2: ERR one", "3- b", "4: ERR two", "5- c", "6- d",
                "--",
                "8- f", "9- g", "10: ERR three", "11- h"));
        assertThat(output.summary()).isEqualTo("3건");
    }

    @Test
    void searchIsCaseInsensitive() {
        when(executions.findById(5L)).thenReturn(Optional.of(execution(5, "p1", ExecutionStatus.FAILED)));
        log(5, "locator.CLICK failed");

        assertThat(tool.execute(call(Map.of("query", "Locator.click", "executionId", 5)), context(false)).summary())
                .isEqualTo("1건");
    }

    @Test
    void withoutAnExecutionIdItSearchesTheFiveMostRecentExecutionsOfTheProject() {
        when(executions.findTop5ByProjectIdOrderByCreatedAtDesc("p1")).thenReturn(List.of(
                execution(12, "p1", ExecutionStatus.FAILED), execution(11, "p1", ExecutionStatus.PASSED)));
        log(12, "boom happened");
        log(11, "all good");

        ChatToolOutput output = tool.execute(call(Map.of("query", "boom")), context(false));

        assertThat(output.content()).isEqualTo("== 실행 #12 (FAILED) ==\n1: boom happened");
        verify(executions, never()).findById(org.mockito.ArgumentMatchers.anyLong());
    }

    @Test
    void severalExecutionsEachGetTheirOwnHeader() {
        when(executions.findTop5ByProjectIdOrderByCreatedAtDesc("p1")).thenReturn(List.of(
                execution(12, "p1", ExecutionStatus.FAILED), execution(11, "p1", ExecutionStatus.ERROR)));
        log(12, "boom A");
        log(11, "boom B");

        ChatToolOutput output = tool.execute(call(Map.of("query", "boom")), context(false));

        assertThat(output.content()).isEqualTo(
                "== 실행 #12 (FAILED) ==\n1: boom A\n== 실행 #11 (ERROR) ==\n1: boom B");
        assertThat(items(output)).extracting(m -> m.get("label"))
                .containsExactly("실행 #12 · 1번째 줄", "실행 #11 · 1번째 줄");
    }

    @Test
    void noMatchSaysWhichExecutionsWereSearched() {
        when(executions.findTop5ByProjectIdOrderByCreatedAtDesc("p1")).thenReturn(List.of(
                execution(12, "p1", ExecutionStatus.FAILED), execution(11, "p1", ExecutionStatus.PASSED)));
        log(12, "nothing here");
        log(11, "nor here");

        ChatToolOutput output = tool.execute(call(Map.of("query", "boom")), context(false));

        assertThat(output.error()).isFalse();
        assertThat(output.content()).isEqualTo("맞는 줄이 없습니다. (검색한 실행: #12, #11)");
        assertThat(output.summary()).isEqualTo("0건");
        assertThat(output.display()).isNull();
    }

    @Test
    void noExecutionsYetIsNotAnError() {
        when(executions.findTop5ByProjectIdOrderByCreatedAtDesc("p1")).thenReturn(List.of());

        ChatToolOutput output = tool.execute(call(Map.of("query", "boom")), context(false));

        assertThat(output.error()).isFalse();
        assertThat(output.content()).contains("실행 기록이 없습니다");
    }

    @Test
    void stopsAtEightyLogLines() {
        when(executions.findById(5L)).thenReturn(Optional.of(execution(5, "p1", ExecutionStatus.FAILED)));
        List<String> lines = new ArrayList<>();
        for (int i = 0; i < 200; i++) {
            lines.add("hit " + i);
        }
        log(5, String.join("\n", lines));

        ChatToolOutput output = tool.execute(call(Map.of("query", "hit", "executionId", 5)), context(false));

        long logLines = output.content().lines().filter(l -> l.matches("\\d+: hit \\d+")).count();
        assertThat(logLines).isEqualTo(80);
        assertThat(output.content()).contains("80줄에서 멈췄습니다").contains("80: hit 79").doesNotContain("81: hit 80");
        assertThat(output.summary()).isEqualTo("80건");
    }

    @Test
    void fallsBackToTheLogSavedOnTheExecutionWhenTheLogFileIsEmpty() {
        Execution e = execution(5, "p1", ExecutionStatus.FAILED);
        e.setLogOutput("saved copy: boom");
        when(executions.findById(5L)).thenReturn(Optional.of(e));
        log(5, "");

        ChatToolOutput output = tool.execute(call(Map.of("query", "boom", "executionId", 5)), context(false));

        assertThat(output.content()).contains("saved copy: boom");
    }

    @Test
    void fallsBackToTheSavedLogWhenReadingTheFileFails() {
        Execution e = execution(5, "p1", ExecutionStatus.FAILED);
        e.setLogOutput("saved copy: boom");
        when(executions.findById(5L)).thenReturn(Optional.of(e));
        when(logs.readLog(5L, 0)).thenThrow(new ApiException(500, "Failed to read log"));

        ChatToolOutput output = tool.execute(call(Map.of("query", "boom", "executionId", 5)), context(false));

        assertThat(output.error()).isFalse();
        assertThat(output.content()).contains("saved copy: boom");
    }

    // ---- 인자 · 범위 ----

    @Test
    void missingQueryFails() {
        ChatToolOutput output = tool.execute(call(Map.of()), context(false));

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("query");
    }

    @Test
    void aNonNumericExecutionIdFails() {
        ChatToolOutput output = tool.execute(call(Map.of("query", "x", "executionId", "latest")), context(false));

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("executionId");
    }

    @Test
    void anUnknownExecutionFails() {
        when(executions.findById(99L)).thenReturn(Optional.empty());

        ChatToolOutput output = tool.execute(call(Map.of("query", "x", "executionId", 99)), context(false));

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("#99");
    }

    @Test
    void aNonAdminCannotReadAnotherProjectsExecution() {
        when(executions.findById(40L)).thenReturn(Optional.of(execution(40, "someone-elses", ExecutionStatus.FAILED)));
        log(40, "secret boom");

        ChatToolOutput output = tool.execute(call(Map.of("query", "boom", "executionId", 40)), context(false));

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("이 프로젝트의 실행이 아닙니다");
        verify(logs, never()).readLog(org.mockito.ArgumentMatchers.anyLong(), org.mockito.ArgumentMatchers.anyLong());
    }

    @Test
    void anAdminMayReadAnyExecution() {
        when(executions.findById(40L)).thenReturn(Optional.of(execution(40, "other", ExecutionStatus.FAILED)));
        log(40, "boom");

        ChatToolOutput output = tool.execute(call(Map.of("query", "boom", "executionId", 40)), context(true));

        assertThat(output.error()).isFalse();
        assertThat(output.summary()).isEqualTo("1건");
    }

    @Test
    void searchingRecentRunsNeedsAProject() {
        ChatToolOutput output = tool.execute(call(Map.of("query", "boom")), new ChatToolContext(null, 7L, false, 1L));

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("projectId");
        verify(executions, never()).findTop5ByProjectIdOrderByCreatedAtDesc(anyString());
    }

    @Test
    void aNonAdminCannotAskForAnotherProjectsRecentRuns() {
        ChatToolOutput output = tool.execute(
                call(Map.of("query", "boom", "projectId", "someone-elses")), context(false));

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("다른 프로젝트");
        verify(executions, never()).findTop5ByProjectIdOrderByCreatedAtDesc(anyString());
    }
}
