package com.playops.api.entity;

import jakarta.persistence.*;

import java.time.Instant;

/**
 * AI 호출 한 번의 사용량 기록.
 *
 * 공급자 콘솔은 키 단위 청구액만 알려주고 어떤 기능이 얼마나 썼는지는 알려주지 않는다.
 * 여기에 남겨야 기능별 · 프로젝트별로 사용량을 볼 수 있다.
 */
@Entity
@Table(name = "ai_usage", indexes = {
        @Index(name = "idx_ai_usage_created_at", columnList = "createdAt"),
        @Index(name = "idx_ai_usage_provider", columnList = "provider")
})
public class AiUsage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private AiModelProvider provider;

    /** 어떤 기능이 호출했는지 (생성 · 분석 · 편집 도움 · 수정 등) */
    @Column(length = 40)
    private String feature;

    @Column(length = 100)
    private String projectId;

    @Column(length = 80)
    private String model;

    @Column(nullable = false)
    private int inputTokens;

    @Column(nullable = false)
    private int outputTokens;

    /** 호출에 걸린 시간(ms) */
    @Column(nullable = false)
    private long durationMs;

    /** 호출이 성공했는지 — 실패도 남겨야 재시도 비용을 볼 수 있다 */
    @Column(nullable = false)
    private boolean succeeded = true;

    @Column(nullable = false)
    private Instant createdAt = Instant.now();

    public Long getId() { return id; }
    public AiModelProvider getProvider() { return provider; }
    public void setProvider(AiModelProvider provider) { this.provider = provider; }
    public String getFeature() { return feature; }
    public void setFeature(String feature) { this.feature = feature; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getModel() { return model; }
    public void setModel(String model) { this.model = model; }
    public int getInputTokens() { return inputTokens; }
    public void setInputTokens(int inputTokens) { this.inputTokens = inputTokens; }
    public int getOutputTokens() { return outputTokens; }
    public void setOutputTokens(int outputTokens) { this.outputTokens = outputTokens; }
    public long getDurationMs() { return durationMs; }
    public void setDurationMs(long durationMs) { this.durationMs = durationMs; }
    public boolean isSucceeded() { return succeeded; }
    public void setSucceeded(boolean succeeded) { this.succeeded = succeeded; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
