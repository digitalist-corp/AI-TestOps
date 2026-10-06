package com.playops.api.llm;

import java.util.List;

/**
 * LLM 한 번 호출의 결과.
 *
 * 예전에는 본문 문자열만 돌려주고 응답에 함께 오던 토큰 수를 버렸다.
 * 사용량 · 비용을 남기려면 이 값이 필요해 결과 객체로 묶었다.
 * 도구 호출이 붙으면서, 모델이 "도구를 불러 달라"고 답한 경우도 여기에 담긴다.
 */
public record LlmResult(
        String text,
        int inputTokens,
        int outputTokens,
        String model,
        List<LlmToolCall> toolCalls
) {

    public LlmResult(String text, int inputTokens, int outputTokens, String model) {
        this(text, inputTokens, outputTokens, model, List.of());
    }

    public static LlmResult of(String text) {
        return new LlmResult(text, 0, 0, null);
    }

    public boolean hasToolCalls() {
        return toolCalls != null && !toolCalls.isEmpty();
    }
}
