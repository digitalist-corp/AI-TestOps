package com.playops.api.entity;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Set;

/** AI 채팅 에이전트의 대화 세션 한 건. 만든 사용자만 보고 쓸 수 있다. */
@Entity
@Table(name = "ai_chat_sessions",
        indexes = @Index(name = "idx_ai_chat_sessions_user_project_updated", columnList = "user_id, project_id, updated_at"))
public class AiChatSession {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    /** 프로젝트 화면에서 연 대화면 그 프로젝트. 전체 화면에서 열었으면 null. */
    @Column(name = "project_id", length = 100)
    private String projectId;

    /** 첫 사용자 메시지 앞 40자. 그 전에는 "새 대화". */
    @Column(nullable = false, length = 200)
    private String title;

    /** ALLOW_SESSION 으로 허락한 도구 이름들 (쉼표 구분) */
    @Column(name = "allowed_tools", columnDefinition = "TEXT")
    private String allowedTools;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    public Long getId() { return id; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void touch() { this.updatedAt = Instant.now(); }

    public Set<String> getAllowedToolNames() {
        Set<String> names = new LinkedHashSet<>();
        if (allowedTools != null && !allowedTools.isBlank()) {
            Arrays.stream(allowedTools.split(",")).map(String::trim).filter(s -> !s.isEmpty()).forEach(names::add);
        }
        return names;
    }

    public void allowTool(String toolName) {
        Set<String> names = getAllowedToolNames();
        names.add(toolName);
        this.allowedTools = String.join(",", names);
    }
}
