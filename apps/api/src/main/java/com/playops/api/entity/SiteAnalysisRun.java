package com.playops.api.entity;

import jakarta.persistence.*;

import java.time.Instant;

/**
 * 프로젝트의 소스 저장소를 한 번 분석한 기록 (저장 구조 1단계).
 *
 * 화면 정보는 프로젝트당 현재 상태 한 벌만 두고, 언제 어느 커밋을 분석했는지는 여기에 쌓는다.
 */
@Entity
@Table(name = "site_analysis_run", indexes = @Index(name = "idx_site_run_project", columnList = "project_id"))
public class SiteAnalysisRun {

    public static final String RUNNING = "RUNNING";
    public static final String COMPLETED = "COMPLETED";
    public static final String FAILED = "FAILED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false, length = 100)
    private String projectId;

    @Column(nullable = false, length = 20)
    private String status = RUNNING;

    @Column(name = "commit_sha", length = 64)
    private String commitSha;

    @Column(length = 30)
    private String framework;

    /** 상한에 걸려 일부 화면만 분석했는지 */
    @Column(nullable = false)
    private boolean partial = false;

    @Column(name = "screen_count", nullable = false)
    private int screenCount = 0;

    /** 요소까지 읽은 화면 수 (진행 표시용). 컬럼이 나중에 추가되어 예전 행은 null 이다. */
    @Column(name = "processed_count")
    private Integer processedCount = 0;

    /** 마지막으로 화면 하나를 다 읽은 시각. 남은 시간을 이 시점 기준으로 계산해야 기다리는 동안 숫자가 늘지 않는다. */
    @Column(name = "progress_at")
    private Instant progressAt;

    /** 이번 분석에서 LLM 을 부른 횟수. 파일이 안 바뀐 화면은 부르지 않는다. */
    @Column(name = "llm_calls")
    private Integer llmCalls = 0;

    /** JSON 문자열 배열 */
    @Column(columnDefinition = "TEXT")
    private String warnings;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt = Instant.now();

    @Column(name = "finished_at")
    private Instant finishedAt;

    public Long getId() { return id; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getCommitSha() { return commitSha; }
    public void setCommitSha(String commitSha) { this.commitSha = commitSha; }
    public String getFramework() { return framework; }
    public void setFramework(String framework) { this.framework = framework; }
    public boolean isPartial() { return partial; }
    public void setPartial(boolean partial) { this.partial = partial; }
    public int getScreenCount() { return screenCount; }
    public void setScreenCount(int screenCount) { this.screenCount = screenCount; }
    public int getProcessedCount() { return processedCount == null ? 0 : processedCount; }
    public void setProcessedCount(int processedCount) {
        this.processedCount = processedCount;
        this.progressAt = Instant.now();
    }
    public Instant getProgressAt() { return progressAt; }
    public int getLlmCalls() { return llmCalls == null ? 0 : llmCalls; }
    public void setLlmCalls(int llmCalls) { this.llmCalls = llmCalls; }
    public String getWarnings() { return warnings; }
    public void setWarnings(String warnings) { this.warnings = warnings; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
    public Instant getStartedAt() { return startedAt; }
    public Instant getFinishedAt() { return finishedAt; }
    public void setFinishedAt(Instant finishedAt) { this.finishedAt = finishedAt; }
}
