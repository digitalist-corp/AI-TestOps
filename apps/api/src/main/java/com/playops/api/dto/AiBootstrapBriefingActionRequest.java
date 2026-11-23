package com.playops.api.dto;

import java.util.Map;

/**
 * 첫 실행 브리핑에서 A2UI 렌더러가 보내는 action 메시지 그대로.
 * 서버는 name · surfaceId 를 확인하고 context.selected 의 id 만 쓴다 (제목 같은 나머지 값은 믿지 않는다).
 */
public record AiBootstrapBriefingActionRequest(String version, Action action) {

    public record Action(String name, String surfaceId, String sourceComponentId, String timestamp,
                         Map<String, Object> context) {}
}
