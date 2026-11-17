package com.playops.api.entity;

import jakarta.persistence.*;

import java.io.Serializable;
import java.time.Instant;

/** 프로젝트 멤버 한 명. 같은 사람이 A 프로젝트에선 PM, B 프로젝트에선 팀원일 수 있다. */
@Entity
@Table(name = "project_members")
@IdClass(ProjectMember.Key.class)
public class ProjectMember {

    public record Key(String projectId, Long userId) implements Serializable {
        public Key() { this(null, null); }
    }

    @Id
    @Column(name = "project_id", length = 100)
    private String projectId;

    @Id
    @Column(name = "user_id")
    private Long userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private ProjectRole role;

    @Column(name = "created_by")
    private Long createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_by")
    private Long updatedBy;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public static ProjectMember of(String projectId, Long userId, ProjectRole role, Long actorId) {
        ProjectMember m = new ProjectMember();
        m.projectId = projectId;
        m.userId = userId;
        m.role = role;
        m.createdBy = actorId;
        m.updatedBy = actorId;
        return m;
    }

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }

    public String getProjectId() { return projectId; }
    public Long getUserId() { return userId; }
    public ProjectRole getRole() { return role; }
    public void setRole(ProjectRole role) { this.role = role; }
    public Long getCreatedBy() { return createdBy; }
    public Instant getCreatedAt() { return createdAt; }
    public Long getUpdatedBy() { return updatedBy; }
    public void setUpdatedBy(Long updatedBy) { this.updatedBy = updatedBy; }
    public Instant getUpdatedAt() { return updatedAt; }
}
