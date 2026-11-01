package com.playops.api.chat;

import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;

/**
 * 채팅 에이전트가 쓸 수 있는 도구 하나. 구현체를 @Component 로 등록하면 도구 목록에 자동으로 들어간다.
 *
 * 원칙은 기존 AiChatToolService 와 같다 — 파일을 직접 고치는 도구는 두지 않고(CHANGE 는 승인 대기 작업만 만든다),
 * 도구는 호출하는 쪽이 채팅인지 외부(MCP · LangGraph)인지 몰라야 한다.
 */
public interface ChatTool {

    /** 모델에게 알려줄 이름 · 설명 · 인자 스키마 */
    LlmToolSpec spec();

    ToolTier tier();

    /** 사용자에게 허락을 구할 때 보여줄 한 줄 설명. RUN 단계 도구만 쓴다. */
    default String permissionReason(LlmToolCall call) {
        return spec().description();
    }

    /** 실패는 예외 대신 ChatToolOutput.failed 로 돌려주는 것이 원칙이다. 예외가 나도 루프가 failed 로 바꿔 준다. */
    ChatToolOutput execute(LlmToolCall call, ChatToolContext context);
}
