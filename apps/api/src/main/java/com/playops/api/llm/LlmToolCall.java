package com.playops.api.llm;

import java.util.Map;

/**
 * 모델이 "이 도구를 이런 인자로 불러 달라"고 요청한 내용.
 *
 * id 는 공급자가 붙인 호출 식별자다. 결과를 돌려줄 때 같은 id 를 실어야
 * 모델이 어느 요청에 대한 답인지 짝지을 수 있다.
 */
public record LlmToolCall(String id, String name, Map<String, Object> arguments) {

    /** 문자열 인자를 꺼낸다. 없거나 비어 있으면 null. */
    public String arg(String key) {
        Object value = arguments == null ? null : arguments.get(key);
        if (value == null) {
            return null;
        }
        String text = String.valueOf(value).trim();
        return text.isEmpty() ? null : text;
    }

    /** 정수 인자를 꺼낸다. 값이 없거나 숫자가 아니면 기본값. */
    public long argLong(String key, long fallback) {
        String text = arg(key);
        if (text == null) {
            return fallback;
        }
        try {
            return Long.parseLong(text);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
