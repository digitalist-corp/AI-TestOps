package com.playops.api.chat.tools;

import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolTier;
import com.playops.api.entity.Project;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.service.ProjectService;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.entry;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class SetEnvVariablesToolTest {

    private final ProjectService projectService = mock(ProjectService.class);
    private final SetEnvVariablesTool tool = new SetEnvVariablesTool(projectService);

    @Test
    void specAndTier() {
        assertThat(tool.spec().name()).isEqualTo("set_env_variables");
        // 기존 값을 바로 덮어쓰므로 허락을 받는다 (CHANGE 는 허락 없이 승인 대기 작업만 만드는 단계)
        assertThat(tool.tier()).isEqualTo(ToolTier.RUN);
        assertThat(tool.spec().description()).contains("비밀번호", "다시 쓰지 말");
    }

    @Test
    void redactInputMasksLoginPasswordAndKeepsTheRest() {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("loginId", "standard_user");
        input.put("loginPassword", "secret_sauce");
        input.put("loginPath", "/login");
        input.put("projectId", "demo-proj");

        Map<String, Object> shown = tool.redactInput(input);

        assertThat(shown).containsExactly(
                entry("loginId", "standard_user"),
                entry("loginPassword", "***"),
                entry("loginPath", "/login"),
                entry("projectId", "demo-proj"));
        // 원본은 그대로 (실행에 쓰인다)
        assertThat(input).containsEntry("loginPassword", "secret_sauce");
    }

    @Test
    void redactInputMasksSecretKeysInVariablesLines() {
        Map<String, Object> shown = tool.redactInput(Map.of(
                "variables", "BASE_URL=https://example.com\napi_key=xyz\nDB_Password=pw1, AUTH_TOKEN=t0k, client_secret=s3"));

        assertThat(shown.get("variables")).isEqualTo(
                "BASE_URL=https://example.com\napi_key=***\nDB_Password=***\nAUTH_TOKEN=***\nclient_secret=***");
    }

    @Test
    void redactInputMasksSecretKeysInJsonVariables() {
        Map<String, Object> shown = tool.redactInput(Map.of(
                "variables", "{\"BASE_URL\":\"https://example.com\",\"ADMIN_PASSWORD\":\"pw1\",\"auth\":{\"token\":\"t0k\",\"mode\":\"x\"}}"));

        String variables = (String) shown.get("variables");
        assertThat(variables).contains("\"BASE_URL\":\"https://example.com\"", "\"ADMIN_PASSWORD\":\"***\"",
                "\"token\":\"***\"", "\"mode\":\"x\"");
        assertThat(variables).doesNotContain("pw1", "t0k");
    }

    @Test
    void redactInputMasksVariablesGivenAsAnObjectAndOddText() {
        Map<String, Object> shown = tool.redactInput(Map.of("variables", Map.of("SECRET_A", "s1", "PORT", "8080")));
        assertThat(shown.get("variables")).isEqualTo(Map.of("SECRET_A", "***", "PORT", "8080"));

        // KEY=VALUE 모양이 아니어도 비밀 이름이 보이면 통째로 가린다
        Map<String, Object> odd = tool.redactInput(Map.of("variables", "{'PASSWORD': 'pw1'}"));
        assertThat(odd.get("variables").toString()).doesNotContain("pw1");
    }

    @Test
    void redactInputHandlesNullsAndMissingFields() {
        assertThat(tool.redactInput(Map.of())).isEmpty();
        assertThat(tool.redactInput(null)).isNull();
        Map<String, Object> withNull = new LinkedHashMap<>();
        withNull.put("loginPassword", null);
        assertThat(tool.redactInput(withNull)).containsEntry("loginPassword", null);
    }

    @Test
    void permissionReasonListsKeyNamesOnlyAndMarksExistingOnes() {
        Project project = new Project();
        project.setEnvVariables("{\"LOGIN_ID\":\"old_user\",\"LOGIN_PASSWORD\":\"old_pw\",\"PASSWORD\":\"\"}");
        when(projectService.getProject("demo-proj")).thenReturn(project);
        LlmToolCall call = new LlmToolCall("c1", "set_env_variables", Map.of(
                "loginId", "new_user", "loginPassword", "new_pw", "loginPath", "/login"));

        String reason = tool.permissionReason(call, new ChatToolContext("demo-proj", 1L, false, 100L));

        assertThat(reason).isEqualTo("프로젝트 환경변수 LOGIN_ID(기존 값 덮어씀), USERNAME, LOGIN_PASSWORD(기존 값 덮어씀), "
                + "PASSWORD, LOGIN_PATH 를 저장합니다");
        assertThat(reason).doesNotContain("new_user", "new_pw", "old_user", "old_pw", "/login");
    }

    @Test
    void permissionReasonSaysOverwriteMayHappenWhenExistingValuesAreUnknown() {
        LlmToolCall call = new LlmToolCall("c1", "set_env_variables", Map.of("variables", "API_KEY=xyz"));

        // 프로젝트를 읽지 못하는 경우(여기서는 mock 이 null 을 돌려줌)와 맥락이 없는 경우
        assertThat(tool.permissionReason(call, new ChatToolContext("demo-proj", 1L, false, 100L)))
                .isEqualTo("프로젝트 환경변수 API_KEY 를 저장합니다 (기존 값이 있으면 덮어씀)");
        assertThat(tool.permissionReason(call))
                .isEqualTo("프로젝트 환경변수 API_KEY 를 저장합니다 (기존 값이 있으면 덮어씀)")
                .doesNotContain("xyz");
    }

    @Test
    void permissionReasonWithNothingToSaveStillSaysWhatItIs() {
        assertThat(tool.permissionReason(new LlmToolCall("c1", "set_env_variables", Map.of())))
                .isEqualTo("프로젝트 환경변수를 저장합니다");
    }

    @Test
    void refusesAnotherProjectThanTheOpenOneForNonAdmin() {
        LlmToolCall call = new LlmToolCall("c1", "set_env_variables",
                Map.of("projectId", "other-proj", "loginId", "kim"));

        ChatToolOutput output = tool.execute(call, new ChatToolContext("demo-proj", 1L, false, 100L));

        assertThat(output.error()).isTrue();
        verifyNoInteractions(projectService);
    }

    @Test
    void resultTextNeverContainsThePassword() {
        LlmToolCall call = new LlmToolCall("c1", "set_env_variables",
                Map.of("loginId", "kim", "loginPassword", "hunter2", "variables", "API_TOKEN=t0k"));

        ChatToolOutput output = tool.execute(call, new ChatToolContext("demo-proj", 1L, true, 100L));

        assertThat(output.error()).isFalse();
        assertThat(output.content()).contains("kim").doesNotContain("hunter2", "t0k");
        assertThat(output.summary()).doesNotContain("kim", "hunter2", "t0k");
    }

    @Test
    void executesAndSavesLoginCredentials() {
        LlmToolCall call = new LlmToolCall(
                "call-1",
                "set_env_variables",
                Map.of(
                        "loginId", "standard_user",
                        "loginPassword", "secret_sauce",
                        "loginPath", "/inventory.html"
                )
        );
        ChatToolContext context = new ChatToolContext("demo-proj", 1L, true, 100L);

        ChatToolOutput output = tool.execute(call, context);

        assertThat(output.error()).isFalse();
        assertThat(output.content()).contains("LOGIN_ID", "LOGIN_PASSWORD", "standard_user");
        verify(projectService).mergeEnvVariables(eq("demo-proj"), eq(Map.of(
                "LOGIN_ID", "standard_user",
                "USERNAME", "standard_user",
                "LOGIN_PASSWORD", "secret_sauce",
                "PASSWORD", "secret_sauce",
                "LOGIN_PATH", "/inventory.html"
        )));
    }

    @Test
    void executesWithVariablesString() {
        LlmToolCall call = new LlmToolCall(
                "call-2",
                "set_env_variables",
                Map.of("variables", "BASE_URL=https://example.com\nAPI_KEY=xyz")
        );
        ChatToolContext context = new ChatToolContext("demo-proj", 1L, true, 100L);

        ChatToolOutput output = tool.execute(call, context);

        assertThat(output.error()).isFalse();
        verify(projectService).mergeEnvVariables(eq("demo-proj"), eq(Map.of(
                "BASE_URL", "https://example.com",
                "API_KEY", "xyz"
        )));
    }

    @Test
    void executesWithJsonVariablesString() {
        LlmToolCall call = new LlmToolCall(
                "call-json",
                "set_env_variables",
                Map.of("variables", "{\"BASE_URL\":\"https://example.com\",\"PORT\":\"8080\"}")
        );
        ChatToolContext context = new ChatToolContext("demo-proj", 1L, true, 100L);

        ChatToolOutput output = tool.execute(call, context);

        assertThat(output.error()).isFalse();
        verify(projectService).mergeEnvVariables(eq("demo-proj"), eq(Map.of(
                "BASE_URL", "https://example.com",
                "PORT", "8080"
        )));
    }

    @Test
    void failsWhenNoArgumentsProvided() {
        LlmToolCall call = new LlmToolCall(
                "call-3",
                "set_env_variables",
                Map.of()
        );
        ChatToolContext context = new ChatToolContext("demo-proj", 1L, true, 100L);

        ChatToolOutput output = tool.execute(call, context);

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("설정할 환경변수");
        verifyNoInteractions(projectService);
    }
}
