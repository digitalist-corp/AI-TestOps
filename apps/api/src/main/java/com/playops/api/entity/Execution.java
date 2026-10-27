package com.playops.api.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "executions")
public class Execution {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false, length = 100)
    private String projectId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ExecutionStatus status = ExecutionStatus.PENDING;

    @Column(name = "grep_filter", length = 500)
    private String grepFilter;

    @Column(name = "spec_path", length = 500)
    private String specPath;

    @Column(name = "case_title", length = 500)
    private String caseTitle;

    @Column(name = "total_tests")
    private Integer totalTests = 0;

    @Column(name = "passed_tests")
    private Integer passedTests = 0;

    @Column(name = "failed_tests")
    private Integer failedTests = 0;

    @Column(name = "skipped_tests")
    private Integer skippedTests = 0;

    @Column(name = "duration_ms")
    private Long durationMs;

    @Column(name = "report_path", length = 500)
    private String reportPath;

    /** 이 실행을 누가/무엇이 트리거했는지. 기본은 사람이 직접 실행("MANUAL"). AI 적용 후 안전망 검증은 "AI_POST_APPLY". */
    @Column(name = "source", length = 30)
    private String source = "MANUAL";

    /**
     * true면 여러 spec/케이스를 병렬(worker>1)이 아니라 순서대로 하나씩 실행한다 ("테스트 묶음 순차 실행").
     * columnDefinition에 DB 레벨 default를 명시해야 한다 — 이미 행이 있는 기존 테이블에 NOT NULL 컬럼을
     * default 없이 추가하면 Postgres가 ALTER TABLE 자체를 거부해서 컬럼이 아예 안 생긴다(Hibernate
     * ddl-auto=update는 이 실패를 조용히 넘기고 앱을 계속 띄우다가, 나중에 이 컬럼을 읽는 쿼리에서만 터진다).
     */
    @Column(nullable = false, columnDefinition = "boolean not null default false")
    private boolean sequential = false;

    @Column(name = "log_output", columnDefinition = "TEXT")
    private String logOutput;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "schedule_id")
    private Long scheduleId;

    @Column(name = "scheduled_for")
    private Instant scheduledFor;

    @PrePersist
    void onCreate() {
        createdAt = Instant.now();
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }

    public ExecutionStatus getStatus() { return status; }
    public void setStatus(ExecutionStatus status) { this.status = status; }

    public String getGrepFilter() { return grepFilter; }
    public void setGrepFilter(String grepFilter) { this.grepFilter = grepFilter; }

    public String getSpecPath() { return specPath; }
    public void setSpecPath(String specPath) { this.specPath = specPath; }

    public String getCaseTitle() { return caseTitle; }
    public void setCaseTitle(String caseTitle) { this.caseTitle = caseTitle; }

    public Integer getTotalTests() { return totalTests; }
    public void setTotalTests(Integer totalTests) { this.totalTests = totalTests; }

    public Integer getPassedTests() { return passedTests; }
    public void setPassedTests(Integer passedTests) { this.passedTests = passedTests; }

    public Integer getFailedTests() { return failedTests; }
    public void setFailedTests(Integer failedTests) { this.failedTests = failedTests; }

    public Integer getSkippedTests() { return skippedTests; }
    public void setSkippedTests(Integer skippedTests) { this.skippedTests = skippedTests; }

    public Long getDurationMs() { return durationMs; }
    public void setDurationMs(Long durationMs) { this.durationMs = durationMs; }

    public String getReportPath() { return reportPath; }
    public void setReportPath(String reportPath) { this.reportPath = reportPath; }

    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }

    public boolean isSequential() { return sequential; }
    public void setSequential(boolean sequential) { this.sequential = sequential; }

    public String getLogOutput() { return logOutput; }
    public void setLogOutput(String logOutput) { this.logOutput = logOutput; }

    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }

    public Instant getStartedAt() { return startedAt; }
    public void setStartedAt(Instant startedAt) { this.startedAt = startedAt; }

    public Instant getFinishedAt() { return finishedAt; }
    public void setFinishedAt(Instant finishedAt) { this.finishedAt = finishedAt; }

    public Instant getCreatedAt() { return createdAt; }

    public Long getScheduleId() { return scheduleId; }
    public void setScheduleId(Long scheduleId) { this.scheduleId = scheduleId; }

    public Instant getScheduledFor() { return scheduledFor; }
    public void setScheduledFor(Instant scheduledFor) { this.scheduledFor = scheduledFor; }
}
