package com.playops.api.chat;

import java.util.Map;

/**
 * 에이전트 루프가 내보내는 SSE 이벤트를 받는 곳. 실제로는 SseEmitter 를 감싼 것이고, 테스트에서는 목록에 모은다.
 * 이벤트 이름과 data 모양은 docs/design/ai-chat-agent-contract.md 의 "SSE 이벤트" 절을 따른다.
 *
 * 받는 쪽(브라우저)이 끊겨도 예외를 던지지 않아야 한다 — 루프는 끝까지 돌고 결과를 저장한다.
 */
public interface ChatEventSink {

    /** 루프가 시작될 때 한 번. 연결 유지용 ping 같은 것을 여기서 시작한다. */
    default void open() {
    }

    void send(String event, Map<String, Object> data);

    /** 답변이 끝나면 한 번. 스트림을 닫는다. */
    void close();
}
