package com.playops.api.service;

import com.playops.api.entity.AiModelProvider;
import com.playops.api.entity.AiUsage;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmClient;
import com.playops.api.llm.LlmCredentials;
import com.playops.api.llm.LlmMessage;
import com.playops.api.llm.LlmResult;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.repository.AiUsageRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneOffset;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * Claude/GPT 호출을 한 곳으로 모은 게이트웨이. 관리자가 등록한 플랫폼 공용 키만 사용한다 —
 * 호출자가 개별 API 키를 넘길 수 있는 경로는 존재하지 않는다.
 * 실제 HTTP 호출은 공급자별 {@link LlmClient} 구현이 담당하고, 여기서는 자격증명 해석과 라우팅,
 * 그리고 사용량 기록을 한다. 호출이 모두 이 한 곳을 지나므로 사용량도 여기서만 남기면 된다.
 */
@Service
public class LlmGatewayService {

    private static final Logger log = LoggerFactory.getLogger(LlmGatewayService.class);

    private final AiProviderSettingsService aiProviderSettingsService;
    private final AiUsageRepository aiUsageRepository;
    private final Map<AiModelProvider, LlmClient> clients = new EnumMap<>(AiModelProvider.class);

    @Value("${llm.monthly-budget-usd:0}")
    private double monthlyBudgetUsd = 0;

    public LlmGatewayService(
            List<LlmClient> llmClients,
            AiProviderSettingsService aiProviderSettingsService,
            AiUsageRepository aiUsageRepository
    ) {
        this.aiProviderSettingsService = aiProviderSettingsService;
        this.aiUsageRepository = aiUsageRepository;
        for (LlmClient client : llmClients) {
            clients.put(client.provider(), client);
        }
    }

    /** 단일 질문용 단축 호출. 사용자 메시지 한 건으로 변환해 위임한다. */
    public String chat(AiModelProvider provider, String systemPrompt, String userPrompt) {
        return chat(provider, systemPrompt, List.of(LlmMessage.user(userPrompt)));
    }

    public String chat(AiModelProvider provider, String systemPrompt, List<LlmMessage> messages) {
        return chat(provider, systemPrompt, messages, null, null);
    }

    public String chat(AiModelProvider provider, String systemPrompt, String userPrompt,
                       String feature, String projectId) {
        return chat(provider, systemPrompt, List.of(LlmMessage.user(userPrompt)), feature, projectId);
    }

    /**
     * @param feature   어떤 기능이 호출했는지 (사용량 화면에서 기능별로 묶는 기준)
     * @param projectId 프로젝트에 속한 호출이면 그 id, 아니면 null
     */
    public String chat(AiModelProvider provider, String systemPrompt, List<LlmMessage> messages,
                       String feature, String projectId) {
        AiModelProvider resolved = provider != null ? provider : aiProviderSettingsService.getDefaultProvider();
        LlmClient client = clients.get(resolved);
        if (client == null) {
            throw new ApiException(400, "지원하지 않는 AI 공급자입니다: " + resolved);
        }
        ensureWithinMonthlyBudget();
        long startedAt = System.currentTimeMillis();
        try {
            LlmResult result = client.chat(resolveCredentials(resolved), systemPrompt, messages);
            record(resolved, feature, projectId, result, System.currentTimeMillis() - startedAt, true);
            return result.text();
        } catch (RuntimeException e) {
            // 실패한 호출도 남긴다. 재시도가 비용을 얼마나 쓰는지 보려면 필요하다.
            record(resolved, feature, projectId, null, System.currentTimeMillis() - startedAt, false);
            throw e;
        }
    }

    /**
     * 도구 목록을 함께 건네는 호출.
     *
     * 문자열이 아니라 결과 객체를 돌려준다. 모델이 "도구를 불러 달라"고 답하면
     * 본문 텍스트가 비어 있고 toolCalls 만 채워져 오는데, 문자열만 돌려주면 그 요청이 사라진다.
     */
    public LlmResult chatWithTools(AiModelProvider provider, String systemPrompt, List<LlmMessage> messages,
                                   List<LlmToolSpec> tools, String feature, String projectId) {
        AiModelProvider resolved = provider != null ? provider : aiProviderSettingsService.getDefaultProvider();
        LlmClient client = clients.get(resolved);
        if (client == null) {
            throw new ApiException(400, "지원하지 않는 AI 공급자입니다: " + resolved);
        }
        ensureWithinMonthlyBudget();
        long startedAt = System.currentTimeMillis();
        try {
            LlmResult result = client.chat(resolveCredentials(resolved), systemPrompt, messages, tools);
            record(resolved, feature, projectId, result, System.currentTimeMillis() - startedAt, true);
            return result;
        } catch (RuntimeException e) {
            record(resolved, feature, projectId, null, System.currentTimeMillis() - startedAt, false);
            throw e;
        }
    }

    /**
     * 이번 달(UTC) 추정 비용이 한도에 닿으면 호출을 막는다. 클라우드 쪽 예산 알림은 알려주기만 하고
     * 멈추지 않으므로, 실제로 지출을 세우는 곳은 여기뿐이다.
     */
    private void ensureWithinMonthlyBudget() {
        if (monthlyBudgetUsd <= 0) {
            return;
        }
        Instant monthStart = YearMonth.now(ZoneOffset.UTC).atDay(1).atStartOfDay().toInstant(ZoneOffset.UTC);
        // ponytail: 이번 달 기록을 전부 읽어 합산한다. 월 수만 건을 넘기면 집계 쿼리로 바꾼다.
        double spent = 0;
        for (AiUsage usage : aiUsageRepository.findByCreatedAtAfter(monthStart)) {
            spent += usage.getInputTokens() / 1_000_000d * aiProviderSettingsService.inputPrice(usage.getProvider())
                    + usage.getOutputTokens() / 1_000_000d * aiProviderSettingsService.outputPrice(usage.getProvider());
        }
        if (spent >= monthlyBudgetUsd) {
            throw new ApiException(429, String.format(
                    "이번 달 AI 예산($%.2f)을 모두 썼습니다 (추정 $%.2f). 다음 달에 다시 쓰거나 관리자에게 한도 조정을 요청하세요.",
                    monthlyBudgetUsd, spent));
        }
    }

    /** 사용량 기록은 부가 작업이므로, 실패해도 본래 호출 결과에 영향을 주지 않는다. */
    private void record(AiModelProvider provider, String feature, String projectId,
                        LlmResult result, long durationMs, boolean succeeded) {
        try {
            AiUsage usage = new AiUsage();
            usage.setProvider(provider);
            usage.setFeature(feature != null ? feature : "기타");
            usage.setProjectId(projectId);
            usage.setModel(result != null ? result.model() : null);
            usage.setInputTokens(result != null ? result.inputTokens() : 0);
            usage.setOutputTokens(result != null ? result.outputTokens() : 0);
            usage.setDurationMs(durationMs);
            usage.setSucceeded(succeeded);
            aiUsageRepository.save(usage);
        } catch (Exception e) {
            log.warn("AI 사용량 기록 실패 (호출 자체는 정상 처리됨): {}", e.getMessage());
        }
    }

    private LlmCredentials resolveCredentials(AiModelProvider provider) {
        String apiKey = aiProviderSettingsService.getDecryptedKey(provider);
        String workspaceId = provider == AiModelProvider.CLAUDE
                ? aiProviderSettingsService.getClaudeWorkspaceIdOrNull()
                : null;
        return new LlmCredentials(apiKey, workspaceId);
    }
}
