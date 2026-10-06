package com.playops.api.controller;

import com.playops.api.entity.AiModelProvider;
import com.playops.api.entity.AiUsage;
import com.playops.api.repository.AiUsageRepository;
import com.playops.api.service.AiProviderSettingsService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * AI 사용량 집계.
 *
 * 공급자가 키별 청구액 조회 API를 공개하지 않아 실제 금액은 가져올 수 없다.
 * 대신 호출마다 남긴 토큰 수에 관리자가 입력한 단가를 곱해 추정치를 돌려준다.
 */
@RestController
@RequestMapping("/api/ai/usage")
public class AiUsageController {

    private final AiUsageRepository aiUsageRepository;
    private final AiProviderSettingsService settingsService;

    public AiUsageController(AiUsageRepository aiUsageRepository, AiProviderSettingsService settingsService) {
        this.aiUsageRepository = aiUsageRepository;
        this.settingsService = settingsService;
    }

    public record ProviderUsage(
            String provider,
            long calls,
            long failedCalls,
            long inputTokens,
            long outputTokens,
            double estimatedCostUsd,
            boolean priceConfigured
    ) {}

    public record FeatureUsage(String feature, long calls, long inputTokens, long outputTokens) {}

    public record UsageSummary(
            int days,
            Instant from,
            long totalCalls,
            double estimatedCostUsd,
            boolean priceConfigured,
            List<ProviderUsage> providers,
            List<FeatureUsage> features
    ) {}

    @GetMapping
    public UsageSummary get(@RequestParam(defaultValue = "30") int days) {
        int windowDays = Math.min(Math.max(days, 1), 365);
        Instant from = Instant.now().minus(windowDays, ChronoUnit.DAYS);
        List<AiUsage> rows = aiUsageRepository.findByCreatedAtAfter(from);

        List<ProviderUsage> providers = new ArrayList<>();
        double total = 0d;
        boolean anyPrice = false;
        for (AiModelProvider provider : AiModelProvider.values()) {
            List<AiUsage> mine = rows.stream().filter(r -> r.getProvider() == provider).toList();
            long input = mine.stream().mapToLong(AiUsage::getInputTokens).sum();
            long output = mine.stream().mapToLong(AiUsage::getOutputTokens).sum();
            double inPrice = settingsService.inputPrice(provider);
            double outPrice = settingsService.outputPrice(provider);
            boolean priced = inPrice > 0 || outPrice > 0;
            double cost = (input / 1_000_000d) * inPrice + (output / 1_000_000d) * outPrice;
            anyPrice = anyPrice || priced;
            total += cost;
            providers.add(new ProviderUsage(
                    provider.name(),
                    mine.size(),
                    mine.stream().filter(r -> !r.isSucceeded()).count(),
                    input, output, cost, priced
            ));
        }

        Map<String, FeatureUsage> byFeature = new LinkedHashMap<>();
        for (AiUsage row : rows) {
            String key = row.getFeature() != null ? row.getFeature() : "기타";
            FeatureUsage prev = byFeature.get(key);
            byFeature.put(key, prev == null
                    ? new FeatureUsage(key, 1, row.getInputTokens(), row.getOutputTokens())
                    : new FeatureUsage(key, prev.calls() + 1,
                            prev.inputTokens() + row.getInputTokens(),
                            prev.outputTokens() + row.getOutputTokens()));
        }
        List<FeatureUsage> features = new ArrayList<>(byFeature.values());
        features.sort((a, b) -> Long.compare(
                b.inputTokens() + b.outputTokens(), a.inputTokens() + a.outputTokens()));

        return new UsageSummary(windowDays, from, rows.size(), total, anyPrice, providers, features);
    }
}
