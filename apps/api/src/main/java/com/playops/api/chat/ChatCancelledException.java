package com.playops.api.chat;

/** 사용자가 답변을 멈췄다는 신호. 루프 안에서만 쓰고 밖으로 새지 않는다. */
class ChatCancelledException extends RuntimeException {
    ChatCancelledException() {
        super("사용자가 답변을 멈췄습니다.", null, false, false);
    }
}
