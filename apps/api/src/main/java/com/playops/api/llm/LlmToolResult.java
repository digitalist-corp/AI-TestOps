package com.playops.api.llm;

/**
 * 서버가 도구를 실제로 실행하고 모델에게 돌려주는 결과.
 *
 * error 가 true 면 모델은 "그 도구는 실패했다"고 이해하고 다른 방법을 찾는다.
 * 실패를 숨기고 빈 문자열을 주면 모델이 성공한 줄 알고 잘못된 답을 만든다.
 */
public record LlmToolResult(String toolCallId, String content, boolean error) {

    public static LlmToolResult ok(String toolCallId, String content) {
        return new LlmToolResult(toolCallId, content, false);
    }

    public static LlmToolResult failed(String toolCallId, String message) {
        return new LlmToolResult(toolCallId, message, true);
    }
}
