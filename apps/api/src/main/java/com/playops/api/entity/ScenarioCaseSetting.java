package com.playops.api.entity;

import jakarta.persistence.*;
import org.springframework.data.annotation.CreatedBy;
import org.springframework.data.annotation.LastModifiedBy;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;
import java.time.Instant;
import java.time.LocalDate;

@Entity
@EntityListeners(AuditingEntityListener.class)
@Table(
        name = "scenario_case_settings",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_scenario_case_settings_key",
                columnNames = {"project_id", "node_type", "spec_path", "grep_filter"}
        )
)
public class ScenarioCaseSetting {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false, length = 100)
    private String projectId;

    @Column(name = "node_type", nullable = false, length = 20)
    private String nodeType;

    @Column(name = "spec_path", nullable = false, length = 500)
    private String specPath;

    @Column(name = "grep_filter", nullable = false, length = 500)
    private String grepFilter = "";

    @Column(nullable = false)
    private Boolean enabled = true;

    @Column(name = "sort_order")
    private Integer sortOrder;

    @Column(length = 100)
    private String assignee;

    /** 담당자 계정 (#119). 있으면 assignee 는 그 사람의 이름, 없으면 assignee 는 이관 전 글자(계정 없음)다. */
    @Column(name = "assignee_user_id")
    private Long assigneeUserId;

    @Column(name = "due_date")
    private LocalDate dueDate;

    @Column(length = 10)
    private String priority;

    @CreatedBy
    @Column(name = "created_by", updatable = false)
    private Long createdBy;

    @Column(name = "created_at", updatable = false)
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

    public Long getId() { return id; }
    public Long getCreatedBy() { return createdBy; }
    public Instant getCreatedAt() { return createdAt; }
    public Long getUpdatedBy() { return updatedBy; }

    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }

    public String getNodeType() { return nodeType; }
    public void setNodeType(String nodeType) { this.nodeType = nodeType; }

    public String getSpecPath() { return specPath; }
    public void setSpecPath(String specPath) { this.specPath = specPath; }

    public String getGrepFilter() { return grepFilter; }
    public void setGrepFilter(String grepFilter) { this.grepFilter = grepFilter != null ? grepFilter : ""; }

    public Boolean getEnabled() { return Boolean.TRUE.equals(enabled); }
    public void setEnabled(Boolean enabled) { this.enabled = Boolean.TRUE.equals(enabled); }

    public Integer getSortOrder() { return sortOrder; }
    public void setSortOrder(Integer sortOrder) { this.sortOrder = sortOrder; }

    public Long getAssigneeUserId() { return assigneeUserId; }
    public void setAssigneeUserId(Long assigneeUserId) { this.assigneeUserId = assigneeUserId; }

    public String getAssignee() { return assignee; }
    public void setAssignee(String assignee) { this.assignee = assignee; }

    public LocalDate getDueDate() { return dueDate; }
    public void setDueDate(LocalDate dueDate) { this.dueDate = dueDate; }

    public String getPriority() { return priority; }
    public void setPriority(String priority) { this.priority = priority; }

    public Instant getUpdatedAt() { return updatedAt; }
}
