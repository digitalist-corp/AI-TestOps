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
 * Claude Messages API 의 스트리밍(SSE) 응답을 한 줄씩 받아 LlmResult 로 모은다.
 *
 * 글 조각(text_delta)은 오는 즉시 콜백으로 넘기고, 도구 입력은 조각(input_json_delta)을
 * 블록 번호별로 이어 붙였다가 블록이 끝날 때 한 번에 파싱한다. 조각 하나만으로는 JSON 이 완성되지 않기 때문이다.
 * HTTP 와 떼어 둔 이유는 고정 문자열로 단위 테스트를 하기 위해서다.
 */
class ClaudeStreamParser {

    private final ObjectMapper objectMapper;
    private final Consumer<String> onTextDelta;

    private final StringBuilder text = new StringBuilder();
    /** 블록 번호 → 만들고 있는 도구 호출. 번호 순서가 모델이 부른 순서다. */
    private final Map<Integer, PendingToolUse> toolUses = new TreeMap<>();
    private String model;
    private int inputTokens;
    private int outputTokens;

    ClaudeStreamParser(ObjectMapper objectMapper, String defaultModel, Consumer<String> onTextDelta) {
        this.objectMapper = objectMapper;
        this.model = defaultModel;
        this.onTextDelta = onTextDelta;
    }

    /** SSE 한 줄. event: 줄은 data 안의 type 과 같으므로 data: 줄만 본다. */
    void accept(String line) throws Exception {
        if (line == null || !line.startsWith("data:")) {
            return;
        }
        String data = line.substring(5).trim();
        if (data.isEmpty()) {
            return;
        }
        JsonNode event = objectMapper.readTree(data);
        switch (event.path("type").asText()) {
            case "message_start" -> {
                JsonNode message = event.path("message");
                if (message.hasNonNull("model")) {
                    model = message.path("model").asText();
                }
                readUsage(message.path("usage"));
            }
            case "content_block_start" -> {
                JsonNode block = event.path("content_block");
                if ("tool_use".equals(block.path("type").asText())) {
                    toolUses.put(event.path("index").asInt(),
                            new PendingToolUse(block.path("id").asText(), block.path("name").asText()));
                }
            }
            case "content_block_delta" -> {
                JsonNode delta = event.path("delta");
                String deltaType = delta.path("type").asText();
                if ("text_delta".equals(deltaType)) {
                    String piece = delta.path("text").asText("");
                    if (!piece.isEmpty()) {
                        text.append(piece);
                        onTextDelta.accept(piece);
                    }
                } else if ("input_json_delta".equals(deltaType)) {
                    PendingToolUse pending = toolUses.get(event.path("index").asInt());
                    if (pending != null) {
                        pending.json.append(delta.path("partial_json").asText(""));
                    }
                }
            }
            case "message_delta" -> readUsage(event.path("usage"));
            case "error" -> throw new ApiException(502,
                    "Claude 스트림 오류: " + event.path("error").path("message").asText("알 수 없는 오류"));
            default -> {
                // ping, content_block_stop, message_stop 등은 모을 것이 없다.
            }
        }
    }

    /** message_delta 의 output_tokens 는 누적값이라 더하지 않고 덮어쓴다. */
    private void readUsage(JsonNode usage) {
        if (usage == null || usage.isMissingNode() || usage.isNull()) {
            return;
        }
        if (usage.hasNonNull("input_tokens")) {
            inputTokens = Math.max(inputTokens, usage.path("input_tokens").asInt());
        }
        if (usage.hasNonNull("output_tokens")) {
            outputTokens = Math.max(outputTokens, usage.path("output_tokens").asInt());
        }
    }

    LlmResult result() {
        List<LlmToolCall> calls = new ArrayList<>();
        for (PendingToolUse pending : toolUses.values()) {
            calls.add(new LlmToolCall(pending.id, pending.name,
                    ToolArguments.fromJson(objectMapper, pending.json.toString())));
        }
        return new LlmResult(text.toString(), inputTokens, outputTokens, model, calls);
    }

    private static final class PendingToolUse {
        private final String id;
        private final String name;
        private final StringBuilder json = new StringBuilder();

        private PendingToolUse(String id, String name) {
            this.id = id;
            this.name = name;
        }
    }
}
