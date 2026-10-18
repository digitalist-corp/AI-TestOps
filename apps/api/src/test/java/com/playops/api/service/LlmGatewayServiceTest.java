package com.playops.api.service;

import com.playops.api.entity.AiModelProvider;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmClient;
import com.playops.api.llm.LlmCredentials;
import com.playops.api.llm.LlmMessage;
import com.playops.api.llm.LlmResult;
import com.playops.api.llm.LlmRole;
import com.playops.api.repository.AiUsageRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LlmGatewayServiceTest {

    private final AiProviderSettingsService settingsService = mock(AiProviderSettingsService.class);
    private final LlmClient claudeClient = mock(LlmClient.class);
    private final LlmClient gptClient = mock(LlmClient.class);
    private final AiUsageRepository usageRepository = mock(AiUsageRepository.class);

    private LlmGatewayService gatewayWithBothClients() {
        when(claudeClient.provider()).thenReturn(AiModelProvider.CLAUDE);
        when(gptClient.provider()).thenReturn(AiModelProvider.GPT);
        return new LlmGatewayService(List.of(claudeClient, gptClient), settingsService, usageRepository);
    }

    @SuppressWarnings("unchecked")
    private static ArgumentCaptor<List<LlmMessage>> messageCaptor() {
        return ArgumentCaptor.forClass((Class<List<LlmMessage>>) (Class<?>) List.class);
    }

    @Test
    void dispatchesToClaudeClientWithCredentialsFromSettings() {
        LlmGatewayService gateway = gatewayWithBothClients();
        when(settingsService.getDecryptedKey(AiModelProvider.CLAUDE)).thenReturn("claude-key");
        when(settingsService.getClaudeWorkspaceIdOrNull()).thenReturn("ws-1");
        when(claudeClient.chat(any(), any(), any())).thenReturn(LlmResult.of("claude answer"));

        String answer = gateway.chat(AiModelProvider.CLAUDE, "sys", List.of(LlmMessage.user("hi")));

        assertThat(answer).isEqualTo("claude answer");
        ArgumentCaptor<LlmCredentials> credentials = ArgumentCaptor.forClass(LlmCredentials.class);
        verify(claudeClient).chat(credentials.capture(), eq("sys"), any());
        assertThat(credentials.getValue().apiKey()).isEqualTo("claude-key");
        assertThat(credentials.getValue().workspaceId()).isEqualTo("ws-1");
        verify(gptClient, never()).chat(any(), any(), any());
    }

    @Test
    void dispatchesToGptClientWithoutWorkspaceId() {
        LlmGatewayService gateway = gatewayWithBothClients();
        when(settingsService.getDecryptedKey(AiModelProvider.GPT)).thenReturn("openai-key");
        when(gptClient.chat(any(), any(), any())).thenReturn(LlmResult.of("gpt answer"));

        String answer = gateway.chat(AiModelProvider.GPT, "sys", List.of(LlmMessage.user("hi")));

        assertThat(answer).isEqualTo("gpt answer");
        ArgumentCaptor<LlmCredentials> credentials = ArgumentCaptor.forClass(LlmCredentials.class);
        verify(gptClient).chat(credentials.capture(), eq("sys"), any());
        assertThat(credentials.getValue().apiKey()).isEqualTo("openai-key");
        assertThat(credentials.getValue().workspaceId()).isNull();
        verify(claudeClient, never()).chat(any(), any(), any());
    }

    @Test
    void singlePromptOverloadSendsExactlyOneUserMessage() {
        LlmGatewayService gateway = gatewayWithBothClients();
        when(settingsService.getDecryptedKey(AiModelProvider.CLAUDE)).thenReturn("claude-key");
        when(claudeClient.chat(any(), any(), any())).thenReturn(LlmResult.of("ok"));

        gateway.chat(AiModelProvider.CLAUDE, "sys", "질문입니다");

        ArgumentCaptor<List<LlmMessage>> messages = messageCaptor();
        verify(claudeClient).chat(any(), eq("sys"), messages.capture());
        assertThat(messages.getValue()).containsExactly(new LlmMessage(LlmRole.USER, "질문입니다"));
    }

    @Test
    void unregisteredProviderThrowsBadRequest() {
        when(claudeClient.provider()).thenReturn(AiModelProvider.CLAUDE);
        LlmGatewayService gateway = new LlmGatewayService(List.of(claudeClient), settingsService, usageRepository);

        assertThatThrownBy(() -> gateway.chat(AiModelProvider.GPT, "sys", "질문"))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(400));
    }

    /** 공급자를 정하지 않은 호출은 AI 설정의 기본 공급자로 간다. */
    @Test
    void nullProviderGoesToTheConfiguredDefault() {
        LlmGatewayService gateway = gatewayWithBothClients();
        when(settingsService.getDefaultProvider()).thenReturn(AiModelProvider.GPT);
        when(settingsService.getDecryptedKey(AiModelProvider.GPT)).thenReturn("openai-key");
        when(gptClient.chat(any(), any(), any())).thenReturn(LlmResult.of("gpt answer"));

        assertThat(gateway.chat(null, "sys", "질문")).isEqualTo("gpt answer");
        verify(claudeClient, never()).chat(any(), any(), any());
    }
}
