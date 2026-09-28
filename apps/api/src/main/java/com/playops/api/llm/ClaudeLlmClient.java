package com.playops.api.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.playops.api.entity.AiModelProvider;
import com.playops.api.exception.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class ClaudeLlmClient extends AbstractHttpLlmClient {

    private static final String MESSAGES_URL = "https://api.anthropic.com/v1/messages";

    @Value("${anthropic.model:claude-sonnet-5}")
    private String claudeModel = "claude-sonnet-5";

    @Override
    public AiModelProvider provider() {
        return AiModelProvider.CLAUDE;
    }

    @Override
    public LlmResult chat(LlmCredentials credentials, String systemPrompt, List<LlmMessage> messages) {
        List<Map<String, String>> payloadMessages = new ArrayList<>();
        for (LlmMessage message : messages) {
            payloadMessages.add(Map.of("role", roleOf(message), "content", message.content()));
        }

        Map<String, Object> body = new HashMap<>();
        body.put("model", claudeModel);
        body.put("max_tokens", 4096);
        body.put("system", systemPrompt);
        body.put("messages", payloadMessages);

        // 워크스페이스에 연결된(identity-linked) API 키는 x-api-key만으로는 인증이 거부되고
        // 어느 워크스페이스로 요청을 보낼지 별도 헤더로 명시해야 한다. 일반 키는 이 값이 없어도 그대로 동작한다.
        String workspaceId = credentials.workspaceId();

        try {
            String responseJson = restClient().post()
                    .uri(MESSAGES_URL)
                    .headers(headers -> {
                        headers.set("x-api-key", credentials.apiKey());
                        headers.set("anthropic-version", "2023-06-01");
                        if (workspaceId != null && !workspaceId.isBlank()) {
                            headers.set("anthropic-workspace-id", workspaceId);
                        }
                    })
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(String.class);

            JsonNode root = objectMapper.readTree(responseJson);
            JsonNode contentArray = root.path("content");
            StringBuilder text = new StringBuilder();
            if (contentArray.isArray()) {
                for (JsonNode block : contentArray) {
                    if ("text".equals(block.path("type").asText())) {
                        text.append(block.path("text").asText());
                    }
                }
            }
            JsonNode usage = root.path("usage");
            return new LlmResult(
                    text.toString(),
                    usage.path("input_tokens").asInt(0),
                    usage.path("output_tokens").asInt(0),
                    root.path("model").asText(claudeModel)
            );
        } catch (Exception e) {
            throw new ApiException(502, "Claude API 호출 실패: " + e.getMessage());
        }
    }

    private String roleOf(LlmMessage message) {
        return message.role() == LlmRole.ASSISTANT ? "assistant" : "user";
    }
}
