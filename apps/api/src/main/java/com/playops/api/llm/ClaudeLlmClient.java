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
public class ClaudeLlmClient extends AbstractHttpLlmClient {

    private static final String MESSAGES_URL = "https://api.anthropic.com/v1/messages";

    @Value("${anthropic.model:claude-sonnet-5}")
    private String claudeModel = "claude-sonnet-5";

    @Override
    public AiModelProvider provider() {
        return AiModelProvider.CLAUDE;
    }

    @Override
    public LlmResult chat(LlmCredentials credentials, String systemPrompt, List<LlmMessage> messages,
                          List<LlmToolSpec> tools) {
        Map<String, Object> body = new HashMap<>();
        body.put("model", claudeModel);
        body.put("max_tokens", 4096);
        body.put("system", systemPrompt);
        body.put("messages", toPayloadMessages(messages));
        if (tools != null && !tools.isEmpty()) {
            body.put("tools", toPayloadTools(tools));
        }

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

            return parseResponse(responseJson);
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(502, "Claude API 호출 실패: " + e.getMessage());
        }
    }

    private LlmResult parseResponse(String responseJson) throws Exception {
        JsonNode root = objectMapper.readTree(responseJson);
        JsonNode contentArray = root.path("content");

        StringBuilder text = new StringBuilder();
        List<LlmToolCall> toolCalls = new ArrayList<>();
        if (contentArray.isArray()) {
            for (JsonNode block : contentArray) {
                String type = block.path("type").asText();
                if ("text".equals(type)) {
                    text.append(block.path("text").asText());
                } else if ("tool_use".equals(type)) {
                    toolCalls.add(new LlmToolCall(
                            block.path("id").asText(),
                            block.path("name").asText(),
                            toArgumentMap(block.path("input"))
                    ));
                }
            }
        }

        JsonNode usage = root.path("usage");
        return new LlmResult(
                text.toString(),
                usage.path("input_tokens").asInt(0),
                usage.path("output_tokens").asInt(0),
                root.path("model").asText(claudeModel),
                toolCalls
        );
    }

    /**
     * 대화를 Claude 의 content 블록 배열로 바꾼다.
     * 도구 요청(tool_use)과 도구 결과(tool_result)는 반드시 짝을 이뤄 연속으로 들어가야 한다.
     */
    private List<Map<String, Object>> toPayloadMessages(List<LlmMessage> messages) {
        List<Map<String, Object>> payload = new ArrayList<>();
        for (LlmMessage message : messages) {
            if (message.hasToolResults()) {
                List<Map<String, Object>> blocks = new ArrayList<>();
                for (LlmToolResult result : message.toolResults()) {
                    Map<String, Object> block = new LinkedHashMap<>();
                    block.put("type", "tool_result");
                    block.put("tool_use_id", result.toolCallId());
                    block.put("content", result.content());
                    if (result.error()) {
                        block.put("is_error", true);
                    }
                    blocks.add(block);
                }
                payload.add(Map.of("role", "user", "content", blocks));
                continue;
            }

            if (message.hasToolCalls()) {
                List<Map<String, Object>> blocks = new ArrayList<>();
                if (message.content() != null && !message.content().isBlank()) {
                    blocks.add(Map.of("type", "text", "text", message.content()));
                }
                for (LlmToolCall call : message.toolCalls()) {
                    blocks.add(Map.of(
                            "type", "tool_use",
                            "id", call.id(),
                            "name", call.name(),
                            "input", call.arguments() == null ? Map.of() : call.arguments()
                    ));
                }
                payload.add(Map.of("role", "assistant", "content", blocks));
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
                    "name", tool.name(),
                    "description", tool.description(),
                    "input_schema", tool.inputSchema()
            ));
        }
        return payload;
    }

    private Map<String, Object> toArgumentMap(JsonNode input) {
        if (input == null || !input.isObject()) {
            return Map.of();
        }
        Map<String, Object> arguments = new LinkedHashMap<>();
        input.fields().forEachRemaining(entry -> {
            JsonNode value = entry.getValue();
            arguments.put(entry.getKey(), value.isValueNode() ? value.asText() : value.toString());
        });
        return arguments;
    }

    private String roleOf(LlmMessage message) {
        return message.role() == LlmRole.ASSISTANT ? "assistant" : "user";
    }
}
