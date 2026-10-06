package com.playops.api.llm;

import java.util.List;

/**
 * 공급자 중립적인 대화 메시지 한 건.
 *
 * 도구 호출이 들어오면서 메시지는 세 가지 모양을 갖게 됐다.
 *   1. 평범한 대화       — content 만 있다
 *   2. 모델의 도구 요청   — assistant + toolCalls
 *   3. 서버의 도구 결과   — toolResults (Claude 는 user 턴, OpenAI 는 tool 턴으로 보낸다)
 * 셋을 한 타입으로 두는 이유는, 대화 기록이 시간 순서대로 한 줄에 섞여 있어야
 * 모델이 "내가 무엇을 요청했고 무엇을 돌려받았는지"를 이어서 읽을 수 있기 때문이다.
 */
public record LlmMessage(
        LlmRole role,
        String content,
        List<LlmToolCall> toolCalls,
        List<LlmToolResult> toolResults
) {

    public LlmMessage(LlmRole role, String content) {
        this(role, content, List.of(), List.of());
    }

    public static LlmMessage user(String content) {
        return new LlmMessage(LlmRole.USER, content);
    }

    public static LlmMessage assistant(String content) {
        return new LlmMessage(LlmRole.ASSISTANT, content);
    }

    /** 모델이 도구를 부르겠다고 한 턴. 함께 말한 텍스트가 있으면 같이 담는다. */
    public static LlmMessage toolRequest(String content, List<LlmToolCall> calls) {
        return new LlmMessage(LlmRole.ASSISTANT, content == null ? "" : content, calls, List.of());
    }

    /** 서버가 도구를 실행하고 돌려주는 턴. */
    public static LlmMessage toolResponse(List<LlmToolResult> results) {
        return new LlmMessage(LlmRole.USER, "", List.of(), results);
    }

    public boolean hasToolCalls() {
        return toolCalls != null && !toolCalls.isEmpty();
    }

    public boolean hasToolResults() {
        return toolResults != null && !toolResults.isEmpty();
    }
}
