package com.playops.api.chat.tools;

import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolTier;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.service.ProjectService;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

class SetEnvVariablesToolTest {

    private final ProjectService projectService = mock(ProjectService.class);
    private final SetEnvVariablesTool tool = new SetEnvVariablesTool(projectService);

    @Test
    void specAndTier() {
        assertThat(tool.spec().name()).isEqualTo("set_env_variables");
        assertThat(tool.tier()).isEqualTo(ToolTier.CHANGE);
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
