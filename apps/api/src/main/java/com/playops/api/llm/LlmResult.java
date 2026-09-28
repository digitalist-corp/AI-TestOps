package com.playops.api.llm;

/**
 * LLM 한 번 호출의 결과.
 *
 * 예전에는 본문 문자열만 돌려주고 응답에 함께 오던 토큰 수를 버렸다.
 * 사용량 · 비용을 남기려면 이 값이 필요해 결과 객체로 묶었다.
 */
public record LlmResult(String text, int inputTokens, int outputTokens, String model) {

    public static LlmResult of(String text) {
        return new LlmResult(text, 0, 0, null);
    }
}
