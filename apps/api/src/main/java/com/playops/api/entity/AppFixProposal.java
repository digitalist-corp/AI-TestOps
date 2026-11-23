package com.playops.api.entity;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * 제품 코드 수정안 (V25). 결함의 실패 실행과 대상 소스 기준 커밋에 대한 진단 · 검토용 diff.
 * 테스트 코드를 고치는 AiJob(CODE_FIX)과 따로 둔다. causes · checks · files 는 JSON 배열이다.
 */
@Entity
@Table(name = "app_fix_proposals")
public class AppFixProposal {

    public static final String ANALYZING = "ANALYZING";
    public static final String DIFF_READY = "DIFF_READY";
    public static final String DIAGNOSIS_ONLY = "DIAGNOSIS_ONLY";
    public static final String FAILED = "FAILED";
    /** 서버가 기준 원본에 diff 를 적용해 봤다. 재현 테스트는 아직 돌리지 않았다 */
    public static final String DIFF_APPLIES = "DIFF_APPLIES";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false, length = 100)
    private String projectId;

    @Column(name = "spec_path", nullable = false, length = 500)
    private String specPath;

    @Column(nullable = false, length = 500)
    private String grep;

    @Column(name = "execution_id", nullable = false)
    private Long executionId;

    @Column(name = "identity_key", nullable = false, length = 64, unique = true)
    private String identityKey;

    @Column(nullable = false, length = 20)
    private String category;

    @Column(nullable = false, length = 20)
    private String status;

    @Column(length = 20)
    private String verification;

    @Column(name = "source_repository", length = 200)
    private String sourceRepository;

    @Column(name = "source_branch", length = 100)
    private String sourceBranch;

    @Column(name = "source_sha", length = 40)
    private String sourceSha;

    @Column(name = "app_root", length = 500)
    private String appRoot;

    @Column(columnDefinition = "TEXT")
    private String evidence;

    @Column(columnDefinition = "TEXT")
    private String summary;

    @Column(columnDefinition = "TEXT")
    private String causes;

    @Column(columnDefinition = "TEXT")
    private String checks;

    @Column(columnDefinition = "TEXT")
    private String files;

    @Column(columnDefinition = "TEXT")
    private String limitation;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Column(name = "requested_by")
    private Long requestedBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }

    public Long getId() { return id; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getSpecPath() { return specPath; }
    public void setSpecPath(String specPath) { this.specPath = specPath; }
    public String getGrep() { return grep; }
    public void setGrep(String grep) { this.grep = grep; }
    public Long getExecutionId() { return executionId; }
    public void setExecutionId(Long executionId) { this.executionId = executionId; }
    public String getIdentityKey() { return identityKey; }
    public void setIdentityKey(String identityKey) { this.identityKey = identityKey; }
    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getVerification() { return verification; }
    public void setVerification(String verification) { this.verification = verification; }
    public String getSourceRepository() { return sourceRepository; }
    public void setSourceRepository(String sourceRepository) { this.sourceRepository = sourceRepository; }
    public String getSourceBranch() { return sourceBranch; }
    public void setSourceBranch(String sourceBranch) { this.sourceBranch = sourceBranch; }
    public String getSourceSha() { return sourceSha; }
    public void setSourceSha(String sourceSha) { this.sourceSha = sourceSha; }
    public String getAppRoot() { return appRoot; }
    public void setAppRoot(String appRoot) { this.appRoot = appRoot; }
    public String getEvidence() { return evidence; }
    public void setEvidence(String evidence) { this.evidence = evidence; }
    public String getSummary() { return summary; }
    public void setSummary(String summary) { this.summary = summary; }
    public String getCauses() { return causes; }
    public void setCauses(String causes) { this.causes = causes; }
    public String getChecks() { return checks; }
    public void setChecks(String checks) { this.checks = checks; }
    public String getFiles() { return files; }
    public void setFiles(String files) { this.files = files; }
    public String getLimitation() { return limitation; }
    public void setLimitation(String limitation) { this.limitation = limitation; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
    public Long getRequestedBy() { return requestedBy; }
    public void setRequestedBy(Long requestedBy) { this.requestedBy = requestedBy; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
