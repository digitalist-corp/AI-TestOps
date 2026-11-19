package com.playops.api.entity;

import jakarta.persistence.*;
import java.time.Instant;

/** 사람이 고친 실패 원인 (V22). 같은 서명은 프로젝트마다 하나, 마지막 값. 규칙 분류보다 앞선다. */
@Entity
@Table(name = "ai_classify_feedback", uniqueConstraints =
        @UniqueConstraint(name = "uk_ai_classify_feedback", columnNames = {"project_id", "signature"}))
public class AiClassifyFeedback {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false, length = 100)
    private String projectId;

    @Column(nullable = false, length = 12)
    private String signature;

    @Column(nullable = false, length = 20)
    private String cause;

    @Column(name = "user_id")
    private Long userId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getSignature() { return signature; }
    public void setSignature(String signature) { this.signature = signature; }
    public String getCause() { return cause; }
    public void setCause(String cause) { this.cause = cause; }
    public void setUserId(Long userId) { this.userId = userId; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
