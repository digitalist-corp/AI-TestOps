package com.playops.api.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.exception.ApiException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.Consumer;

/**
 * OpenAI Chat Completions 의 스트리밍(SSE) 응답을 한 줄씩 받아 LlmResult 로 모은다.
 *
 * 글은 choices[0].delta.content 로, 도구 호출은 delta.tool_calls[] 로 오는데 도구 인자는
 * 같은 index 로 여러 번에 나뉘어 온다. index 별로 이어 붙였다가 끝에 파싱한다.
 * 사용량은 stream_options.include_usage 를 켰을 때 choices 가 빈 마지막 조각에 실려 온다.
 */
class OpenAiStreamParser {

    private final ObjectMapper objectMapper;
    private final Consumer<String> onTextDelta;

    private final StringBuilder text = new StringBuilder();
    private final Map<Integer, PendingToolCall> toolCalls = new TreeMap<>();
    private String model;
    private int inputTokens;
    private int outputTokens;

    OpenAiStreamParser(ObjectMapper objectMapper, String defaultModel, Consumer<String> onTextDelta) {
        this.objectMapper = objectMapper;
        this.model = defaultModel;
        this.onTextDelta = onTextDelta;
    }

    void accept(String line) throws Exception {
        if (line == null || !line.startsWith("data:")) {
            return;
        }
        String data = line.substring(5).trim();
        if (data.isEmpty() || "[DONE]".equals(data)) {
            return;
        }
        JsonNode chunk = objectMapper.readTree(data);
        if (chunk.has("error")) {
            throw new ApiException(502,
                    "OpenAI 스트림 오류: " + chunk.path("error").path("message").asText("알 수 없는 오류"));
        }
        if (chunk.hasNonNull("model")) {
            model = chunk.path("model").asText();
        }
        JsonNode usage = chunk.path("usage");
        if (usage.isObject()) {
            inputTokens = usage.path("prompt_tokens").asInt(inputTokens);
            outputTokens = usage.path("completion_tokens").asInt(outputTokens);
        }

        JsonNode choices = chunk.path("choices");
        if (!choices.isArray() || choices.isEmpty()) {
            return;
        }
        JsonNode delta = choices.get(0).path("delta");
        JsonNode content = delta.path("content");
        if (content.isTextual() && !content.asText().isEmpty()) {
            text.append(content.asText());
            onTextDelta.accept(content.asText());
        }
        JsonNode calls = delta.path("tool_calls");
        if (calls.isArray()) {
            for (JsonNode call : calls) {
                PendingToolCall pending = toolCalls.computeIfAbsent(
                        call.path("index").asInt(toolCalls.size()), i -> new PendingToolCall());
                if (call.hasNonNull("id")) {
                    pending.id = call.path("id").asText();
                }
                JsonNode function = call.path("function");
                if (function.hasNonNull("name")) {
                    pending.name = function.path("name").asText();
                }
                if (function.hasNonNull("arguments")) {
                    pending.arguments.append(function.path("arguments").asText());
                }
            }
        }
    }

    LlmResult result() {
        List<LlmToolCall> calls = new ArrayList<>();
        for (PendingToolCall pending : toolCalls.values()) {
            calls.add(new LlmToolCall(pending.id, pending.name,
                    ToolArguments.fromJson(objectMapper, pending.arguments.toString())));
        }
        return new LlmResult(text.toString(), inputTokens, outputTokens, model, calls);
    }

    private static final class PendingToolCall {
        private String id;
        private String name;
        private final StringBuilder arguments = new StringBuilder();
    }
}
