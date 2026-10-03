package com.playops.api.entity;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * 관리자가 등록하는 플랫폼 공용 AI 공급자 키. 항상 단일 row(id=1)만 존재한다.
 */
@Entity
@Table(name = "ai_provider_settings")
public class AiProviderSettings {

    @Id
    private Long id = 1L;

    @Column(name = "claude_api_key_encrypted", columnDefinition = "TEXT")
    private String claudeApiKeyEncrypted;

    @Column(name = "openai_api_key_encrypted", columnDefinition = "TEXT")
    private String openaiApiKeyEncrypted;

    @Column(name = "claude_workspace_id")
    private String claudeWorkspaceId;

    /** 화면에서 공급자를 고르지 않았을 때 사용할 공급자 */
    @Enumerated(EnumType.STRING)
    @Column(name = "default_provider", length = 16)
    private AiModelProvider defaultProvider = AiModelProvider.CLAUDE;

    /**
     * 100만 토큰당 단가(USD). 공급자가 사용량 조회 API를 공개하지 않아 실제 청구액을 가져올 수 없어,
     * 기록한 토큰 수에 이 값을 곱해 추정치를 보여준다. 가격이 바뀌면 관리자가 직접 고친다.
     */
    @Column(name = "claude_input_price")
    private Double claudeInputPrice;

    @Column(name = "claude_output_price")
    private Double claudeOutputPrice;

    @Column(name = "openai_input_price")
    private Double openaiInputPrice;

    @Column(name = "openai_output_price")
    private Double openaiOutputPrice;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    @PreUpdate
    void onSave() {
        updatedAt = Instant.now();
    }

    public AiModelProvider getDefaultProvider() { return defaultProvider; }
    public void setDefaultProvider(AiModelProvider defaultProvider) { this.defaultProvider = defaultProvider; }

    public Double getClaudeInputPrice() { return claudeInputPrice; }
    public void setClaudeInputPrice(Double claudeInputPrice) { this.claudeInputPrice = claudeInputPrice; }

    public Double getClaudeOutputPrice() { return claudeOutputPrice; }
    public void setClaudeOutputPrice(Double claudeOutputPrice) { this.claudeOutputPrice = claudeOutputPrice; }

    public Double getOpenaiInputPrice() { return openaiInputPrice; }
    public void setOpenaiInputPrice(Double openaiInputPrice) { this.openaiInputPrice = openaiInputPrice; }

    public Double getOpenaiOutputPrice() { return openaiOutputPrice; }
    public void setOpenaiOutputPrice(Double openaiOutputPrice) { this.openaiOutputPrice = openaiOutputPrice; }

    public Long getId() { return id; }

    public String getClaudeApiKeyEncrypted() { return claudeApiKeyEncrypted; }
    public void setClaudeApiKeyEncrypted(String claudeApiKeyEncrypted) { this.claudeApiKeyEncrypted = claudeApiKeyEncrypted; }

    public String getOpenaiApiKeyEncrypted() { return openaiApiKeyEncrypted; }
    public void setOpenaiApiKeyEncrypted(String openaiApiKeyEncrypted) { this.openaiApiKeyEncrypted = openaiApiKeyEncrypted; }

    public String getClaudeWorkspaceId() { return claudeWorkspaceId; }
    public void setClaudeWorkspaceId(String claudeWorkspaceId) { this.claudeWorkspaceId = claudeWorkspaceId; }

    public Instant getUpdatedAt() { return updatedAt; }
}
