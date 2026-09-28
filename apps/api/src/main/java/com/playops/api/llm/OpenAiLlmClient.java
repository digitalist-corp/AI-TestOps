package com.playops.api.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.playops.api.entity.AiModelProvider;
import com.playops.api.exception.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
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
    public LlmResult chat(LlmCredentials credentials, String systemPrompt, List<LlmMessage> messages,
                          List<LlmToolSpec> tools) {
        List<Map<String, Object>> payloadMessages = new ArrayList<>();
        payloadMessages.add(Map.of("role", "system", "content", systemPrompt));
        payloadMessages.addAll(toPayloadMessages(messages));

        Map<String, Object> body = new HashMap<>();
        body.put("model", openaiModel);
        body.put("messages", payloadMessages);
        if (tools != null && !tools.isEmpty()) {
            body.put("tools", toPayloadTools(tools));
        }

        try {
            String responseJson = restClient().post()
                    .uri(CHAT_COMPLETIONS_URL)
                    .header("Authorization", "Bearer " + credentials.apiKey())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(String.class);

            return parseResponse(responseJson);
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(502, "OpenAI API 호출 실패: " + e.getMessage());
        }
    }

    private LlmResult parseResponse(String responseJson) throws Exception {
        JsonNode root = objectMapper.readTree(responseJson);
        JsonNode message = root.path("choices").get(0).path("message");

        List<LlmToolCall> toolCalls = new ArrayList<>();
        JsonNode calls = message.path("tool_calls");
        if (calls.isArray()) {
            for (JsonNode call : calls) {
                JsonNode function = call.path("function");
                toolCalls.add(new LlmToolCall(
                        call.path("id").asText(),
                        function.path("name").asText(),
                        // OpenAI 는 인자를 JSON "문자열"로 준다. 한 번 더 파싱해야 Map 이 된다.
                        toArgumentMap(function.path("arguments").asText())
                ));
            }
        }

        JsonNode usage = root.path("usage");
        return new LlmResult(
                message.path("content").asText(""),
                usage.path("prompt_tokens").asInt(0),
                usage.path("completion_tokens").asInt(0),
                root.path("model").asText(null),
                toolCalls
        );
    }

    /**
     * 대화를 OpenAI 의 messages 배열로 바꾼다.
     * Claude 와 달리 도구 결과는 별도의 role="tool" 메시지 하나씩으로 나뉘어 들어간다.
     */
    private List<Map<String, Object>> toPayloadMessages(List<LlmMessage> messages) {
        List<Map<String, Object>> payload = new ArrayList<>();
        for (LlmMessage message : messages) {
            if (message.hasToolResults()) {
                for (LlmToolResult result : message.toolResults()) {
                    payload.add(Map.of(
                            "role", "tool",
                            "tool_call_id", result.toolCallId(),
                            "content", result.error() ? "ERROR: " + result.content() : result.content()
                    ));
                }
                continue;
            }

            if (message.hasToolCalls()) {
                List<Map<String, Object>> calls = new ArrayList<>();
                for (LlmToolCall call : message.toolCalls()) {
                    calls.add(Map.of(
                            "id", call.id(),
                            "type", "function",
                            "function", Map.of(
                                    "name", call.name(),
                                    "arguments", writeArguments(call.arguments())
                            )
                    ));
                }
                Map<String, Object> assistant = new LinkedHashMap<>();
                assistant.put("role", "assistant");
                assistant.put("content", message.content() == null ? "" : message.content());
                assistant.put("tool_calls", calls);
                payload.add(assistant);
                continue;
            }

            payload.add(Map.of("role", roleOf(message), "content", message.content()));
        }
        return payload;
    }

    private List<Map<String, Object>> toPayloadTools(List<LlmToolSpec> tools) {
        List<Map<String, Object>> payload = new ArrayList<>();
        for (LlmToolSpec tool : tools) {
            payload.add(Map.of(
                    "type", "function",
                    "function", Map.of(
                            "name", tool.name(),
                            "description", tool.description(),
                            "parameters", tool.inputSchema()
                    )
            ));
        }
        return payload;
    }

    private String writeArguments(Map<String, Object> arguments) {
        try {
            return objectMapper.writeValueAsString(arguments == null ? Map.of() : arguments);
        } catch (Exception e) {
            return "{}";
        }
    }

    private Map<String, Object> toArgumentMap(String argumentsJson) {
        if (argumentsJson == null || argumentsJson.isBlank()) {
            return Map.of();
        }
        try {
            JsonNode node = objectMapper.readTree(argumentsJson);
            if (!node.isObject()) {
                return Map.of();
            }
            Map<String, Object> arguments = new LinkedHashMap<>();
            node.fields().forEachRemaining(entry -> {
                JsonNode value = entry.getValue();
                arguments.put(entry.getKey(), value.isValueNode() ? value.asText() : value.toString());
            });
            return arguments;
        } catch (Exception e) {
            return Map.of();
        }
    }

    private String roleOf(LlmMessage message) {
        return message.role() == LlmRole.ASSISTANT ? "assistant" : "user";
    }
}
