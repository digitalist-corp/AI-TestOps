package com.playops.api.llm;

import java.util.Map;

/**
 * 모델에게 "이런 도구를 쓸 수 있다"고 알려주는 정의 한 건.
 *
 * inputSchema 는 JSON Schema 의 object 스키마를 그대로 담는다.
 * Claude 와 OpenAI 모두 같은 모양의 스키마를 받으므로 공급자별로 나누지 않는다.
 */
public record LlmToolSpec(String name, String description, Map<String, Object> inputSchema) {

    /** 필수 인자 없이 object 스키마를 만든다. */
    public static Map<String, Object> schema(Map<String, Object> properties, String... required) {
        return Map.of(
                "type", "object",
                "properties", properties,
                "required", java.util.List.of(required)
        );
    }

    /** 문자열 인자 하나의 스키마 조각. */
    public static Map<String, Object> string(String description) {
        return Map.of("type", "string", "description", description);
    }

    /** 정수 인자 하나의 스키마 조각. */
    public static Map<String, Object> integer(String description) {
        return Map.of("type", "integer", "description", description);
    }
}
