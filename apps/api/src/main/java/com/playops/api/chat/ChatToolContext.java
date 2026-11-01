package com.playops.api.chat;

import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmToolCall;

/**
 * 도구가 실행될 때 알 수 있는 호출자 정보.
 *
 * @param projectId 대화 중인 프로젝트 (없을 수 있음)
 * @param userId    요청한 사용자
 * @param admin     관리자인지. SQL 조회 범위 등 권한 판단에 쓴다
 * @param sessionId 채팅 세션 id (채팅 밖 호출자면 null)
 */
public record ChatToolContext(String projectId, Long userId, boolean admin, Long sessionId) {

    public boolean hasProject() {
        return projectId != null && !projectId.isBlank();
    }

    /** 인자로 넘어온 projectId 가 우선, 없으면 대화 중인 프로젝트. 둘 다 없으면 실패를 분명히 알린다. */
    public String projectIdFor(LlmToolCall call) {
        String explicit = call.arg("projectId");
        if (explicit != null) {
            return explicit;
        }
        if (hasProject()) {
            return projectId;
        }
        throw new ApiException(400, "projectId 를 알 수 없습니다. 인자로 프로젝트를 지정하세요.");
    }
}
