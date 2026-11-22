package com.playops.api.entity;

import jakarta.persistence.*;
import org.springframework.data.annotation.CreatedBy;
import org.springframework.data.annotation.LastModifiedBy;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.Instant;
import java.time.LocalDate;

/**
 * 계획 행 (plan_items, V24). 테스트가 아직 없어도 있다. specPath · grepFilter 가 둘 다 null 이면 미연결(미작성).
 * 연결 전에는 계획 칸(사용 · 순서 · 담당자 · 마감일 · 우선순위)의 원본이고, 연결 뒤에는 케이스 행(scenario_case_settings)이 원본이다.
 * DTO PlanItem(계획 표 한 줄)과 헷갈리지 않게 엔티티 이름은 PlanEntry 로 둔다.
 */
@Entity
@EntityListeners(AuditingEntityListener.class)
@Table(name = "plan_items")
public class PlanEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false, length = 100)
    private String projectId;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(name = "screen_route_key", length = 500)
    private String screenRouteKey;

    @Column(columnDefinition = "TEXT")
    private String expected;

    @Column(name = "spec_path", length = 500)
    private String specPath;

    @Column(name = "grep_filter", length = 500)
    private String grepFilter;

    /** 제목이 같은 테스트에 자동으로 이을지. 사람이 연결을 끊으면 false. */
    @Column(name = "auto_link", nullable = false)
    private Boolean autoLink = true;

    @Column(nullable = false)
    private Boolean enabled = true;

    @Column(name = "sort_order")
    private Integer sortOrder;

    @Column(length = 100)
    private String assignee;

    @Column(name = "assignee_user_id")
    private Long assigneeUserId;

    @Column(name = "due_date")
    private LocalDate dueDate;

    @Column(length = 10)
    private String priority;

    /** 최근 AI 생성 작업 */
    @Column(name = "ai_job_id")
    private Long aiJobId;

    @CreatedBy
    @Column(name = "created_by", updatable = false)
    private Long createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @LastModifiedBy
    @Column(name = "updated_by")
    private Long updatedBy;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        createdAt = Instant.now();
        updatedAt = createdAt;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }

    public boolean isLinked() { return specPath != null && grepFilter != null; }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getCreatedBy() { return createdBy; }
    public Instant getCreatedAt() { return createdAt; }
    public Long getUpdatedBy() { return updatedBy; }
    public Instant getUpdatedAt() { return updatedAt; }

    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getScreenRouteKey() { return screenRouteKey; }
    public void setScreenRouteKey(String screenRouteKey) { this.screenRouteKey = screenRouteKey; }

    public String getExpected() { return expected; }
    public void setExpected(String expected) { this.expected = expected; }

    public String getSpecPath() { return specPath; }
    public void setSpecPath(String specPath) { this.specPath = specPath; }

    public String getGrepFilter() { return grepFilter; }
    public void setGrepFilter(String grepFilter) { this.grepFilter = grepFilter; }

    public boolean getAutoLink() { return !Boolean.FALSE.equals(autoLink); }
    public void setAutoLink(boolean autoLink) { this.autoLink = autoLink; }

    public boolean getEnabled() { return !Boolean.FALSE.equals(enabled); }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }

    public Integer getSortOrder() { return sortOrder; }
    public void setSortOrder(Integer sortOrder) { this.sortOrder = sortOrder; }

    public String getAssignee() { return assignee; }
    public void setAssignee(String assignee) { this.assignee = assignee; }

    public Long getAssigneeUserId() { return assigneeUserId; }
    public void setAssigneeUserId(Long assigneeUserId) { this.assigneeUserId = assigneeUserId; }

    public LocalDate getDueDate() { return dueDate; }
    public void setDueDate(LocalDate dueDate) { this.dueDate = dueDate; }

    public String getPriority() { return priority; }
    public void setPriority(String priority) { this.priority = priority; }

    public Long getAiJobId() { return aiJobId; }
    public void setAiJobId(Long aiJobId) { this.aiJobId = aiJobId; }
}
