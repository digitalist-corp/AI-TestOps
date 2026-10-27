package com.playops.api.entity;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * 사용자 계정에 대한 관리자 작업 이력. actor/target 정보는 나중에 계정이 삭제돼도 로그가 의미를
 * 유지하도록 사용자명을 문자열로 함께 저장한다(비정규화) — id만 저장하면 삭제된 사용자는 로그에서
 * "누구"였는지 알 수 없게 된다.
 */
@Entity
@Table(name = "user_audit_logs")
public class UserAuditLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "actor_user_id")
    private Long actorUserId;

    @Column(name = "actor_username", length = 100)
    private String actorUsername;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 50)
    private UserAuditAction action;

    @Column(name = "target_user_id")
    private Long targetUserId;

    @Column(name = "target_username", length = 100)
    private String targetUsername;

    @Column(name = "project_id", length = 100)
    private String projectId;

    @Column(name = "resource_type", length = 100)
    private String resourceType;

    @Column(name = "resource_id", length = 100)
    private String resourceId;

    @Column(name = "request_id", length = 100)
    private String requestId;

    @Column(name = "outcome", nullable = false, length = 20)
    private String outcome = "SUCCESS";

    @Column(columnDefinition = "TEXT")
    private String detail;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        createdAt = Instant.now();
    }

    public Long getId() { return id; }

    public Long getActorUserId() { return actorUserId; }
    public void setActorUserId(Long actorUserId) { this.actorUserId = actorUserId; }

    public String getActorUsername() { return actorUsername; }
    public void setActorUsername(String actorUsername) { this.actorUsername = actorUsername; }

    public UserAuditAction getAction() { return action; }
    public void setAction(UserAuditAction action) { this.action = action; }

    public Long getTargetUserId() { return targetUserId; }
    public void setTargetUserId(Long targetUserId) { this.targetUserId = targetUserId; }

    public String getTargetUsername() { return targetUsername; }
    public void setTargetUsername(String targetUsername) { this.targetUsername = targetUsername; }

    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }

    public String getResourceType() { return resourceType; }
    public void setResourceType(String resourceType) { this.resourceType = resourceType; }

    public String getResourceId() { return resourceId; }
    public void setResourceId(String resourceId) { this.resourceId = resourceId; }

    public String getRequestId() { return requestId; }
    public void setRequestId(String requestId) { this.requestId = requestId; }

    public String getOutcome() { return outcome != null ? outcome : "SUCCESS"; }
    public void setOutcome(String outcome) { this.outcome = outcome != null ? outcome : "SUCCESS"; }

    public String getDetail() { return detail; }
    public void setDetail(String detail) { this.detail = detail; }

    public Instant getCreatedAt() { return createdAt; }
}
