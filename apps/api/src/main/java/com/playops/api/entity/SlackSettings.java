package com.playops.api.entity;

import jakarta.persistence.*;
import org.springframework.data.annotation.CreatedBy;
import org.springframework.data.annotation.LastModifiedBy;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;
import java.time.Instant;

/**
 * 관리자가 등록하는 플랫폼 공용 Slack Incoming Webhook URL. 항상 단일 row(id=1)만 존재한다
 * (AiProviderSettings와 동일 패턴 — 단일 조직 내부 툴 전제, 프로젝트/사용자별 채널 분리 없음).
 */
@Entity
@EntityListeners(AuditingEntityListener.class)
@Table(name = "slack_settings")
public class SlackSettings {

    @Id
    private Long id = 1L;

    @Column(name = "webhook_url_encrypted", columnDefinition = "TEXT")
    private String webhookUrlEncrypted;

    @LastModifiedBy
    @Column(name = "updated_by")
    private Long updatedBy;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    @PreUpdate
    void onSave() {
        updatedAt = Instant.now();
    }

    public Long getId() { return id; }

    public String getWebhookUrlEncrypted() { return webhookUrlEncrypted; }
    public void setWebhookUrlEncrypted(String webhookUrlEncrypted) { this.webhookUrlEncrypted = webhookUrlEncrypted; }

    public Instant getUpdatedAt() { return updatedAt; }
    public Long getUpdatedBy() { return updatedBy; }
}
