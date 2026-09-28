package com.playops.api.llm;

import com.playops.api.entity.AiModelProvider;

import java.util.List;

/** 공급자별 LLM 호출 구현. 구현체는 @Component 로 등록되어 LlmGatewayService 가 자동 수집한다. */
public interface LlmClient {

    AiModelProvider provider();

    /**
     * 도구를 쓰지 않는 평범한 호출.
     * 분석 · 생성처럼 한 번 묻고 한 번 답하면 끝나는 기능이 이 쪽을 쓴다.
     */
    default LlmResult chat(LlmCredentials credentials, String systemPrompt, List<LlmMessage> messages) {
        return chat(credentials, systemPrompt, messages, List.of());
    }

    /**
     * 도구 목록을 함께 건네는 호출.
     * 모델이 도구를 부르겠다고 하면 결과의 toolCalls 가 채워져 돌아오고, 실행은 호출한 쪽 책임이다.
     */
    LlmResult chat(LlmCredentials credentials, String systemPrompt, List<LlmMessage> messages, List<LlmToolSpec> tools);
}
