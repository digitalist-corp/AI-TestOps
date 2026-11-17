package com.playops.api.entity;

import jakarta.persistence.*;

import java.time.Instant;

/**
 * V1 의 board_posts. 지금은 공지(type = NOTICE)만 쓴다 (#116).
 * created_by · updated_by 는 이 테이블만 사용자 이름(VARCHAR)이다 — 기존 칸이라 그대로 둔다.
 */
@Entity
@Table(name = "board_posts")
public class BoardPost {

    public static final String NOTICE = "NOTICE";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 20)
    private String type;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    @Column(nullable = false)
    private boolean visible = true;

    @Column(nullable = false)
    private boolean pinned;

    @Column(nullable = false)
    private boolean deleted;

    @Column(name = "visible_from")
    private Instant visibleFrom;

    @Column(name = "visible_until")
    private Instant visibleUntil;

    @Column(name = "created_by", nullable = false, length = 100)
    private String createdBy;

    @Column(name = "updated_by", length = 100)
    private String updatedBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

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

    /** 지금 읽는 사람에게 보이는지: 숨김이 아니고 게시 기간 안 */
    public boolean shownAt(Instant now) {
        return visible && !deleted
                && (visibleFrom == null || !visibleFrom.isAfter(now))
                && (visibleUntil == null || visibleUntil.isAfter(now));
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }
    public boolean isVisible() { return visible; }
    public void setVisible(boolean visible) { this.visible = visible; }
    public boolean isPinned() { return pinned; }
    public void setPinned(boolean pinned) { this.pinned = pinned; }
    public boolean isDeleted() { return deleted; }
    public void setDeleted(boolean deleted) { this.deleted = deleted; }
    public Instant getVisibleFrom() { return visibleFrom; }
    public void setVisibleFrom(Instant visibleFrom) { this.visibleFrom = visibleFrom; }
    public Instant getVisibleUntil() { return visibleUntil; }
    public void setVisibleUntil(Instant visibleUntil) { this.visibleUntil = visibleUntil; }
    public String getCreatedBy() { return createdBy; }
    public void setCreatedBy(String createdBy) { this.createdBy = createdBy; }
    public String getUpdatedBy() { return updatedBy; }
    public void setUpdatedBy(String updatedBy) { this.updatedBy = updatedBy; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
