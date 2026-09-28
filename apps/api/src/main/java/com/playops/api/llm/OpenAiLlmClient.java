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
public class OpenAiLlmClient extends AbstractHttpLlmClient {

    private static final String CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

    @Value("${openai.model:gpt-4o-mini}")
    private String openaiModel = "gpt-4o-mini";

    @Override
    public AiModelProvider provider() {
        return AiModelProvider.GPT;
    }

    @Override
    public LlmResult chat(LlmCredentials credentials, String systemPrompt, List<LlmMessage> messages) {
        List<Map<String, String>> payloadMessages = new ArrayList<>();
        payloadMessages.add(Map.of("role", "system", "content", systemPrompt));
        for (LlmMessage message : messages) {
            payloadMessages.add(Map.of("role", roleOf(message), "content", message.content()));
        }

        Map<String, Object> body = new HashMap<>();
        body.put("model", openaiModel);
        body.put("messages", payloadMessages);

        try {
            String responseJson = restClient().post()
                    .uri(CHAT_COMPLETIONS_URL)
                    .header("Authorization", "Bearer " + credentials.apiKey())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(String.class);

            JsonNode root = objectMapper.readTree(responseJson);
            JsonNode usage = root.path("usage");
            return new LlmResult(
                    root.path("choices").get(0).path("message").path("content").asText(),
                    usage.path("prompt_tokens").asInt(0),
                    usage.path("completion_tokens").asInt(0),
                    root.path("model").asText(null)
            );
        } catch (Exception e) {
            throw new ApiException(502, "OpenAI API 호출 실패: " + e.getMessage());
        }
    }

    private String roleOf(LlmMessage message) {
        return message.role() == LlmRole.ASSISTANT ? "assistant" : "user";
    }
}
