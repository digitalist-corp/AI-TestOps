package com.playops.api.dto;

import java.util.List;

/**
 * 채팅 한 턴의 응답.
 *
 * answer 는 기존과 동일한 본문이고, actions 는 그 대화 중에 AI가 실제로 만든 작업이나
 * 사용자에게 낸 제안이다. 화면이 승인 버튼 · 실행 버튼을 띄우는 근거가 된다.
 */
public record AiChatResponse(String answer, List<AiChatAction> actions) {

    public AiChatResponse(String answer) {
        this(answer, List.of());
    }
}
