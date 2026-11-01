package com.playops.api.chat;

/**
 * 도구 한 번 실행한 결과.
 *
 * @param content 모델에게 돌려줄 글 (너무 길면 잘라서)
 * @param error   실패했는지. 실패를 숨기면 모델이 성공한 줄 알고 잘못 답한다
 * @param summary 도구 카드 제목 옆에 붙는 한 줄 요약 (예: "12행", "tests/login.spec.ts")
 * @param display 화면용 표시 힌트. 없으면 null
 */
public record ChatToolOutput(String content, boolean error, String summary, ToolDisplay display) {

    public static ChatToolOutput ok(String content, String summary) {
        return new ChatToolOutput(content, false, summary, null);
    }

    public static ChatToolOutput ok(String content, String summary, ToolDisplay display) {
        return new ChatToolOutput(content, false, summary, display);
    }

    public static ChatToolOutput failed(String message) {
        return new ChatToolOutput(message, true, message, null);
    }
}
