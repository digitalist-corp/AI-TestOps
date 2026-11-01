package com.playops.api.chat;

import java.util.Map;

/**
 * 도구 결과를 화면에 어떻게 그릴지에 대한 힌트. 모델에게 가는 글(content)과 따로 둔다.
 *
 * kind 와 data 의 모양은 docs/design/ai-chat-agent-contract.md 의 "display" 절을 따른다.
 * 예: kind=table → data={columns, rows, truncated, sql}
 */
public record ToolDisplay(String kind, Map<String, Object> data) {

    public static ToolDisplay of(String kind, Map<String, Object> data) {
        return new ToolDisplay(kind, data);
    }
}
