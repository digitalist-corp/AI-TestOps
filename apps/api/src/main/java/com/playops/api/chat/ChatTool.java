package com.playops.api.chat;

import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;

import java.util.Map;

/**
 * 채팅 에이전트가 쓸 수 있는 도구 하나. 구현체를 @Component 로 등록하면 도구 목록에 자동으로 들어간다.
 *
 * 원칙은 기존 AiChatToolService 와 같다 — 파일을 직접 고치는 도구는 두지 않고(CHANGE 는 승인 대기 작업만 만든다),
 * 도구는 호출하는 쪽이 채팅인지 외부(MCP · LangGraph)인지 몰라야 한다.
 * 실제로 무언가를 바꾸거나 실행하는 도구는 RUN 으로 두어 사용자 허락을 받는다.
 */
public interface ChatTool {

    /** 모델에게 알려줄 이름 · 설명 · 인자 스키마 */
    LlmToolSpec spec();

    ToolTier tier();

    /** 사용자에게 허락을 구할 때 보여줄 한 줄 설명. RUN 단계 도구만 쓴다. */
    default String permissionReason(LlmToolCall call) {
        return spec().description();
    }

    /** 프로젝트 · 사용자 정보가 있어야 쓸 수 있는 문구(예: 이미 저장된 값 확인)는 이쪽을 재정의한다. 에이전트 루프는 이 메서드를 부른다. */
    default String permissionReason(LlmToolCall call, ChatToolContext context) {
        return permissionReason(call);
    }

    /**
     * 화면(tool_start · permission_request)과 저장된 대화(블록)에 남길 입력. 비밀번호 같은 값은 여기서 가린다.
     * 실제 실행(execute)에는 원래 입력이 간다. 원본 맵은 고치지 말고 새 맵을 돌려준다.
     */
    default Map<String, Object> redactInput(Map<String, Object> input) {
        return input;
    }

    /** 실패는 예외 대신 ChatToolOutput.failed 로 돌려주는 것이 원칙이다. 예외가 나도 루프가 failed 로 바꿔 준다. */
    ChatToolOutput execute(LlmToolCall call, ChatToolContext context);
}
