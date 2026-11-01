package com.playops.api.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 모델이 준 도구 인자(JSON)를 도구가 쓰는 Map 으로 바꾼다.
 *
 * 값이 문자열 · 숫자 같은 단순 값이면 글자로, 객체 · 배열이면 JSON 글자 그대로 담는다.
 * 도구는 call.arg() 로 꺼내 쓰므로 모든 값이 글자여야 다루기 쉽다.
 */
final class ToolArguments {

    private ToolArguments() {
    }

    static Map<String, Object> fromNode(JsonNode input) {
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

    /** 스트리밍으로 조각조각 받은 인자 JSON. 비었거나 깨졌으면 빈 인자로 본다. */
    static Map<String, Object> fromJson(ObjectMapper objectMapper, String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            return fromNode(objectMapper.readTree(json));
        } catch (Exception e) {
            return Map.of();
        }
    }
}
