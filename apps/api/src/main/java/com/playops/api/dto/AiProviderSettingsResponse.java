package com.playops.api.dto;

import java.time.Instant;

public class AiProviderSettingsResponse {
    private boolean claudeConfigured;
    private String claudeMasked;
    private boolean openaiConfigured;
    private String openaiMasked;
    private String claudeWorkspaceId;
    private Instant updatedAt;

    public AiProviderSettingsResponse() {}

    public AiProviderSettingsResponse(boolean claudeConfigured, String claudeMasked,
                                       boolean openaiConfigured, String openaiMasked,
                                       String claudeWorkspaceId,
                                       Instant updatedAt) {
        this.claudeConfigured = claudeConfigured;
        this.claudeMasked = claudeMasked;
        this.openaiConfigured = openaiConfigured;
        this.openaiMasked = openaiMasked;
        this.claudeWorkspaceId = claudeWorkspaceId;
        this.updatedAt = updatedAt;
    }

    public boolean isClaudeConfigured() { return claudeConfigured; }
    public void setClaudeConfigured(boolean claudeConfigured) { this.claudeConfigured = claudeConfigured; }

    public String getClaudeMasked() { return claudeMasked; }
    public void setClaudeMasked(String claudeMasked) { this.claudeMasked = claudeMasked; }

    public boolean isOpenaiConfigured() { return openaiConfigured; }
    public void setOpenaiConfigured(boolean openaiConfigured) { this.openaiConfigured = openaiConfigured; }

    public String getOpenaiMasked() { return openaiMasked; }
    public void setOpenaiMasked(String openaiMasked) { this.openaiMasked = openaiMasked; }

    public String getClaudeWorkspaceId() { return claudeWorkspaceId; }
    public void setClaudeWorkspaceId(String claudeWorkspaceId) { this.claudeWorkspaceId = claudeWorkspaceId; }

    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }

    private String defaultProvider;
    private Double claudeInputPrice;
    private Double claudeOutputPrice;
    private Double openaiInputPrice;
    private Double openaiOutputPrice;

    public String getDefaultProvider() { return defaultProvider; }
    public void setDefaultProvider(String defaultProvider) { this.defaultProvider = defaultProvider; }

    public Double getClaudeInputPrice() { return claudeInputPrice; }
    public void setClaudeInputPrice(Double claudeInputPrice) { this.claudeInputPrice = claudeInputPrice; }

    public Double getClaudeOutputPrice() { return claudeOutputPrice; }
    public void setClaudeOutputPrice(Double claudeOutputPrice) { this.claudeOutputPrice = claudeOutputPrice; }

    public Double getOpenaiInputPrice() { return openaiInputPrice; }
    public void setOpenaiInputPrice(Double openaiInputPrice) { this.openaiInputPrice = openaiInputPrice; }

    public Double getOpenaiOutputPrice() { return openaiOutputPrice; }
    public void setOpenaiOutputPrice(Double openaiOutputPrice) { this.openaiOutputPrice = openaiOutputPrice; }
}
