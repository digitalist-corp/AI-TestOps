package com.playops.api.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "test_suites")
public class TestSuite {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false, length = 100)
    private String projectId;

    @Column(nullable = false, length = 200)
    private String name;

    /** 시나리오 탭에서 체크한 케이스들의 specPath 목록 (JSON 문자열 배열). */
    @Column(name = "spec_paths", columnDefinition = "TEXT")
    private String specPaths;

    /** 체크한 케이스들의 grep을 OR로 묶은 정규식. 케이스 선택 없이 spec 단위로만 구성된 묶음이면 null. */
    @Column(columnDefinition = "TEXT")
    private String grep;

    @Column(name = "case_count")
    private Integer caseCount = 0;

    /** true면 이 묶음을 실행할 때 병렬 없이(workers=1) 저장된 순서대로 하나씩 실행한다. */
    @Column(nullable = false, columnDefinition = "boolean not null default false")
    private boolean sequential = false;

    @Column(name = "created_by")
    private Long createdBy;

    @Version
    @Column(name = "version", nullable = false)
    private Long version = 0L;

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

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getSpecPaths() { return specPaths; }
    public void setSpecPaths(String specPaths) { this.specPaths = specPaths; }

    public String getGrep() { return grep; }
    public void setGrep(String grep) { this.grep = grep; }

    public Integer getCaseCount() { return caseCount; }
    public void setCaseCount(Integer caseCount) { this.caseCount = caseCount; }

    public boolean isSequential() { return sequential; }
    public void setSequential(boolean sequential) { this.sequential = sequential; }

    public Long getCreatedBy() { return createdBy; }
    public void setCreatedBy(Long createdBy) { this.createdBy = createdBy; }

    public Long getVersion() { return version != null ? version : 0L; }
    public void setVersion(Long version) { this.version = version != null ? version : 0L; }

    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
