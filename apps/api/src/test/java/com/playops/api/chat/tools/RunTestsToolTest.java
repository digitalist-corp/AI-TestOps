package com.playops.api.chat.tools;

import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolTier;
import com.playops.api.dto.ExecutionResponse;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.service.ExecutionQueryService;
import com.playops.api.service.FileStorageService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RunTestsToolTest {

    @TempDir
    Path project;

    private final ExecutionQueryService executionQueryService = mock(ExecutionQueryService.class);
    private final FileStorageService fileStorageService = mock(FileStorageService.class);
    private final RunTestsTool tool = new RunTestsTool(executionQueryService, fileStorageService);

    @BeforeEach
    void projectFiles() throws IOException {
        Files.createDirectories(project.resolve("tests"));
        Files.writeString(project.resolve("tests/login.spec.ts"), "test('x', () => {});");
        when(fileStorageService.resolveFile(anyString(), anyString()))
                .thenAnswer(inv -> project.resolve((String) inv.getArgument(1)));
    }

    private static ExecutionResponse started(long id) {
        return new ExecutionResponse(id, "p1", ExecutionStatus.PENDING, null, null, null,
                0, 0, 0, 0, null, null, null, null, Instant.parse("2026-11-01T00:00:00Z"));
    }

    private static LlmToolCall call(Map<String, Object> args) {
        return new LlmToolCall("c1", "run_tests", args);
    }

    private static ChatToolContext context() {
        return new ChatToolContext("p1", 7L, false, 1L);
    }

    // ---- 정의 · 허락 문구 ----

    @Test
    void isARunToolSoTheLoopAsksForPermissionFirst() {
        assertThat(tool.tier()).isEqualTo(ToolTier.RUN);
        assertThat(tool.spec().name()).isEqualTo("run_tests");
        assertThat(tool.spec().inputSchema().get("required")).isEqualTo(List.of());
        @SuppressWarnings("unchecked")
        Map<String, Object> properties = (Map<String, Object>) tool.spec().inputSchema().get("properties");
        assertThat(properties).containsKeys("specPath", "grep", "projectId");
    }

    @Test
    void permissionReasonSaysExactlyWhatWillRun() {
        assertThat(tool.permissionReason(call(Map.of("specPath", "tests/login.spec.ts", "grep", "로그인 성공"))))
                .isEqualTo("spec tests/login.spec.ts 의 케이스 \"로그인 성공\" 를 실행합니다");
        assertThat(tool.permissionReason(call(Map.of("specPath", "tests/login.spec.ts"))))
                .isEqualTo("spec tests/login.spec.ts 의 모든 케이스를 실행합니다");
        assertThat(tool.permissionReason(call(Map.of("grep", "결제"))))
                .isEqualTo("이름에 \"결제\" 가 들어간 케이스를 실행합니다");
        assertThat(tool.permissionReason(call(Map.of())))
                .isEqualTo("프로젝트의 전체 테스트를 실행합니다");
    }

    @Test
    void blankArgumentsCountAsMissingInThePermissionReason() {
        assertThat(tool.permissionReason(call(Map.of("specPath", "  ", "grep", ""))))
                .isEqualTo("프로젝트의 전체 테스트를 실행합니다");
    }

    // ---- 실행 ----

    @Test
    void startsTheRunThroughTheSamePathAsTheManualRunButton() {
        when(executionQueryService.triggerRun("p1", "로그인 성공", "tests/login.spec.ts", null, "로그인 성공", false))
                .thenReturn(started(31));

        ChatToolOutput output = tool.execute(
                call(Map.of("specPath", "tests/login.spec.ts", "grep", "로그인 성공")), context());

        assertThat(output.error()).isFalse();
        assertThat(output.summary()).isEqualTo("실행 #31 시작");
        assertThat(output.content()).contains("실행 #31").contains("get_execution_detail");
        assertThat(output.display().kind()).isEqualTo("execution");
        assertThat(output.display().data()).containsExactly(
                Map.entry("executionId", 31L), Map.entry("status", "PENDING"), Map.entry("projectId", "p1"));
    }

    @Test
    void withoutArgumentsItRunsEverything() {
        when(executionQueryService.triggerRun("p1", null, null, null, null, false)).thenReturn(started(32));

        ChatToolOutput output = tool.execute(call(Map.of()), context());

        assertThat(output.error()).isFalse();
        verify(executionQueryService).triggerRun("p1", null, null, null, null, false);
        verify(fileStorageService, never()).resolveFile(anyString(), anyString());
    }

    @Test
    void windowsStyleSeparatorsInTheSpecPathAreNormalized() {
        when(executionQueryService.triggerRun(anyString(), any(), anyString(), any(), any(), anyBoolean()))
                .thenReturn(started(33));

        tool.execute(call(Map.of("specPath", "tests\\login.spec.ts")), context());

        verify(executionQueryService).triggerRun("p1", null, "tests/login.spec.ts", null, null, false);
    }

    // ---- 실패 ----

    @Test
    void aSpecFileThatDoesNotExistFailsBeforeStartingAnything() {
        ChatToolOutput output = tool.execute(call(Map.of("specPath", "tests/nope.spec.ts")), context());

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("tests/nope.spec.ts").contains("찾을 수 없습니다").contains("list_files");
        verify(executionQueryService, never()).triggerRun(anyString(), any(), any(), any(), any(), anyBoolean());
    }

    @Test
    void aPathOutsideTheProjectIsRefusedByTheFileStorageRules() {
        when(fileStorageService.resolveFile("p1", "../secret.ts"))
                .thenThrow(new ApiException(400, "PATH_NOT_ALLOWED", "Invalid file path"));

        ChatToolOutput output = tool.execute(call(Map.of("specPath", "../secret.ts")), context());

        assertThat(output.error()).isTrue();
        assertThat(output.content()).isEqualTo("Invalid file path");
        verify(executionQueryService, never()).triggerRun(anyString(), any(), any(), any(), any(), anyBoolean());
    }

    @Test
    void failuresToStartAreReportedNotThrown() {
        when(executionQueryService.triggerRun(anyString(), any(), any(), any(), any(), anyBoolean()))
                .thenThrow(new ApiException(429, "실행 대기열이 가득 찼습니다. 실행 중인 테스트가 끝난 뒤 다시 시도하세요."));

        ChatToolOutput output = tool.execute(call(Map.of()), context());

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("실행 대기열이 가득 찼습니다");
        assertThat(output.display()).isNull();
    }

    @Test
    void missingRequiredEnvironmentVariablesAreExplainedToTheModel() {
        when(executionQueryService.triggerRun(anyString(), any(), any(), any(), any(), anyBoolean()))
                .thenThrow(new ApiException(400, "테스트 계정 환경변수가 필요합니다. 환경변수를 먼저 입력하세요."));

        ChatToolOutput output = tool.execute(call(Map.of()), context());

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("환경변수");
    }

    @Test
    void needsAProject() {
        ChatToolOutput output = tool.execute(call(new HashMap<>()), new ChatToolContext(null, 7L, false, 1L));

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("projectId");
        verify(executionQueryService, never()).triggerRun(any(), any(), any(), any(), any(), anyBoolean());
    }

    @Test
    void aNonAdminCannotStartRunsInAnotherProject() {
        ChatToolOutput output = tool.execute(call(Map.of("projectId", "someone-elses")), context());

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("다른 프로젝트");
        verify(executionQueryService, never()).triggerRun(any(), any(), any(), any(), any(), anyBoolean());
    }

    @Test
    void anAdminMayRunInAnotherProject() {
        when(executionQueryService.triggerRun(eq("other"), isNull(), isNull(), isNull(), isNull(), anyBoolean()))
                .thenReturn(started(34));

        ChatToolOutput output = tool.execute(call(Map.of("projectId", "other")), new ChatToolContext("p1", 7L, true, 1L));

        assertThat(output.error()).isFalse();
        assertThat(output.display().data().get("projectId")).isEqualTo("other");
    }
}
