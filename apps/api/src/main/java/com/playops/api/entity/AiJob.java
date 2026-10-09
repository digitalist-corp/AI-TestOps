package com.playops.api.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "ai_jobs")
public class AiJob {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false, length = 100)
    private String projectId;

    @Enumerated(EnumType.STRING)
    @Column(name = "job_type", nullable = false, length = 30)
    private AiJobType jobType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private AiJobStatus status = AiJobStatus.PENDING;

    /** job 생성 시점의 Project.aiModelProvider 스냅샷 — 진행 중 프로젝트 설정이 바뀌어도 이 job은 처음 값 그대로 쓴다. */
    @Enumerated(EnumType.STRING)
    @Column(name = "ai_model_provider", nullable = false, length = 20)
    private AiModelProvider aiModelProvider = AiModelProvider.CLAUDE;

    @Column(columnDefinition = "TEXT")
    private String instruction;

    @Column(name = "target_spec_path", length = 500)
    private String targetSpecPath;

    /** 시나리오 생성 때 사용자가 고른 화면의 routeKey (JSON 배열). 고르지 않았으면 null. */
    @Column(name = "route_keys", columnDefinition = "TEXT")
    private String routeKeys;

    @Column(name = "failed_execution_id")
    private Long failedExecutionId;

    @Column(name = "iterations_used")
    private Integer iterationsUsed = 0;

    @Column(name = "diff_path", length = 500)
    private String diffPath;

    /** result.json의 changedFiles를 그대로 저장한 JSON 문자열 배열. v1 CODE_FIX는 targetSpecPath 하나뿐이었지만
     * 관련 파일(같은 spec이 import하는 로컬 파일)까지 함께 고칠 수 있게 되면서 여러 개가 될 수 있다. */
    @Column(name = "changed_files", columnDefinition = "TEXT")
    private String changedFiles;

    @Column(columnDefinition = "TEXT")
    private String summary;

    /** 하드 게이트/검증 판정 사유 목록 (JSON 문자열 배열). Phase 4에서는 allowedPathGlobs 위반만 채워진다. */
    @Column(name = "risk_flags", columnDefinition = "TEXT")
    private String riskFlags;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Column(name = "callback_token", length = 100)
    private String callbackToken;

    @Column(name = "callback_token_expires_at")
    private Instant callbackTokenExpiresAt;

    @Column(name = "requested_by")
    private Long requestedBy;

    @Column(name = "reviewed_by")
    private Long reviewedBy;

    /** git 연동된 프로젝트에서 이 job의 변경을 반영한 커밋 SHA. git 미연동 프로젝트는 계속 null(파일 스냅샷 방식 사용). */
    @Column(name = "applied_commit_sha", length = 100)
    private String appliedCommitSha;

    /** Phase 5(사후 자동 revert)에서 사용. 현재는 컬럼만 존재. */
    @Enumerated(EnumType.STRING)
    @Column(name = "post_apply_verification_status", length = 20)
    private PostApplyVerificationStatus postApplyVerificationStatus;

    @Column(name = "post_apply_verification_execution_id")
    private Long postApplyVerificationExecutionId;

    @Column(name = "reverted_at")
    private Instant revertedAt;

    @Column(name = "revert_commit", length = 100)
    private String revertCommit;

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

    public Long getId() { return id; }

    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }

    public AiJobType getJobType() { return jobType; }
    public void setJobType(AiJobType jobType) { this.jobType = jobType; }

    public AiJobStatus getStatus() { return status; }
    public void setStatus(AiJobStatus status) { this.status = status; }

    public AiModelProvider getAiModelProvider() { return aiModelProvider; }
    public void setAiModelProvider(AiModelProvider aiModelProvider) { this.aiModelProvider = aiModelProvider; }

    public String getInstruction() { return instruction; }
    public void setInstruction(String instruction) { this.instruction = instruction; }

    public String getTargetSpecPath() { return targetSpecPath; }
    public String getRouteKeys() { return routeKeys; }
    public void setRouteKeys(String routeKeys) { this.routeKeys = routeKeys; }
    public void setTargetSpecPath(String targetSpecPath) { this.targetSpecPath = targetSpecPath; }

    public Long getFailedExecutionId() { return failedExecutionId; }
    public void setFailedExecutionId(Long failedExecutionId) { this.failedExecutionId = failedExecutionId; }

    public Integer getIterationsUsed() { return iterationsUsed; }
    public void setIterationsUsed(Integer iterationsUsed) { this.iterationsUsed = iterationsUsed; }

    public String getDiffPath() { return diffPath; }
    public void setDiffPath(String diffPath) { this.diffPath = diffPath; }

    public String getChangedFiles() { return changedFiles; }
    public void setChangedFiles(String changedFiles) { this.changedFiles = changedFiles; }

    public String getSummary() { return summary; }
    public void setSummary(String summary) { this.summary = summary; }

    public String getRiskFlags() { return riskFlags; }
    public void setRiskFlags(String riskFlags) { this.riskFlags = riskFlags; }

    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }

    public String getCallbackToken() { return callbackToken; }
    public void setCallbackToken(String callbackToken) { this.callbackToken = callbackToken; }

    public Instant getCallbackTokenExpiresAt() { return callbackTokenExpiresAt; }
    public void setCallbackTokenExpiresAt(Instant callbackTokenExpiresAt) { this.callbackTokenExpiresAt = callbackTokenExpiresAt; }

    public Long getRequestedBy() { return requestedBy; }
    public void setRequestedBy(Long requestedBy) { this.requestedBy = requestedBy; }

    public Long getReviewedBy() { return reviewedBy; }
    public void setReviewedBy(Long reviewedBy) { this.reviewedBy = reviewedBy; }

    public String getAppliedCommitSha() { return appliedCommitSha; }
    public void setAppliedCommitSha(String appliedCommitSha) { this.appliedCommitSha = appliedCommitSha; }

    public PostApplyVerificationStatus getPostApplyVerificationStatus() { return postApplyVerificationStatus; }
    public void setPostApplyVerificationStatus(PostApplyVerificationStatus postApplyVerificationStatus) { this.postApplyVerificationStatus = postApplyVerificationStatus; }

    public Long getPostApplyVerificationExecutionId() { return postApplyVerificationExecutionId; }
    public void setPostApplyVerificationExecutionId(Long postApplyVerificationExecutionId) { this.postApplyVerificationExecutionId = postApplyVerificationExecutionId; }

    public Instant getRevertedAt() { return revertedAt; }
    public void setRevertedAt(Instant revertedAt) { this.revertedAt = revertedAt; }

    public String getRevertCommit() { return revertCommit; }
    public void setRevertCommit(String revertCommit) { this.revertCommit = revertCommit; }

    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
