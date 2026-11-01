package com.playops.api.entity;

import jakarta.persistence.*;

import java.time.Instant;

/** 우상단 알림 창의 알림 한 건. 받는 사용자마다 한 줄이며, 사용자가 확인하고 지우면 사라진다. */
@Entity
@Table(name = "notifications", indexes = @Index(name = "idx_notifications_user_created", columnList = "user_id, created_at"))
public class Notification {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    /** EXECUTION_FINISHED, SCHEDULE_FINISHED, SCHEDULE_FAILED */
    @Column(nullable = false, length = 40)
    private String kind;

    /** SUCCESS, ERROR, INFO — 화면의 색만 가른다 */
    @Column(nullable = false, length = 10)
    private String level;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(length = 1000)
    private String message;

    /** 누르면 이동할 웹 경로 */
    @Column(length = 500)
    private String link;

    @Column(name = "project_id", length = 100)
    private String projectId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    public Long getId() { return id; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getKind() { return kind; }
    public void setKind(String kind) { this.kind = kind; }
    public String getLevel() { return level; }
    public void setLevel(String level) { this.level = level; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }
    public String getLink() { return link; }
    public void setLink(String link) { this.link = link; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public Instant getCreatedAt() { return createdAt; }
}
