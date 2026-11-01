package com.playops.api.chat;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.playops.api.entity.AiChatSession;

import java.time.Instant;
import java.util.List;

/** 채팅 세션 API 의 요청 · 응답 모양. docs/design/ai-chat-agent-contract.md 의 REST 절과 같다. */
public final class ChatDtos {

    private ChatDtos() {
    }

    public record CreateSessionRequest(String projectId) {}

    public record SendMessageRequest(String content, String userLevel) {}

    public record PermissionDecisionRequest(String decision) {}

    public record SessionResponse(Long id, String projectId, String title, Instant createdAt, Instant updatedAt) {
        public static SessionResponse from(AiChatSession session) {
            return new SessionResponse(session.getId(), session.getProjectId(), session.getTitle(),
                    session.getCreatedAt(), session.getUpdatedAt());
        }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record MessageResponse(Long id, String role, Instant createdAt, List<ChatBlock> blocks, String stopReason) {}

    public record SessionDetailResponse(SessionResponse session, List<MessageResponse> messages) {}
}
