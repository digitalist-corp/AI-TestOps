package com.playops.api.dto;

public class AiProviderSettingsRequest {
    private String claudeApiKey;
    private String openaiApiKey;
    private String claudeWorkspaceId;

    public String getClaudeApiKey() { return claudeApiKey; }
    public void setClaudeApiKey(String claudeApiKey) { this.claudeApiKey = claudeApiKey; }

    public String getOpenaiApiKey() { return openaiApiKey; }
    public void setOpenaiApiKey(String openaiApiKey) { this.openaiApiKey = openaiApiKey; }

    private String defaultProvider;
    private Double claudeInputPrice;
    private Double claudeOutputPrice;
    private Double openaiInputPrice;
    private Double openaiOutputPrice;

    public String getClaudeWorkspaceId() { return claudeWorkspaceId; }
    public void setClaudeWorkspaceId(String claudeWorkspaceId) { this.claudeWorkspaceId = claudeWorkspaceId; }

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
