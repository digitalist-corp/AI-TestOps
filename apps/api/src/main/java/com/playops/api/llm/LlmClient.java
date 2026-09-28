package com.playops.api.llm;

import com.playops.api.entity.AiModelProvider;

import java.util.List;

/** 공급자별 LLM 호출 구현. 구현체는 @Component 로 등록되어 LlmGatewayService 가 자동 수집한다. */
public interface LlmClient {

    AiModelProvider provider();

    LlmResult chat(LlmCredentials credentials, String systemPrompt, List<LlmMessage> messages);
}
