package com.playops.api.entity;

import jakarta.persistence.*;
import java.time.Instant;

/** 사람이 승인해 반영한 CODE_FIX 와 그때의 실패 서명 (V22). 다음 같은 · 비슷한 실패의 예시가 된다. */
@Entity
@Table(name = "ai_fix_memory")
public class AiFixMemory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false, length = 100)
    private String projectId;

    @Column(nullable = false, length = 12)
    private String signature;

    @Column(columnDefinition = "TEXT")
    private String head;

    @Column(columnDefinition = "TEXT")
    private String locator;

    @Column(name = "spec_path", length = 500)
    private String specPath;

    @Column(nullable = false, length = 20)
    private String cause;

    @Column(name = "ai_job_id", nullable = false, unique = true)
    private Long aiJobId;

    @Column(columnDefinition = "TEXT")
    private String diff;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    public Long getId() { return id; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getSignature() { return signature; }
    public void setSignature(String signature) { this.signature = signature; }
    public String getHead() { return head; }
    public void setHead(String head) { this.head = head; }
    public String getLocator() { return locator; }
    public void setLocator(String locator) { this.locator = locator; }
    public String getSpecPath() { return specPath; }
    public void setSpecPath(String specPath) { this.specPath = specPath; }
    public String getCause() { return cause; }
    public void setCause(String cause) { this.cause = cause; }
    public Long getAiJobId() { return aiJobId; }
    public void setAiJobId(Long aiJobId) { this.aiJobId = aiJobId; }
    public String getDiff() { return diff; }
    public void setDiff(String diff) { this.diff = diff; }
    public Instant getCreatedAt() { return createdAt; }
}
