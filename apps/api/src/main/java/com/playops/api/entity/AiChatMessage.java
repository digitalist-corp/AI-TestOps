package com.playops.api.entity;

import jakarta.persistence.*;

import java.time.Instant;

/**
 * AI 채팅 세션의 메시지 한 건.
 *
 * 본문은 화면 계약의 블록 배열(ChatBlock[])을 JSON 글자로 그대로 담는다. 도구 호출 · 결과도 블록에 들어 있어서,
 * 다음 질문 때 이 블록들로 모델에게 보낼 이전 대화(도구 호출 · 결과 포함)를 다시 만든다.
 */
@Entity
@Table(name = "ai_chat_messages", indexes = @Index(name = "idx_ai_chat_messages_session", columnList = "session_id, id"))
public class AiChatMessage {

    public static final String ROLE_USER = "user";
    public static final String ROLE_ASSISTANT = "assistant";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "session_id", nullable = false)
    private Long sessionId;

    /** user · assistant */
    @Column(nullable = false, length = 20)
    private String role;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String blocks = "[]";

    /** END · CANCELLED · MAX_TURNS · ERROR. assistant 만 쓰고, 답변이 진행 중이면 null. */
    @Column(name = "stop_reason", length = 20)
    private String stopReason;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    public Long getId() { return id; }
    public Long getSessionId() { return sessionId; }
    public void setSessionId(Long sessionId) { this.sessionId = sessionId; }
    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }
    public String getBlocks() { return blocks; }
    public void setBlocks(String blocks) { this.blocks = blocks; }
    public String getStopReason() { return stopReason; }
    public void setStopReason(String stopReason) { this.stopReason = stopReason; }
    public Instant getCreatedAt() { return createdAt; }
}
