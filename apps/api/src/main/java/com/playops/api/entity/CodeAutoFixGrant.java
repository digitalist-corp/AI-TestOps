package com.playops.api.entity;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * 코드 자동 수정 사용권 (V26). 프로젝트 · 멤버마다 한 줄이고, 다시 요청하면 그 줄을 대기로 돌린다.
 * memberSince: 요청할 때 멤버 행의 가입 시각. 빠졌다가 다시 들어오면 달라져 예전 권한이 살아나지 않는다.
 * scopes: 쉼표로 이은 AUTO_FIX · PR_PUBLISH.
 */
@Entity
@Table(name = "code_auto_fix_grants", uniqueConstraints =
        @UniqueConstraint(name = "uk_code_auto_fix_grants_member", columnNames = {"project_id", "user_id"}))
public class CodeAutoFixGrant {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false, length = 100)
    private String projectId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(nullable = false, length = 10)
    private String status;

    @Column(length = 100)
    private String scopes;

    @Column(name = "member_since", nullable = false)
    private Instant memberSince;

    @Column(length = 500)
    private String note;

    @Column(name = "requested_at", nullable = false)
    private Instant requestedAt = Instant.now();

    @Column(name = "decided_by")
    private Long decidedBy;

    @Column(name = "decided_at")
    private Instant decidedAt;

    public Long getId() { return id; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getScopes() { return scopes; }
    public void setScopes(String scopes) { this.scopes = scopes; }
    public Instant getMemberSince() { return memberSince; }
    public void setMemberSince(Instant memberSince) { this.memberSince = memberSince; }
    public String getNote() { return note; }
    public void setNote(String note) { this.note = note; }
    public Instant getRequestedAt() { return requestedAt; }
    public void setRequestedAt(Instant requestedAt) { this.requestedAt = requestedAt; }
    public Long getDecidedBy() { return decidedBy; }
    public void setDecidedBy(Long decidedBy) { this.decidedBy = decidedBy; }
    public Instant getDecidedAt() { return decidedAt; }
    public void setDecidedAt(Instant decidedAt) { this.decidedAt = decidedAt; }
}
